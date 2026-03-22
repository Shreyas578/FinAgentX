/**
 * FinAgentX — DID-Based Credit Identity
 * Persistent wallet-linked credit history stored both on-chain (CreditScore.sol)
 * and off-chain (local cache) for fast agent reads.
 */

const { wdk } = require("./wdk");

class DIDCreditIdentity {
  constructor() {
    this.identities = new Map(); // wallet → CreditIdentity
  }

  /**
   * Get or create credit identity for a wallet
   */
  async getIdentity(wallet) {
    if (this.identities.has(wallet)) {
      return this.identities.get(wallet);
    }

    // Fetch from on-chain
    let profile = {
      score: 50,
      totalLoans: 0,
      successfulRepayments: 0,
      failedRepayments: 0,
      lastUpdated: 0,
      exists: false,
      repaymentRate: 100,
    };

    try {
      profile = await wdk.getCreditProfile(wallet);
    } catch (err) {
      console.warn(`[DID] Could not fetch on-chain profile for ${wallet}: ${err.message}`);
    }

    const identity = {
      did: `did:finagentx:sepolia:${wallet.toLowerCase()}`,
      wallet,
      creditScore:          profile.score,
      totalLoans:           profile.totalLoans,
      successfulRepayments: profile.successfulRepayments,
      failedRepayments:     profile.failedRepayments,
      repaymentRate:        profile.repaymentRate,
      lastUpdated:          profile.lastUpdated,
      exists:               profile.exists,
      interactionHistory:   [],
      zkProofHash:          this._generateZKProofHash(wallet, profile.score), // Conceptual ZK proof
    };

    this.identities.set(wallet, identity);
    return identity;
  }

  /**
   * Update identity after a loan event
   */
  updateAfterLoan(wallet, event) {
    const identity = this.identities.get(wallet);
    if (!identity) return;

    identity.interactionHistory.push({
      event,
      timestamp: Date.now(),
    });

    if (event.type === "APPROVED") {
      identity.totalLoans++;
    } else if (event.type === "REPAID") {
      identity.successfulRepayments++;
      identity.creditScore = Math.min(identity.creditScore + 5, 100);
    } else if (event.type === "DEFAULTED") {
      identity.failedRepayments++;
      identity.creditScore = Math.max(identity.creditScore - 15, 0);
    }

    identity.lastUpdated = Date.now() / 1000;
    identity.repaymentRate = identity.totalLoans > 0
      ? Math.round(identity.successfulRepayments / identity.totalLoans * 100)
      : 100;
    identity.zkProofHash = this._generateZKProofHash(wallet, identity.creditScore);
  }

  /**
   * Conceptual ZK credit proof:
   * In production this would be a real ZK-SNARK proving score > threshold
   * without revealing the actual score.
   */
  _generateZKProofHash(wallet, score) {
    const data = `${wallet}:${score}:${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    return `zkp_${Math.abs(hash).toString(16).padStart(16, "0")}`;
  }

  /**
   * Verify credit threshold without revealing score (ZK-conceptual)
   */
  verifyCreditThreshold(wallet, threshold) {
    const identity = this.identities.get(wallet);
    if (!identity) return { verified: false, proof: null };
    return {
      verified:  identity.creditScore >= threshold,
      proof:     identity.zkProofHash,
      threshold,
      // Note: In production, use actual ZK-SNARK library (e.g., snarkjs)
    };
  }

  getAllIdentities() {
    return Array.from(this.identities.values());
  }
}

const didRegistry = new DIDCreditIdentity();
module.exports = { didRegistry, DIDCreditIdentity };
