/**
 * FinAgentX — Autonomous Agent Main Loop
 * ==========================================
 * This is the core autonomous lending agent. It runs continuously,
 * listening for on-chain loan requests and executing the full 12-step loop:
 *
 * 1.  Listen for loan requests
 * 2.  Fetch borrower on-chain data
 * 3.  Generate ML features
 * 4.  Run ALL ML models (ensemble)
 * 5.  Combine predictions + compute risk
 * 6.  Run behavioral risk detection
 * 7.  Compute uncertainty + confidence-aware adjustments
 * 8.  Call LLM (Gemma 2B): negotiate terms + generate explanation
 * 9.  Decide: APPROVE / REJECT / ADJUST TERMS
 * 10. Execute transaction via WDK (on-chain)
 * 11. Monitor repayments + trigger penalties
 * 12. Reallocate capital (treasury optimizer)
 *
 * "An autonomous on-chain AI bank that evaluates risk, lends capital,
 *  and manages debt without human intervention."
 */

const { wdk }              = require("./wdk");
const { llm }              = require("./llm");
const { riskEngine }       = require("./riskEngine");
const { treasury }         = require("./treasury");
const { didRegistry }      = require("./did");
const { behaviorDetector } = require("./behaviorDetector");
const { agentMarket }      = require("./agentMarket");
const { executeTool }      = require("./mcp");

const WebSocket  = require("ws");
const express    = require("express");
const cron       = require("node-cron");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const PORT            = parseInt(process.env.AGENT_PORT || "3001");
const POLL_INTERVAL   = parseInt(process.env.POLL_INTERVAL_MS || "15000");  // 15s
const MONITOR_INTERVAL = 60 * 1000; // 1 minute

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  running:         false,
  processedLoans:  new Set(),
  activeMonitor:   new Map(), // loan IDs -> features
  pendingQueue:    [],        // incoming loan requests to process
  recentOutcomes:  [],
  startedAt:       null,
  loopCycles:      0,
};

// WebSocket broadcast channels
let wss = null;
const broadcast = (type, payload) => {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
};

