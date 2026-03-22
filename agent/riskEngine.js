/**
 * FinAgentX — Risk Engine
 * Generates ML features from on-chain data and calls the inference API.
 * Computes dynamic interest rates with confidence-aware adjustments.
 *
 * Dynamic Interest Rate:
 *   interest = base_rate + (default_prob * risk_multiplier) + uncertainty_adjustment
 */

const axios = require("axios");
const { wdk } = require("./wdk");

const ML_API   = process.env.ML_API_URL   || "http://localhost:8000";
const BASE_RATE_BPS = parseInt(process.env.BASE_RATE_BPS || "500"); // 5%
const RISK_MULTIPLIER = 2500; // Max risk premium: 25%

class RiskEngine {
  constructor() {
    this.cache = new Map(); // Wallet → { result, timestamp }
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Full risk evaluation for a borrower wallet
   * Returns ML prediction + dynamic interest rate + behavioral flags
   */
  async evaluateBorrower(wallet, requestedAmount) {
    // Check cache
    const cached = this.cache.get(wallet);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }

    await wdk.init();

    // ── Step 1: Gather on-chain data ────────────────────────────────────────
    const [balance, txCount, creditProfile] = await Promise.allSettled([
      wdk.getWalletBalance(wallet),
      wdk.getWalletTxCount(wallet),
      wdk.getCreditProfile(wallet),
    ]);

    const bal     = balance.status === "fulfilled"     ? balance.value     : { eth: "0.1", usdt: "0" };
    const txCnt   = txCount.status === "fulfilled"     ? txCount.value     : 10;
    const credit  = creditProfile.status === "fulfilled" ? creditProfile.value : { score: 50, repaymentRate: 100, failedRepayments: 0, lastUpdated: 0 };

    // ── Step 2: Generate ML features ────────────────────────────────────────
    const features = this._generateFeatures(bal, txCnt, credit);

    // ── Step 3: Run ML inference ────────────────────────────────────────────
    let mlResult;
    try {
      const res = await axios.post(`${ML_API}/predict`, {
        ...features,
        wallet,
      }, { timeout: 10000 });
      mlResult = res.data;
    } catch (err) {
      console.warn(`[Risk] ML API unavailable, using heuristic: ${err.message}`);
      mlResult = this._heuristicFallback(features, credit);
    }

    // ── Step 4: Dynamic interest rate ───────────────────────────────────────
    const interestRateBps = this._computeInterestRate(
      mlResult.default_prob,
      mlResult.model_variance,
      credit.score
    );

    // ── Step 5: Behavioral risk flags ────────────────────────────────────────
    const behaviorFlags = this._detectBehavioralRisks(features, credit, txCnt);

    // ── Step 6: Confidence-aware loan cap ────────────────────────────────────
    const maxLoanAmount = this._computeMaxLoan(
      requestedAmount,
      mlResult.loan_reduction_pct,
      credit.score,
      parseFloat(bal.usdt)
    );

    const result = {
      wallet,
      features,
      creditProfile:    credit,
      ml:               mlResult,
      interestRateBps,
      maxLoanAmount,
      behaviorFlags,
      evaluatedAt:      Date.now(),
    };

    this.cache.set(wallet, { result, timestamp: Date.now() });
    return result;
  }

  _generateFeatures(balance, txCount, creditProfile) {
    const ethBal = parseFloat(balance.eth) || 0.01;
    const daysSinceActive = creditProfile.lastUpdated > 0
      ? Math.floor((Date.now() / 1000 - creditProfile.lastUpdated) / 86400)
      : 30;

    return {
      tx_frequency:        Math.min(Math.round(txCount / 3), 200),
      avg_balance:         parseFloat(ethBal.toFixed(4)),
      balance_volatility:  parseFloat(Math.min(1 / (ethBal + 0.01), 2).toFixed(4)),
      repayment_history:   parseFloat((creditProfile.repaymentRate / 100).toFixed(4)),
      failed_repayments:   Math.min(creditProfile.failedRepayments, 15),
      days_since_active:   Math.min(daysSinceActive, 365),
    };
  }

  _computeInterestRate(defaultProb, modelVariance, creditScore) {
    // Base + risk premium + uncertainty premium
    const riskPremium        = Math.round(defaultProb * RISK_MULTIPLIER);
    const uncertaintyPremium = Math.round(Math.min(modelVariance * 5000, 500));
    const creditDiscount     = Math.round(Math.max(0, creditScore - 50) * 5); // Better score = discount

    const total = BASE_RATE_BPS + riskPremium + uncertaintyPremium - creditDiscount;
    return Math.max(200, Math.min(total, 5000)); // Clamp: 2%–50%
  }

  _computeMaxLoan(requested, reductionPct, creditScore, usdtBalance) {
    let max = parseFloat(requested);
    // Apply ML-driven uncertainty reduction
    if (reductionPct > 0) {
      max *= (1 - reductionPct / 100);
    }
    // Credit score cap (score 50 = 50% of requested; score 100 = 100%)
    max *= Math.min(creditScore / 50, 1.0);
    return parseFloat(max.toFixed(2));
  }

  _detectBehavioralRisks(features, creditProfile, rawTxCount) {
    const flags = [];

    // Rapid tx bursts (>150/month = suspicious)
    if (features.tx_frequency > 150) flags.push("HIGH_TX_FREQUENCY");

    // Extreme balance volatility
    if (features.balance_volatility > 1.5) flags.push("EXTREME_BALANCE_VOLATILITY");

    // Near-zero balance with large loan request
    if (features.avg_balance < 0.01) flags.push("NEAR_ZERO_ETH_BALANCE");

    // Multiple prior defaults
    if (creditProfile.failedRepayments >= 3) flags.push("MULTIPLE_PRIOR_DEFAULTS");

    // Long inactivity before loan request
    if (features.days_since_active > 180) flags.push("EXTENDED_INACTIVITY");

    // First-time borrower (no history)
    if (!creditProfile.exists) flags.push("NO_CREDIT_HISTORY");

    return flags;
  }

  _heuristicFallback(features, credit) {
    // Simple heuristic when ML API is down
    const defaultProb = Math.max(0,
      0.3 * (1 - features.repayment_history) +
      0.2 * (features.failed_repayments / 15) +
      0.2 * (features.balance_volatility / 2) +
      0.15 * (features.days_since_active / 365) +
      0.15 * (1 - Math.min(features.avg_balance / 10, 1))
    );

    const creditScore = Math.round(100 * (1 - defaultProb));
    const decision    = defaultProb > 0.6 ? "REJECT" : "APPROVE";

    return {
      default_prob: parseFloat(defaultProb.toFixed(4)),
      credit_score: creditScore,
      decision,
      model_variance: 0.025, // High uncertainty (heuristic)
      uncertainty_level: "HIGH",
      loan_reduction_pct: 25,
      interest_increase_bps: 300,
      individual_predictions: { heuristic: defaultProb },
      rejection_reason: decision === "REJECT" ? "Risk threshold exceeded (heuristic)" : null,
      _source: "heuristic_fallback"
    };
  }

  clearCache(wallet = null) {
    if (wallet) this.cache.delete(wallet);
    else this.cache.clear();
  }
}

const riskEngine = new RiskEngine();
module.exports = { riskEngine, RiskEngine };
