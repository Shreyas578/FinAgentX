"""
FinAgentX — Continuous Learning Module
Updates ML models incrementally as real on-chain loan outcomes come in.

Strategy:
  1. Synthetic dataset → initial training
  2. On-chain data     → real features appended to training set
  3. Runtime outcomes  → continuous model retraining
"""

import os
import json
import numpy as np
import pandas as pd
import joblib
import logging
from datetime import datetime
from sklearn.linear_model import LinearRegression, Ridge, Lasso, SGDRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler

logging.basicConfig(level=logging.INFO, format="%(asctime)s [CL] %(message)s")
log = logging.getLogger(__name__)

MODELS_DIR   = os.path.join(os.path.dirname(__file__), "models")
DATA_PATH    = os.path.join(os.path.dirname(__file__), "data", "synthetic_borrowers.csv")
ONCHAIN_PATH = os.path.join(os.path.dirname(__file__), "data", "onchain_outcomes.csv")
FEATURES     = ["tx_frequency", "avg_balance", "balance_volatility",
                "repayment_history", "failed_repayments", "days_since_active"]

class ContinuousLearner:
    def __init__(self):
        self.update_count = 0
        self.outcome_buffer = []  # Buffer outcomes before retraining
        self.retrain_threshold = 20  # Retrain every 20 new outcomes

    def record_outcome(self, wallet: str, features: dict, actual_default: bool, loan_amount: float):
        """
        Record a real loan outcome for future training.
        Called by the agent when a loan is repaid or defaults.

        Args:
            wallet:         Borrower wallet address
            features:       Dict of ML features at loan time
            actual_default: True if borrower defaulted, False if repaid
            loan_amount:    Loan size in USDT
        """
        outcome = {
            "timestamp": datetime.utcnow().isoformat(),
            "wallet": wallet,
            **features,
            "default_prob": 1.0 if actual_default else 0.0,
            "credit_score": 0.0 if actual_default else 100.0,
            "loan_amount": loan_amount,
            "source": "onchain"
        }

        self.outcome_buffer.append(outcome)
        self._append_to_csv(outcome)

        log.info(f"Recorded outcome: wallet={wallet[:8]}… default={actual_default}")

        # Retrain if buffer is full
        if len(self.outcome_buffer) >= self.retrain_threshold:
            self.retrain()
            self.outcome_buffer = []

    def _append_to_csv(self, outcome: dict):
        """Append a single outcome to the CSV file."""
        os.makedirs(os.path.dirname(ONCHAIN_PATH), exist_ok=True)
        df_new = pd.DataFrame([outcome])
        header = not os.path.exists(ONCHAIN_PATH)
        df_new.to_csv(ONCHAIN_PATH, mode="a", header=header, index=False)

    def load_combined_data(self):
        """Load synthetic + on-chain data, weight real data 3x."""
        dfs = []

        if os.path.exists(DATA_PATH):
            df_synthetic = pd.read_csv(DATA_PATH)
            df_synthetic["source"] = "synthetic"
            dfs.append(df_synthetic)

        if os.path.exists(ONCHAIN_PATH):
            df_onchain = pd.read_csv(ONCHAIN_PATH)
            df_onchain = df_onchain[FEATURES + ["default_prob"]].dropna()
            df_onchain["source"] = "onchain"
            # Weight real data 3x by repeating rows
            dfs.extend([df_onchain] * 3)
            log.info(f"Loaded {len(df_onchain)} on-chain outcomes (weighted 3x)")

        if not dfs:
            raise ValueError("No training data found.")

        return pd.concat(dfs, ignore_index=True)

    def retrain(self):
        """Retrain all models on combined synthetic + real data."""
        log.info("🔄 Starting model retraining with latest on-chain outcomes…")

        try:
            df = self.load_combined_data()
            X  = df[FEATURES].values
            y  = df["default_prob"].values

            scaler = joblib.load(os.path.join(MODELS_DIR, "scaler.pkl"))
            X_scaled = scaler.fit_transform(X)

            # Retrain all models
            models_to_train = {
                "linear_model": LinearRegression(),
                "ridge_model":  Ridge(alpha=1.0),
                "lasso_model":  Lasso(alpha=0.001, max_iter=10000),
                "rf_model":     RandomForestRegressor(
                    n_estimators=200, max_depth=12,
                    min_samples_split=5, n_jobs=-1, random_state=42
                )
            }

            for name, model in models_to_train.items():
                if name in ("linear_model", "ridge_model", "lasso_model"):
                    model.fit(X_scaled, y)
                else:
                    model.fit(X, y)
                joblib.dump(model, os.path.join(MODELS_DIR, f"{name}.pkl"))

            # Save updated scaler
            joblib.dump(scaler, os.path.join(MODELS_DIR, "scaler.pkl"))

            self.update_count += 1
            log.info(f"✅ Retraining complete (update #{self.update_count}) on {len(df)} rows")

            # Reload predictor singleton
            try:
                from ensemble import get_predictor, _predictor
                if _predictor:
                    _predictor.load()
            except Exception:
                pass

        except Exception as e:
            log.error(f"❌ Retraining failed: {e}")
            raise

    def get_stats(self) -> dict:
        """Return statistics about the continuous learning pipeline."""
        onchain_count = 0
        if os.path.exists(ONCHAIN_PATH):
            try:
                df = pd.read_csv(ONCHAIN_PATH)
                onchain_count = len(df)
            except Exception:
                pass

        synthetic_count = 0
        if os.path.exists(DATA_PATH):
            try:
                synthetic_count = len(pd.read_csv(DATA_PATH))
            except Exception:
                pass

        return {
            "synthetic_samples": synthetic_count,
            "onchain_samples": onchain_count,
            "buffer_size": len(self.outcome_buffer),
            "retrain_threshold": self.retrain_threshold,
            "total_retrains": self.update_count,
        }


# Singleton
_learner = None

def get_learner() -> ContinuousLearner:
    global _learner
    if _learner is None:
        _learner = ContinuousLearner()
    return _learner