// ── Step 1-12: Single Loan Evaluation Pipeline ───────────────────────────────
async function processLoanRequest(loanId, borrower, requestedAmount, durationSec, assetSymbol = "USDT") {
  if (state.processedLoans.has(loanId)) return;
  state.processedLoans.add(loanId);

  const stepLog = (step, msg, data = {}) => {
    const entry = { step, msg, loanId, borrower: borrower.slice(0, 10) + "…", ...data };
    console.log(`[Agent] Step ${step}: ${msg}`);
    broadcast("LOAN_STEP", entry);
    return entry;
  };

  try {
    stepLog(1, "Loan request received", { amount: requestedAmount, duration: durationSec, asset: assetSymbol });

    // ── Step 2: Fetch on-chain data via MCP ─────────────────────────────────
    stepLog(2, "Fetching borrower on-chain data");
    const borrowerData = await executeTool("fetch_borrower_data", { wallet: borrower, assetSymbol });
    const { features, balance, txCount, creditProfile } = borrowerData;
    stepLog(2, "On-chain data ready", { txCount, eth: balance.eth, usdt: balance.usdt });

    // Step 3: Features generated (included in step 2)
    stepLog(3, "ML features generated", features);

    // ── Step 4-5: Run ML ensemble ────────────────────────────────────────────
    stepLog(4, "Running ML ensemble (Linear + Ridge + Lasso + RandomForest)");
    const evaluation = await riskEngine.evaluateBorrower(borrower, requestedAmount);
    const ml = evaluation.ml;
    stepLog(5, `Ensemble complete: default_prob=${(ml.default_prob * 100).toFixed(1)}%`,
      { creditScore: ml.credit_score, decision: ml.decision, variance: ml.model_variance });

    // ── Step 6: Behavioral risk detection ────────────────────────────────────
    stepLog(6, "Running behavioral risk detection");
    const behavior = behaviorDetector.analyze(
      borrower, features, creditProfile, txCount
    );
    stepLog(6, `Behavior: ${behavior.overallRisk} (${behavior.flagCount} flags)`,
      { flags: behavior.flags.map(f => f.code) });

    // Credit identity update
    await didRegistry.getIdentity(borrower);

    // ── Step 7: Compute final risk + uncertainty ──────────────────────────────
    stepLog(7, "Computing risk + uncertainty adjustments");

    // Override to reject if behavioral risk is critical
    let finalDecision = ml.decision;
    if (behavior.recommendation === "REJECT") {
      finalDecision = "REJECT";
    } else if (behavior.recommendation === "CAUTION" && ml.default_prob > 0.4) {
      finalDecision = "REJECT";
    }

    // ── Step 8: LLM — negotiate + explain ────────────────────────────────────
    stepLog(8, "Calling LLM (Gemma 2B) for negotiation + explanation");

    let finalTerms = {
      recommended_amount:       parseFloat(requestedAmount),
      recommended_rate_bps:     evaluation.interestRateBps,
      recommended_duration_days: 30,
      negotiation_note:         "Standard terms",
    };

    let explanation = "";

    if (finalDecision === "APPROVE") {
      // Negotiate terms
      finalTerms = await llm.negotiateTerms({
        wallet:      borrower,
        amount:      requestedAmount,
        duration:    (durationSec / 86400).toFixed(4), // Convert to days for LLM prompt
        creditScore: ml.credit_score,
        defaultProb: ml.default_prob,
        uncertainty: ml.uncertainty_level,
      });

      // Generate explanation
      explanation = await llm.explainDecision({
        decision:      "APPROVE",
        defaultProb:   ml.default_prob,
        creditScore:   ml.credit_score,
        modelVariance: ml.model_variance,
        wallet:        borrower,
        amount:        requestedAmount,
        interestRate:  finalTerms.recommended_rate_bps,
        uncertainty:   ml.uncertainty_level,
      });
    } else {
      explanation = await llm.explainDecision({
        decision:       "REJECT",
        defaultProb:    ml.default_prob,
        creditScore:    ml.credit_score,
        modelVariance:  ml.model_variance,
        wallet:         borrower,
        amount:         requestedAmount,
        rejectionReason: ml.rejection_reason || behavior.flags.map(f => f.code).join(", "),
        uncertainty:    ml.uncertainty_level,
      });
    }

    stepLog(8, `LLM response: ${explanation.substring(0, 60)}…`);

    // ── Step 9: Final decision ────────────────────────────────────────────────
    stepLog(9, `DECISION: ${finalDecision} for loan #${loanId}`);
    broadcast("LOAN_DECISION", {
      loanId, borrower, decision: finalDecision,
      creditScore:   ml.credit_score,
      defaultProb:   ml.default_prob,
      interestRate:  finalTerms.recommended_rate_bps / 100,
      explanation,
    });

    // ── Step 10: Execute on-chain via WDK ────────────────────────────────────
    stepLog(10, "Executing on-chain via WDK (MetaMask self-custodial)");
    const defaultProbBps = Math.round(ml.default_prob * 10000);

    if (finalDecision === "APPROVE") {
      await executeTool("execute_loan_approval", {
        loanId,
        interestRateBps: Math.round(finalTerms.recommended_rate_bps),
        defaultProbBps,
        explanation:     explanation || "ML approved",
      });
      state.activeMonitor.set(loanId, features);
      stepLog(10, `✅ Loan #${loanId} APPROVED on-chain`);
      didRegistry.updateAfterLoan(borrower, { type: "APPROVED", loanId });
    } else {
      await executeTool("execute_loan_rejection", {
        loanId,
        reason: explanation || ml.rejection_reason || "Risk threshold exceeded",
      });
      stepLog(10, `❌ Loan #${loanId} REJECTED on-chain`);
    }

    broadcast("LOAN_EXECUTED", { loanId, decision: finalDecision, txHash: "confirmed" });

  } catch (err) {
    console.error(`[Agent] ❌ Error processing loan #${loanId}:`, err.message);
    broadcast("LOAN_ERROR", { loanId, error: err.message });
  }
}

