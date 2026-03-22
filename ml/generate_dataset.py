"""
FinAgentX — Synthetic Dataset Generator
Generates 10,000 realistic borrower profiles for initial ML model training.

Features:
  - tx_frequency       : Transactions per month
  - avg_balance        : Average wallet balance in ETH
  - balance_volatility : Std dev of balance / avg (coefficient of variation)
  - repayment_history  : Proportion of loans repaid (0-1)
  - failed_repayments  : Count of failed repayments
  - days_since_active  : Days since last on-chain activity

Labels:
  - default_prob       : Probability of default (0-1)
  - credit_score       : 0-100 credit score
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
import os

np.random.seed(42)
N = 10_000

def generate_dataset(n=N, output_path="data/synthetic_borrowers.csv"):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # ── Feature Generation ──────────────────────────────────────────────────
    # Transaction frequency (1–200 per month, right-skewed)
    tx_frequency = np.random.exponential(scale=30, size=n).clip(1, 200).astype(int)

    # Average balance in ETH (0.01 – 100, log-normal)
    avg_balance = np.random.lognormal(mean=0.5, sigma=1.5, size=n).clip(0.01, 100)

    # Balance volatility (0 – 2, higher = riskier)
    balance_volatility = np.random.beta(2, 5, size=n) * 2

    # Repayment history (0–1, bimodal: good or bad borrowers)
    good_borrower = np.random.random(n) > 0.3
    repayment_history = np.where(
        good_borrower,
        np.random.beta(8, 2, size=n),     # mostly repaid
        np.random.beta(2, 8, size=n)      # mostly defaulted
    )

    # Failed repayments count (0–15)
    failed_repayments = np.where(
        good_borrower,
        np.random.poisson(0.3, size=n),
        np.random.poisson(3.5, size=n)
    ).clip(0, 15)

    # Days since last activity (0–365)
    days_since_active = np.random.exponential(scale=30, size=n).clip(0, 365).astype(int)

    # ── Label Generation ────────────────────────────────────────────────────
    # Default probability: function of features + noise
    default_prob = (
        0.35 * (1 - repayment_history) +
        0.20 * (failed_repayments / 15) +
        0.15 * balance_volatility / 2 +
        0.10 * (1 - np.log1p(avg_balance) / np.log1p(100)) +
        0.10 * (days_since_active / 365) +
        0.10 * (1 - np.log1p(tx_frequency) / np.log1p(200)) +
        np.random.normal(0, 0.05, n)  # noise
    ).clip(0, 1)

    # Credit score: inverse of default probability, scaled to 0-100
    credit_score = (100 * (1 - default_prob)).clip(0, 100).round(1)

    # ── Assemble DataFrame ──────────────────────────────────────────────────
    df = pd.DataFrame({
        "tx_frequency": tx_frequency,
        "avg_balance": avg_balance.round(4),
        "balance_volatility": balance_volatility.round(4),
        "repayment_history": repayment_history.round(4),
        "failed_repayments": failed_repayments,
        "days_since_active": days_since_active,
        "default_prob": default_prob.round(4),
        "credit_score": credit_score,
    })

    df.to_csv(output_path, index=False)
    print(f"✅ Generated {n} synthetic borrower profiles → {output_path}")
    print(f"\n📊 Dataset Statistics:")
    print(df.describe().round(3).to_string())
    print(f"\n   Default rate (>0.6):  {(df['default_prob'] > 0.6).mean():.1%}")
    print(f"   Avg credit score:     {df['credit_score'].mean():.1f}")
    return df


if __name__ == "__main__":
    df = generate_dataset()
