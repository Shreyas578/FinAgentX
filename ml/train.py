"""
FinAgentX — ML Model Training
Trains Linear, Ridge, Lasso, and Random Forest models on the synthetic dataset.
Saves trained models to ml/models/ for use by the inference API.

Usage:
    python ml/train.py
"""

import os
import json
import numpy as np
import pandas as pd
import joblib
import warnings
warnings.filterwarnings("ignore")

from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
DATA_PATH  = os.path.join(os.path.dirname(__file__), "data", "synthetic_borrowers.csv")
FEATURES   = ["tx_frequency", "avg_balance", "balance_volatility",
              "repayment_history", "failed_repayments", "days_since_active"]
TARGET     = "default_prob"

os.makedirs(MODELS_DIR, exist_ok=True)

def load_or_generate_data():
    if not os.path.exists(DATA_PATH):
        print("⚙️  Dataset not found, generating now…")
        from generate_dataset import generate_dataset
        generate_dataset()
    df = pd.read_csv(DATA_PATH)
    print(f"✅ Loaded dataset: {len(df)} rows")
    return df

def evaluate_model(name, model, X_test, y_test):
    preds = model.predict(X_test).clip(0, 1)
    mse  = mean_squared_error(y_test, preds)
    mae  = mean_absolute_error(y_test, preds)
    r2   = r2_score(y_test, preds)
    print(f"   {name:<20} | MSE: {mse:.4f} | MAE: {mae:.4f} | R²: {r2:.4f}")
    return {"mse": round(mse, 4), "mae": round(mae, 4), "r2": round(r2, 4)}

def train():
    print("\n🧠 FinAgentX — ML Training Pipeline\n" + "="*50)

    # ── Load Data ────────────────────────────────────────────────────────────
    df = load_or_generate_data()
    X  = df[FEATURES].values
    y  = df[TARGET].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    # ── Feature Scaling (for linear models) ──────────────────────────────────
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled  = scaler.transform(X_test)

    print(f"\n📐 Train: {len(X_train)} | Test: {len(X_test)}\n")
    print(f"{'Model':<20} | {'MSE':>8} | {'MAE':>8} | {'R²':>8}")
    print("-" * 52)

    metrics = {}

    # ── 1. Linear Regression ─────────────────────────────────────────────────
    lr = LinearRegression()
    lr.fit(X_train_scaled, y_train)
    metrics["linear"] = evaluate_model("Linear Regression", lr, X_test_scaled, y_test)
    joblib.dump(lr, os.path.join(MODELS_DIR, "linear_model.pkl"))

    # ── 2. Ridge Regression ──────────────────────────────────────────────────
    ridge = Ridge(alpha=1.0)
    ridge.fit(X_train_scaled, y_train)
    metrics["ridge"] = evaluate_model("Ridge Regression", ridge, X_test_scaled, y_test)
    joblib.dump(ridge, os.path.join(MODELS_DIR, "ridge_model.pkl"))

    # ── 3. Lasso Regression ──────────────────────────────────────────────────
    lasso = Lasso(alpha=0.001, max_iter=10000)
    lasso.fit(X_train_scaled, y_train)
    metrics["lasso"] = evaluate_model("Lasso Regression", lasso, X_test_scaled, y_test)
    joblib.dump(lasso, os.path.join(MODELS_DIR, "lasso_model.pkl"))

    # ── 4. Random Forest (PRIMARY MODEL) ────────────────────────────────────
    rf = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=2,
        max_features="sqrt",
        n_jobs=-1,
        random_state=42
    )
    rf.fit(X_train, y_train)
    metrics["random_forest"] = evaluate_model("Random Forest", rf, X_test, y_test)
    joblib.dump(rf, os.path.join(MODELS_DIR, "rf_model.pkl"))

    # Feature importance
    importances = dict(zip(FEATURES, rf.feature_importances_.round(4).tolist()))
    print(f"\n🌲 Random Forest Feature Importances:")
    for feat, imp in sorted(importances.items(), key=lambda x: x[1], reverse=True):
        bar = "█" * int(imp * 40)
        print(f"   {feat:<25} {bar} {imp:.4f}")

    # ── Save Scaler ──────────────────────────────────────────────────────────
    joblib.dump(scaler, os.path.join(MODELS_DIR, "scaler.pkl"))

    # ── Save Metadata ─────────────────────────────────────────────────────────
    metadata = {
        "feature_names": FEATURES,
        "target": TARGET,
        "ensemble_weights": {
            "linear": 0.10,
            "ridge":  0.20,
            "lasso":  0.20,
            "random_forest": 0.50
        },
        "metrics": metrics,
        "feature_importance": importances,
        "trained_on_rows": len(X_train),
        "version": "1.0.0"
    }

    with open(os.path.join(MODELS_DIR, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n✅ All models saved to {MODELS_DIR}/")
    print("   linear_model.pkl | ridge_model.pkl | lasso_model.pkl | rf_model.pkl | scaler.pkl")
    print("\n🎯 Run `python api.py` to start the inference server.\n")
    return metadata

if __name__ == "__main__":
    train()
