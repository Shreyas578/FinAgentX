"""
FinAgentX — Ensemble Prediction Engine
Combines predictions from all 4 models with weighted averaging.
Also computes model variance (uncertainty) for confidence-aware lending.

Ensemble weights:
  Linear Regression : 0.10
  Ridge Regression  : 0.20
  Lasso Regression  : 0.20
  Random Forest     : 0.50 (PRIMARY)
"""

import os
import numpy as np
import joblib
import json

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
FEATURES   = ["tx_frequency", "avg_balance", "balance_volatility",
              "repayment_history", "failed_repayments", "days_since_active"]

WEIGHTS = {
    "linear": 0.10,
    "ridge":  0.20,
    "lasso":  0.20,
    "random_forest": 0.50
}

class EnsemblePredictor:
    def __init__(self):
        self.models  = {}
        self.scaler  = None
        self.loaded  = False

    def load(self):
        """Load all models from disk."""
        try:
            self.models["linear"] = joblib.load(os.path.join(MODELS_DIR, "linear_model.pkl"))
            self.models["ridge"]  = joblib.load(os.path.join(MODELS_DIR, "ridge_model.pkl"))
            self.models["lasso"]  = joblib.load(os.path.join(MODELS_DIR, "lasso_model.pkl"))
            self.models["random_forest"] = joblib.load(os.path.join(MODELS_DIR, "rf_model.pkl"))
            self.scaler = joblib.load(os.path.join(MODELS_DIR, "scaler.pkl"))
            self.loaded = True
            print("✅ EnsemblePredictor: all models loaded")
        except FileNotFoundError as e:
            raise RuntimeError(
                f"Models not found. Run `python ml/train.py` first.\n{e}"
            )

    def predict(self, features: dict) -> dict:
        """
        Run ensemble prediction for a single borrower.

        Args:
            features: dict with keys matching FEATURES list

        Returns:
            dict with default_prob, credit_score, individual_preds, variance,
                  decision, loan_adjustment, interest_adjustment
        """
        if not self.loaded:
            self.load()

        # Build feature vector
        X = np.array([[features.get(f, 0) for f in FEATURES]])
        X_scaled = self.scaler.transform(X)

        # Individual predictions (clipped to [0,1])
        preds = {}
        preds["linear"] = float(self.models["linear"].predict(X_scaled)[0].clip(0, 1))
        preds["ridge"]  = float(self.models["ridge"].predict(X_scaled)[0].clip(0, 1))
        preds["lasso"]  = float(self.models["lasso"].predict(X_scaled)[0].clip(0, 1))
        preds["random_forest"] = float(self.models["random_forest"].predict(X)[0].clip(0, 1))

        # Weighted ensemble (final default probability)
        final_score = sum(WEIGHTS[m] * preds[m] for m in WEIGHTS)
        final_score = float(np.clip(final_score, 0, 1))

        # Model variance (uncertainty measure)
        pred_values = list(preds.values())
        variance    = float(np.var(pred_values))
        std_dev     = float(np.std(pred_values))

        # Credit score (0–100, inverse of default probability)
        credit_score = round(100 * (1 - final_score), 1)

        # Decision logic
        if final_score > 0.6:
            decision = "REJECT"
            rejection_reason = self._rejection_reason(features, final_score)
        else:
            decision = "APPROVE"
            rejection_reason = None

        # Confidence-aware adjustments (high variance → reduce loan, raise rate)
        loan_reduction_pct    = 0.0
        interest_increase_bps = 0

        if variance > 0.02:          # High uncertainty
            loan_reduction_pct    = min(variance * 300, 40.0)   # up to 40% reduction
            interest_increase_bps = int(min(variance * 5000, 500))  # up to 5% extra
        elif variance > 0.005:       # Medium uncertainty
            loan_reduction_pct    = min(variance * 100, 15.0)
            interest_increase_bps = int(min(variance * 2000, 200))

        return {
            "default_prob":   round(final_score, 4),
            "credit_score":   credit_score,
            "decision":       decision,
            "rejection_reason": rejection_reason,
            "individual_predictions": {k: round(v, 4) for k, v in preds.items()},
            "model_variance":   round(variance, 6),
            "model_std_dev":    round(std_dev, 4),
            "uncertainty_level": self._uncertainty_label(variance),
            "loan_reduction_pct":    round(loan_reduction_pct, 1),
            "interest_increase_bps": interest_increase_bps,
        }

    def predict_batch(self, records: list) -> list:
        """Run predictions on a list of borrower feature dicts."""
        return [self.predict(r) for r in records]

    def _rejection_reason(self, features, default_prob):
        reasons = []
        if features.get("failed_repayments", 0) >= 3:
            reasons.append("High failed repayment count")
        if features.get("repayment_history", 1) < 0.4:
            reasons.append("Poor repayment history")
        if features.get("balance_volatility", 0) > 1.2:
            reasons.append("Excessive balance volatility")
        if features.get("days_since_active", 0) > 180:
            reasons.append("Extended wallet inactivity")
        if not reasons:
            reasons.append(f"Default probability {default_prob:.0%} exceeds threshold (60%)")
        return "; ".join(reasons)

    @staticmethod
    def _uncertainty_label(variance):
        if variance > 0.02:   return "HIGH"
        if variance > 0.005:  return "MEDIUM"
        return "LOW"


# ── Singleton instance ───────────────────────────────────────────────────────
_predictor = None

def get_predictor() -> EnsemblePredictor:
    global _predictor
    if _predictor is None:
        _predictor = EnsemblePredictor()
        _predictor.load()
    return _predictor


if __name__ == "__main__":
    # Quick test
    predictor = EnsemblePredictor()
    predictor.load()

    test_cases = [
        {"name": "Good borrower",
         "tx_frequency": 80, "avg_balance": 5.0, "balance_volatility": 0.1,
         "repayment_history": 0.95, "failed_repayments": 0, "days_since_active": 3},
        {"name": "Risky borrower",
         "tx_frequency": 5, "avg_balance": 0.1, "balance_volatility": 1.5,
         "repayment_history": 0.2, "failed_repayments": 5, "days_since_active": 150},
    ]

    for tc in test_cases:
        name = tc.pop("name")
        result = predictor.predict(tc)
        print(f"\n🧪 {name}")
        print(f"   Default Prob:   {result['default_prob']:.1%}")
        print(f"   Credit Score:   {result['credit_score']}/100")
        print(f"   Decision:       {result['decision']}")
        print(f"   Uncertainty:    {result['uncertainty_level']} (var={result['model_variance']:.5f})")
        print(f"   Preds:          {result['individual_predictions']}")
