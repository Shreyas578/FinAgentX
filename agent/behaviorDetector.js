/**
 * FinAgentX — Behavioral Risk Detector
 * Detects suspicious wallet activity patterns that indicate fraud or manipulation.
 * Works in conjunction with ML predictions to add another risk layer.
 */

class BehavioralRiskDetector {
  constructor() {
    this.walletHistory = new Map(); // wallet → activity log
    this.flaggedWallets = new Set();
  }

  /**
   * Main behavioral analysis for a borrower wallet
   * Returns risk flags and overall assessment
   */
  analyze(wallet, features, creditProfile, txCount) {
    const flags     = [];
    const history   = this.walletHistory.get(wallet) || {};
    const now       = Date.now();

    // ── 1. High-velocity activity ────────────────────────────────────────────
    if (features.tx_frequency > 150) {
      flags.push({
        code:     "HIGH_TX_VELOCITY",
        severity: "MEDIUM",
        detail:   `${features.tx_frequency} tx/month — unusually high`,
      });
    }

    // ── 2. Sybil pattern: rapid new wallet + instant loan ────────────────────
    if (!creditProfile.exists && txCount < 5) {
      flags.push({
        code:     "FRESH_WALLET_LOAN_ATTEMPT",
        severity: "HIGH",
        detail:   "Brand new wallet with <5 transactions requesting a loan",
      });
    }

    // ── 3. Extreme balance volatility (wash trading) ────────────────────────
    if (features.balance_volatility > 1.5) {
      flags.push({
        code:     "EXTREME_VOLATILITY",
        severity: "HIGH",
        detail:   `Balance volatility ${features.balance_volatility.toFixed(2)} — possible wash trading`,
      });
    }

    // ── 4. Multiple prior defaults ────────────────────────────────────────────
    if (creditProfile.failedRepayments >= 3) {
      flags.push({
        code:     "SERIAL_DEFAULTER",
        severity: "CRITICAL",
        detail:   `${creditProfile.failedRepayments} prior defaults recorded`,
      });
    }

    // ── 5. Near-zero balance attack ───────────────────────────────────────────
    if (features.avg_balance < 0.005) {
      flags.push({
        code:     "NEAR_ZERO_BALANCE",
        severity: "MEDIUM",
        detail:   "Very low ETH balance — may be unable to pay gas for repayment",
      });
    }

    // ── 6. Extended inactivity before loan request ────────────────────────────
    if (features.days_since_active > 200) {
      flags.push({
        code:     "WALLET_RESURRECTION",
        severity: "MEDIUM",
        detail:   `Wallet inactive for ${features.days_since_active} days then loan request`,
      });
    }

    // ── 7. Repeated loan requests (throttle check) ────────────────────────────
    if (history.lastLoanRequest) {
      const minsSinceLastRequest = (now - history.lastLoanRequest) / 60_000;
      if (minsSinceLastRequest < 10) {
        flags.push({
          code:     "RAPID_LOAN_REAPPLICATION",
          severity: "HIGH",
          detail:   `Loan requested again ${minsSinceLastRequest.toFixed(1)} min after previous`,
        });
      }
    }

    // Update history
    this.walletHistory.set(wallet, { ...history, lastLoanRequest: now });

    // Compute overall risk
    const criticals = flags.filter(f => f.severity === "CRITICAL").length;
    const highs     = flags.filter(f => f.severity === "HIGH").length;

    let overallRisk = "CLEAN";
    if (criticals > 0)         overallRisk = "CRITICAL";
    else if (highs >= 2)       overallRisk = "HIGH";
    else if (highs >= 1)       overallRisk = "MEDIUM";
    else if (flags.length > 0) overallRisk = "LOW";

    if (overallRisk === "CRITICAL") {
      this.flaggedWallets.add(wallet);
    }

    return {
      wallet,
      flags,
      overallRisk,
      flagCount:     flags.length,
      isFlagged:     this.flaggedWallets.has(wallet),
      recommendation: this._recommendation(overallRisk),
    };
  }

  _recommendation(risk) {
    switch (risk) {
      case "CRITICAL": return "REJECT";
      case "HIGH":     return "REJECT";
      case "MEDIUM":   return "CAUTION";  // Reduce loan amount
      case "LOW":      return "APPROVE";
      default:         return "APPROVE";
    }
  }

  isFlagged(wallet) {
    return this.flaggedWallets.has(wallet);
  }

  clearFlag(wallet) {
    this.flaggedWallets.delete(wallet);
  }

  getFlaggedWallets() {
    return Array.from(this.flaggedWallets);
  }
}

const behaviorDetector = new BehavioralRiskDetector();
module.exports = { behaviorDetector, BehavioralRiskDetector };
