/**
 * FinAgentX — Self-Growing Treasury Manager
 * Tracks capital flows, reinvests profits, and optimizes allocation.
 * Implements the "self-growing treasury" via automated profit reinvestment.
 */

const { wdk } = require("./wdk");

class TreasuryManager {
  constructor() {
    this.stats = {
      totalProfit:         0,
      totalReinvested:     0,
      reinvestCycles:      0,
      capitalGrowthRate:   0,
      recentOutcomes:      [],
    };
    this.reinvestThreshold = parseFloat(process.env.REINVEST_THRESHOLD || "100"); // Min USDT to reinvest
  }

  /**
   * Record a realized profit from a repaid loan
   */
  recordProfit(loanId, principal, interest) {
    const profit = parseFloat(interest);
    this.stats.totalProfit += profit;
    this.stats.recentOutcomes.push({
      loanId, principal: parseFloat(principal),
      interest: profit, defaulted: false, timestamp: Date.now(),
    });
    // Keep last 100 outcomes
    if (this.stats.recentOutcomes.length > 100) {
      this.stats.recentOutcomes.shift();
    }
    console.log(`[Treasury] 💰 Profit recorded: +${profit.toFixed(2)} USDT (loan #${loanId})`);
  }

  recordLoss(loanId, amount) {
    this.stats.recentOutcomes.push({
      loanId, principal: parseFloat(amount),
      interest: 0, defaulted: true, timestamp: Date.now(),
    });
    if (this.stats.recentOutcomes.length > 100) this.stats.recentOutcomes.shift();
    console.log(`[Treasury] ❌ Loss recorded: -${amount} USDT (loan #${loanId})`);
  }

  /**
   * Analyze pool and decide if profits should be reinvested as new lending capacity
   */
  async analyzeTreasury() {
    try {
      const poolStats = await wdk.getPoolStats();
      const unreinvested = this.stats.totalProfit - this.stats.totalReinvested;

      const recentDefaults = this.stats.recentOutcomes
        .slice(-20)
        .filter(o => o.defaulted).length;

      const defaultRate = this.stats.recentOutcomes.length > 0
        ? recentDefaults / Math.min(this.stats.recentOutcomes.length, 20)
        : 0;

      let recommendation = "HOLD";
      let action = null;

      if (parseFloat(poolStats.utilizationRate) > 80 && unreinvested >= this.reinvestThreshold) {
        // Pool is highly utilized, reinvest profits
        recommendation = "REINVEST";
        action = `Reinvest ${unreinvested.toFixed(2)} USDT profit into lending capacity`;
        this.stats.totalReinvested += unreinvested;
        this.stats.reinvestCycles++;
        console.log(`[Treasury] ♻️  Reinvesting ${unreinvested.toFixed(2)} USDT (cycle #${this.stats.reinvestCycles})`);
      } else if (defaultRate > 0.3) {
        recommendation = "TIGHTEN";
        action = "Tighten lending requirements — default rate above 30%";
      } else if (parseFloat(poolStats.utilizationRate) < 30) {
        recommendation = "EXPAND";
        action = "Expand lending — utilization too low, capital underdeployed";
      }

      // Compute capital growth rate
      const totalIn = parseFloat(poolStats.totalDeposited) || 1;
      this.stats.capitalGrowthRate = this.stats.totalInterestEarned / totalIn;

      return {
        poolStats,
        unreinvestedProfit: unreinvested.toFixed(2),
        defaultRate:        (defaultRate * 100).toFixed(1) + "%",
        recommendation,
        action,
        stats: this.getStats(),
      };
    } catch (err) {
      console.error(`[Treasury] Analysis failed: ${err.message}`);
      return { error: err.message };
    }
  }

  getStats() {
    const recent20 = this.stats.recentOutcomes.slice(-20);
    const defaults  = recent20.filter(o => o.defaulted).length;

    return {
      totalProfit:       this.stats.totalProfit.toFixed(2),
      totalReinvested:   this.stats.totalReinvested.toFixed(2),
      reinvestCycles:    this.stats.reinvestCycles,
      recentDefaultRate: recent20.length > 0 ? `${(defaults / recent20.length * 100).toFixed(1)}%` : "N/A",
      totalOutcomes:     this.stats.recentOutcomes.length,
    };
  }

  getRecentOutcomes() {
    return this.stats.recentOutcomes.slice(-50);
  }
}

const treasury = new TreasuryManager();
module.exports = { treasury, TreasuryManager };