// ── Step 11: Monitor active loans for repayments/defaults ────────────────────
async function monitorActiveLoans() {
  if (state.activeMonitor.size === 0) return;

  const loanIds = Array.from(state.activeMonitor.keys());
  const results = await executeTool("monitor_repayments", { loanIds });

  for (const result of results) {
    if (result.error) continue;
    const { loanId, loan, overdue } = result;
    const features = state.activeMonitor.get(loanId) || {};

    // Status 2 = Repaid
    if (loan.status === 2) {
      state.activeMonitor.delete(loanId);
      treasury.recordProfit(loanId, loan.amount, "0"); 
      await executeTool("record_outcome", {
        wallet:         loan.borrower,
        features:       features,
        actual_default: false,
        loan_amount:    parseFloat(loan.amount),
      });
      didRegistry.updateAfterLoan(loan.borrower, { type: "REPAID", loanId });
      didRegistry.updateAfterLoan(loan.borrower, { type: "REPAID", loanId });
      broadcast("LOAN_REPAID", { loanId, borrower: loan.borrower, amount: loan.amount, asset: loan.assetSymbol });
      console.log(`[Agent] 💚 Loan #${loanId} repaid by ${loan.borrower.slice(0, 10)}…`);
    }

    // Overdue → Try autonomous collection first, then liquidate
    if (overdue && loan.status === 1) {
      console.log(`[Agent] ⏳ Loan #${loanId} is DUE (${loan.assetSymbol}) — attempting autonomous collection`);
      
      try {
        await executeTool("collect_repayment", { loanId });
        broadcast("LOAN_COLLECTED", { loanId, borrower: loan.borrower, asset: loan.assetSymbol });
        console.log(`[Agent] ✨ Successfully collected repayment for #${loanId} autonomously`);
        continue; // Successfully repaid, skip liquidation
      } catch (collectErr) {
        console.warn(`[Agent] ⚠️ Autonomous collection failed for #${loanId}: ${collectErr.message}`);
        console.log(`[Agent] 🔴 Proceeding to liquidation for #${loanId}`);
      }

      try {
        await executeTool("liquidate_loan", { loanId });
        
        // Remove from monitor immediately to prevent retries
        state.activeMonitor.delete(loanId);
        
        treasury.recordLoss(loanId, loan.amount);
        await executeTool("record_outcome", {
          wallet:         loan.borrower,
          features:       features,
          actual_default: true,
          loan_amount:    parseFloat(loan.amount),
        });
        didRegistry.updateAfterLoan(loan.borrower, { type: "DEFAULTED", loanId });
        broadcast("LOAN_LIQUIDATED", { loanId, borrower: loan.borrower, amount: loan.amount });
      } catch (e) {
        console.error(`[Agent] Liquidation error for #${loanId}: ${e.message}`);
        // If it failed because of "not active", it means someone else (or a previous tx) already did it
        if (e.message.includes("not active") || e.message.includes("existing active loan")) {
          state.activeMonitor.delete(loanId);
        }
      }
    }
  }
}

// ── Step 12: Capital reallocation ────────────────────────────────────────────
async function reallocateCapital() {
  const analysis = await treasury.analyzeTreasury();
  if (analysis.recommendation !== "HOLD") {
    const strategy = await llm.suggestCapitalStrategy(
      analysis.poolStats || {},
      treasury.getRecentOutcomes()
    );
    console.log(`[Agent] 💡 Capital strategy: ${strategy.action} — ${strategy.reasoning}`);
    broadcast("CAPITAL_STRATEGY", { analysis, strategy });
  }
}

// ── Polling fallback (when event listener is insufficient) ───────────────────
async function pollForNewRequests() {
  try {
    if (!wdk._initialized) return;
    const nextId = await wdk.getNextLoanId();
    for (let id = 1; id < nextId; id++) {
      if (state.processedLoans.has(id)) continue;
      try {
        const loan = await wdk.getLoan(id);
        if (loan.status === 0) {
          // Status 0 = Requested
          const duration = loan.issuedAt > 0 ? (loan.dueDate - loan.issuedAt) : 60; // fallback if not issued
          await processLoanRequest(id, loan.borrower, loan.amount, duration, loan.assetSymbol);
        } else {
          state.processedLoans.add(id);
        }
      } catch (_) {}
    }
    state.loopCycles++;
  } catch (err) {
    if (!err.message.includes("not found")) {
      console.warn(`[Agent] Poll error: ${err.message}`);
    }
  }
}

