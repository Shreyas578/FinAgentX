/**
 * FinAgentX — Agent-to-Agent Lending Marketplace
 * Enables autonomous agents to lend/borrow between each other.
 * Each agent posts offers, negotiates via LLM, and settles on-chain.
 */

const { llm } = require("./llm");
const { wdk } = require("./wdk");

class AgentMarketplace {
  constructor() {
    this.offers     = new Map(); // offerId → LendingOffer
    this.activePairs = new Map(); // agentA → agentB
    this.settlements  = [];
    this.nextOfferId  = 1;
  }

  /**
   * Post a lending offer to the marketplace
   */
  postOffer(agentAddress, amountUsdt, rateBps, durationDays, minCreditScore = 40) {
    const offerId = this.nextOfferId++;
    const offer = {
      offerId,
      lender:          agentAddress,
      amount:          amountUsdt,
      rateBps,
      durationDays,
      minCreditScore,
      postedAt:        Date.now(),
      status:          "OPEN",
    };
    this.offers.set(offerId, offer);
    console.log(`[Market] 📢 Offer #${offerId}: ${agentAddress.slice(0, 8)}… lends ${amountUsdt} USDT @ ${rateBps/100}%`);
    return offer;
  }

  /**
   * Browse available offers (filtered by credit score eligibility)
   */
  getAvailableOffers(borrowerCreditScore) {
    return Array.from(this.offers.values())
      .filter(o => o.status === "OPEN" && borrowerCreditScore >= o.minCreditScore)
      .sort((a, b) => a.rateBps - b.rateBps); // Cheapest first
  }

  /**
   * Negotiate terms between two agents via LLM
   */
  async negotiate(borrowerAgent, lendingOfferId, creditScore) {
    const offer = this.offers.get(lendingOfferId);
    if (!offer || offer.status !== "OPEN") {
      return { success: false, reason: "Offer not available" };
    }

    const proposal = {
      amount:       offer.amount,
      rate_bps:     offer.rateBps,
      duration_days: offer.durationDays,
      credit_score:  creditScore,
    };

    console.log(`[Market] 🤝 Negotiating: ${borrowerAgent.slice(0, 8)}… → ${offer.lender.slice(0, 8)}…`);

    // LLM negotiation round (from lender's perspective)
    const lenderResponse = await llm.negotiateWithAgent(borrowerAgent, proposal);

    if (lenderResponse.response === "ACCEPT") {
      offer.status = "MATCHED";
      const settlement = {
        offerId:         lendingOfferId,
        lender:          offer.lender,
        borrower:        borrowerAgent,
        amount:          offer.amount,
        finalRateBps:    offer.rateBps,
        durationDays:    offer.durationDays,
        agreedAt:        Date.now(),
        txHash:          null, // Set after on-chain execution
      };
      this.settlements.push(settlement);
      this.activePairs.set(borrowerAgent, offer.lender);
      return { success: true, terms: settlement, message: lenderResponse.message };

    } else if (lenderResponse.response === "COUNTER") {
      // One counter-offer round
      const counterOffer = {
        amount:       lenderResponse.counter_amount || offer.amount * 0.8,
        rate_bps:     lenderResponse.counter_rate_bps || offer.rateBps * 1.2,
        duration_days: offer.durationDays,
        credit_score:  creditScore,
      };
      // Borrower auto-accepts if counter-rate is reasonable
      if (counterOffer.rate_bps <= offer.rateBps * 1.5) {
        offer.status = "MATCHED";
        const settlement = {
          offerId:       lendingOfferId,
          lender:        offer.lender,
          borrower:      borrowerAgent,
          amount:        counterOffer.amount,
          finalRateBps:  counterOffer.rate_bps,
          durationDays:  offer.durationDays,
          agreedAt:      Date.now(),
          txHash:        null,
        };
        this.settlements.push(settlement);
        return { success: true, terms: settlement, message: lenderResponse.message, isCounter: true };
      }
      return { success: false, reason: "Counter-offer rejected", counter: counterOffer };

    } else {
      return { success: false, reason: lenderResponse.message || "Rejected by lender" };
    }
  }

  getMarketStats() {
    const offers = Array.from(this.offers.values());
    return {
      totalOffers:    offers.length,
      openOffers:     offers.filter(o => o.status === "OPEN").length,
      matchedOffers:  offers.filter(o => o.status === "MATCHED").length,
      settlements:    this.settlements.length,
      activePairs:    this.activePairs.size,
    };
  }

  getSettlements() {
    return this.settlements.slice(-20);
  }
}

const agentMarket = new AgentMarketplace();
module.exports = { agentMarket, AgentMarketplace };
