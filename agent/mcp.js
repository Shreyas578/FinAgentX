/**
 * FinAgentX — MCP Tool Definitions
 * Model Context Protocol tools for structured agent actions.
 * Each tool is a named, typed function with schema validation.
 */

const axios = require("axios");
const { wdk } = require("./wdk");

const ML_API = process.env.ML_API_URL || "http://localhost:8000";

/**
 * MCP Tool Registry
 * Each tool has: name, description, input_schema, execute()
 */
const TOOLS = {

  // ── Tool 1: Fetch Borrower On-Chain Data ─────────────────────────────────
  fetch_borrower_data: {
    name: "fetch_borrower_data",
    description: "Fetches on-chain data for a borrower wallet to generate ML features",
    input_schema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Borrower wallet address" },
      },
      required: ["wallet"],
    },
    async execute({ wallet }) {
      try {
        await wdk.init();
        const [balance, txCount, creditProfile] = await Promise.all([
          wdk.getWalletBalance(wallet),
          wdk.getWalletTxCount(wallet),
          wdk.getCreditProfile(wallet),
        ]);

        // Derive ML features from on-chain data
        const features = {
          tx_frequency:       Math.min(txCount / 3, 200),  // normalize to monthly
          avg_balance:        parseFloat(balance.eth),
          balance_volatility: parseFloat(balance.eth) > 0
            ? Math.min(1 / parseFloat(balance.eth), 2)    // rough volatility proxy
            : 2.0,
          repayment_history:  creditProfile.repaymentRate / 100,
          failed_repayments:  creditProfile.failedRepayments,
          days_since_active:  creditProfile.lastUpdated > 0
            ? Math.floor((Date.now() / 1000 - creditProfile.lastUpdated) / 86400)
            : 30,
        };

        return { wallet, balance, txCount, creditProfile, features };
      } catch (err) {
        throw new Error(`fetch_borrower_data failed: ${err.message}`);
      }
    },
  },

  // ── Tool 2: Run ML Prediction ─────────────────────────────────────────────
  run_ml_prediction: {
    name: "run_ml_prediction",
    description: "Runs ensemble ML prediction to assess borrower default risk",
    input_schema: {
      type: "object",
      properties: {
        features: { type: "object", description: "Borrower feature vector" },
        wallet:   { type: "string" },
      },
      required: ["features"],
    },
    async execute({ features, wallet }) {
      try {
        const res = await axios.post(`${ML_API}/predict`, {
          ...features,
          wallet,
        }, { timeout: 10_000 });
        return res.data;
      } catch (err) {
        throw new Error(`run_ml_prediction failed: ${err.message}`);
      }
    },
  },

  // ── Tool 3: Execute Loan Approval ─────────────────────────────────────────
  execute_loan_approval: {
    name: "execute_loan_approval",
    description: "Approves a loan on-chain via the LoanManager contract",
    input_schema: {
      type: "object",
      properties: {
        loanId:           { type: "number" },
        interestRateBps:  { type: "number" },
        defaultProbBps:   { type: "number" },
        explanation:      { type: "string" },
      },
      required: ["loanId", "interestRateBps", "defaultProbBps", "explanation"],
    },
    async execute({ loanId, interestRateBps, defaultProbBps, explanation }) {
      return wdk.approveLoan(loanId, interestRateBps, defaultProbBps, explanation);
    },
  },

  // ── Tool 4: Execute Loan Rejection ────────────────────────────────────────
  execute_loan_rejection: {
    name: "execute_loan_rejection",
    description: "Rejects a loan request on-chain",
    input_schema: {
      type: "object",
      properties: {
        loanId: { type: "number" },
        reason: { type: "string" },
      },
      required: ["loanId", "reason"],
    },
    async execute({ loanId, reason }) {
      return wdk.rejectLoan(loanId, reason);
    },
  },

  // ── Tool 5: Monitor Active Loans ──────────────────────────────────────────
  monitor_repayments: {
    name: "monitor_repayments",
    description: "Checks active loans for overdue status and triggers liquidation",
    input_schema: {
      type: "object",
      properties: {
        loanIds: { type: "array", items: { type: "number" } },
      },
      required: ["loanIds"],
    },
    async execute({ loanIds }) {
      const results = [];
      for (const id of loanIds) {
        try {
          const loan     = await wdk.getLoan(id);
          const overdue  = await wdk.isOverdue(id);
          results.push({ loanId: id, loan, overdue });
        } catch (e) {
          results.push({ loanId: id, error: e.message });
        }
      }
      return results;
    },
  },

  // ── Tool 6: Liquidate Overdue Loan ───────────────────────────────────────
  liquidate_loan: {
    name: "liquidate_loan",
    description: "Liquidates an overdue loan on-chain",
    input_schema: {
      type: "object",
      properties: {
        loanId: { type: "number" },
      },
      required: ["loanId"],
    },
    async execute({ loanId }) {
      return wdk.liquidateLoan(loanId);
    },
  },

  // ── Tool 6b: Collect Autonomous Repayment ────────────────────────────────
  collect_repayment: {
    name: "collect_repayment",
    description: "Autonomously collects repayment for an active loan if approved by borrower",
    input_schema: {
      type: "object",
      properties: {
        loanId: { type: "number" },
      },
      required: ["loanId"],
    },
    async execute({ loanId }) {
      return wdk.collectRepayment(loanId);
    },
  },

  // ── Tool 7: Record Loan Outcome (for continuous learning) ─────────────────
  record_outcome: {
    name: "record_outcome",
    description: "Records real loan outcome for ML model continuous learning",
    input_schema: {
      type: "object",
      properties: {
        wallet:         { type: "string" },
        features:       { type: "object" },
        actual_default: { type: "boolean" },
        loan_amount:    { type: "number" },
      },
      required: ["wallet", "features", "actual_default", "loan_amount"],
    },
    async execute({ wallet, features, actual_default, loan_amount }) {
      try {
        const res = await axios.post(`${ML_API}/outcome`, {
          wallet,
          ...features,
          actual_default,
          loan_amount,
        }, { timeout: 5000 });
        return res.data;
      } catch (err) {
        console.warn(`[MCP] record_outcome failed: ${err.message}`);
        return { status: "failed", error: err.message };
      }
    },
  },

  // ── Tool 8: Get Pool Stats ────────────────────────────────────────────────
  get_pool_stats: {
    name: "get_pool_stats",
    description: "Gets current lending pool statistics",
    input_schema: { type: "object", properties: {} },
    async execute() {
      return wdk.getPoolStats();
    },
  },
};

/**
 * Execute an MCP tool by name with given input.
 */
async function executeTool(toolName, input) {
  const tool = TOOLS[toolName];
  if (!tool) throw new Error(`Unknown MCP tool: ${toolName}`);
  return tool.execute(input);
}

/**
 * Get all tool schemas (for LLM function calling format)
 */
function getToolSchemas() {
  return Object.values(TOOLS).map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

module.exports = { TOOLS, executeTool, getToolSchemas };