// ── REST API + WebSocket Server ───────────────────────────────────────────────
function startServer() {
  const app = express();
  app.use(require("express").json());

  // CORS
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
  });

  app.get("/health", (req, res) => res.json({
    status: "running",
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
    loopCycles: state.loopCycles,
    monitoredLoans: state.activeMonitor.size,
    processedLoans: state.processedLoans.size,
    agentAddress: wdk.getAgentAddress(),
  }));

  app.get("/treasury", async (_, res) => {
    res.json({ ...treasury.getStats(), recentOutcomes: treasury.getRecentOutcomes() });
  });

  app.get("/market", (_, res) => res.json(agentMarket.getMarketStats()));
  app.get("/market/offers", (_, res) => res.json(agentMarket.getAvailableOffers(50)));
  app.get("/market/settlements", (_, res) => res.json(agentMarket.getSettlements()));

  app.get("/pool", async (_, res) => {
    try {
      const stats = await wdk.getPoolStats();
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/identities", (_, res) => res.json(didRegistry.getAllIdentities()));

  const server = app.listen(PORT, () => {
    console.log(`[Agent] 🌐 REST API listening on http://localhost:${PORT}`);
  });

  // WebSocket
  wss = new WebSocket.Server({ server });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "CONNECTED", payload: { agentAddress: wdk.getAgentAddress() } }));
    console.log("[Agent] 🔌 Frontend connected via WebSocket");
  });
}

// ── Main Entry Point ──────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║    ███████╗██╗███╗   ██╗ █████╗  ██████╗ ███████╗███╗  ██╗  ║
║    ██╔════╝██║████╗  ██║██╔══██╗██╔════╝ ██╔════╝████╗ ██║  ║
║    █████╗  ██║██╔██╗ ██║███████║██║  ███╗█████╗  ██╔██╗██║  ║
║    ██╔══╝  ██║██║╚██╗██║██╔══██║██║   ██║██╔══╝  ██║╚████║  ║
║    ██║     ██║██║ ╚████║██║  ██║╚██████╔╝███████╗██║ ╚███║  ║
║    ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚══╝ ║
║         Autonomous On-Chain AI Lending Agent v1.0            ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Initialize
  state.startedAt = Date.now();
  startServer();

  await wdk.init();
  await llm.checkAvailability();

  // Register event listeners
  wdk.listenForLoanRequests(async ({ loanId, borrower, amount, duration, assetSymbol }) => {
    console.log(`[Agent] 📨 New loan request: #${loanId} from ${borrower.slice(0, 10)}… for ${amount} ${assetSymbol} (${duration}s)`);
    await processLoanRequest(loanId, borrower, amount, duration, assetSymbol);
  });

  wdk.listenForRepayments(({ loanId, borrower, totalRepaid }) => {
    state.activeMonitor.delete(loanId);
    treasury.recordProfit(loanId, totalRepaid, "0");
    broadcast("LOAN_REPAID", { loanId, borrower, totalRepaid });
  });

  wdk.listenForDefaults(({ loanId, borrower, amountOutstanding }) => {
    broadcast("LOAN_DEFAULTED", { loanId, borrower, amountOutstanding });
  });

  // Also poll as fallback (catches any missed events)
  const pollTimer = setInterval(pollForNewRequests, POLL_INTERVAL);

  // Monitor active loans every minute
  const monitorTimer = setInterval(monitorActiveLoans, MONITOR_INTERVAL);

  // Capital reallocation every 10 minutes
  const capitalTimer = setInterval(reallocateCapital, 10 * 60 * 1000);

  // Daily agent-to-agent market activity (post offers)
  cron.schedule("0 */6 * * *", () => {
    const agentAddr = wdk.getAgentAddress();
    if (agentAddr) {
      agentMarket.postOffer(agentAddr, 100, 800, 30, 40);
      console.log("[Agent] 📢 Posted agent-to-agent market offer");
    }
  });

  state.running = true;
  console.log("\n[Agent] 🤖 Autonomous loop running. Waiting for on-chain events…\n");

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Agent] Shutting down gracefully…");
    clearInterval(pollTimer);
    clearInterval(monitorTimer);
    clearInterval(capitalTimer);
    wdk.stopListening();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("[Agent] Fatal error:", err);
  process.exit(1);
});
