/**
 * FinAgentX — LLM Integration (Ollama Gemma:2b via WSL)
 * Handles loan negotiation, decision explanation, capital strategy,
 * and agent-to-agent economic communication.
 *
 * Ollama is running in WSL at http://localhost:11434
 */

const axios = require("axios");

const OLLAMA_URL   = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma:2b";
const TIMEOUT_MS   = 120_000;

class LLMAgent {
  constructor() {
    this.model    = OLLAMA_MODEL;
    this.baseUrl  = OLLAMA_URL;
    this.available = null; // null = not checked yet
  }

  async checkAvailability() {
    try {
      const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 3000 });
      const models = res.data?.models?.map(m => m.name) || [];
      this.available = models.some(m => m.includes("gemma"));
      if (!this.available) {
        console.warn(`[LLM] ⚠️  Gemma not found in Ollama. Available: ${models.join(", ")}`);
      } else {
        console.log(`[LLM] ✅ Ollama connected (${this.model} ready via WSL)`);
      }
      return this.available;
    } catch (e) {
      console.warn(`[LLM] ⚠️  Ollama not reachable at ${this.baseUrl}: ${e.message}`);
      this.available = false;
      return false;
    }
  }

  async generate(prompt, options = {}) {
    if (this.available === null) await this.checkAvailability();
    if (!this.available) return this._fallback(prompt);

    try {
      const res = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model:  this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            top_p:       options.top_p       ?? 0.9,
            num_predict: options.max_tokens  ?? 300,
          },
        },
        { timeout: TIMEOUT_MS }
      );
      return res.data?.response?.trim() || "";
    } catch (err) {
      console.error(`[LLM] Generation failed: ${err.message}`);
      return this._fallback(prompt);
    }
  }

  // ── 1. Loan Negotiation ────────────────────────────────────────────────────
  async negotiateTerms(borrowerInfo) {
    const { wallet, amount, duration, creditScore, defaultProb, uncertainty } = borrowerInfo;

    const prompt = `You are FinAgentX, an autonomous AI lending agent on Ethereum Sepolia.

BORROWER REQUEST:
- Wallet: ${wallet}
- Requested Amount: ${amount} USDT
- Duration: ${duration} days
- ML Credit Score: ${creditScore}/100
- Default Probability: ${(defaultProb * 100).toFixed(1)}%
- Model Uncertainty: ${uncertainty}

TASK: Negotiate the loan terms. Respond in JSON format:
{
  "recommended_amount": <number>,
  "recommended_rate_bps": <number between 200-3000>,
  "recommended_duration_days": <number>,
  "negotiation_note": "<short reasoning>"
}

Be conservative if uncertainty is HIGH. Be fair if LOW. 

IMPORTANT: Provide ONLY the JSON object. Do not include any introductory or concluding text.`;

    const raw = await this.generate(prompt, { temperature: 0.4, max_tokens: 200 });
    return this._parseJSON(raw, {
      recommended_amount:       parseFloat(amount) * 0.9,
      recommended_rate_bps:     Math.round(500 + defaultProb * 2000),
      recommended_duration_days: parseInt(duration),
      negotiation_note:         "Default terms (LLM unavailable)",
    });
  }

  // ── 2. Decision Explanation ─────────────────────────────────────────────────
  async explainDecision(evaluationResult) {
    const { decision, defaultProb, creditScore, modelVariance, rejectionReason,
            wallet, amount, interestRate, uncertainty } = evaluationResult;

    const prompt = `You are FinAgentX, a sophisticated autonomous AI lending agent. Provide a data-driven explanation for this lending decision.

CONTEXT:
- Decision: ${decision}
- Borrower Wallet: ${wallet}
- Loan Amount: ${amount} USDT
- ML Credit Score: ${creditScore}/100
- Default Probability: ${(defaultProb * 100).toFixed(2)}%
- Model Variance (Risk): ${modelVariance.toFixed(6)}
- Confidence Level: ${uncertainty || "NORMAL"}
${decision === "APPROVE" ? `- Final Interest Rate: ${(interestRate / 100).toFixed(2)}%` : `- ML Rejection Reason: ${rejectionReason}`}

STRICT GUIDELINE:
1. Do NOT use generic phrases like "strong credit score" or "high confidence" unless the numbers actually support it.
2. Specifically mention at least TWO metrics from the CONTEXT above (e.g. mention the exact default probability or interest rate).
3. If uncertainty is HIGH, explain how that influenced the decision.
4. Keep it to 2-3 concise, professional sentences. 
5. Vary your vocabulary; avoid repeating the same sentence structure for every loan.

EXPLANATION:`;

    return this.generate(prompt, { temperature: 0.8, max_tokens: 200 });
  }

  // ── 3. Capital Strategy ─────────────────────────────────────────────────────
  async suggestCapitalStrategy(poolStats, recentOutcomes) {
    const defaultRate = recentOutcomes.length > 0
      ? (recentOutcomes.filter(o => o.defaulted).length / recentOutcomes.length * 100).toFixed(1)
      : 0;

    const prompt = `You are FinAgentX's capital allocation AI. Analyze the lending pool and provide strategy.

POOL STATUS:
- Available Liquidity: ${poolStats.availableLiquidity} USDT
- Utilization Rate: ${poolStats.utilizationRate}%
- Total Deposited: ${poolStats.totalDeposited} USDT
- Total Borrowed: ${poolStats.totalBorrowed} USDT
- Interest Earned: ${poolStats.totalInterestEarned} USDT
- Recent Default Rate: ${defaultRate}%

Provide a JSON capital strategy:
{
  "action": "EXPAND_LENDING" | "TIGHTEN_REQUIREMENTS" | "HOLD" | "INCREASE_RESERVES",
  "max_single_loan_pct": <number 1-20>,
  "target_utilization_pct": <number 40-80>,
  "suggested_base_rate_bps": <number 100-2000>,
  "reasoning": "<one sentence>"
}

IMPORTANT: Provide ONLY the JSON object. Do not include any introductory or concluding text.`;

    const raw = await this.generate(prompt, { temperature: 0.3, max_tokens: 200 });
    return this._parseJSON(raw, {
      action: "HOLD",
      max_single_loan_pct: 10,
      target_utilization_pct: 60,
      suggested_base_rate_bps: 500,
      reasoning: "Default strategy (LLM unavailable)",
    });
  }

  // ── 4. Agent-to-Agent Negotiation ──────────────────────────────────────────
  async negotiateWithAgent(counterAgent, proposal) {
    const prompt = `You are FinAgentX, an autonomous lending agent negotiating with another agent.

THEIR PROPOSAL:
- Agent: ${counterAgent}
- Loan Amount: ${proposal.amount} USDT
- Offered Rate: ${proposal.rate_bps / 100}%
- Duration: ${proposal.duration_days} days
- Their Credit Score: ${proposal.credit_score}/100

As a rational economic agent, decide and respond in JSON:
{
  "response": "ACCEPT" | "COUNTER" | "REJECT",
  "counter_rate_bps": <if COUNTER, your rate>,
  "counter_amount": <if COUNTER, your amount>,
  "message": "<short negotiation message>"
}

IMPORTANT: Provide ONLY the JSON object. Do not include any introductory or concluding text.`;

    const raw = await this.generate(prompt, { temperature: 0.6, max_tokens: 150 });
    return this._parseJSON(raw, {
      response: "REJECT",
      message: "Terms not acceptable (fallback)",
    });
  }

  // ── 5. Behavioral Analysis ─────────────────────────────────────────────────
  async analyzeBehavior(behaviorFlags) {
    if (!behaviorFlags || behaviorFlags.length === 0) return null;

    const prompt = `You are a blockchain risk analyst for FinAgentX. Analyze these suspicious behaviors:

FLAGS: ${behaviorFlags.join(", ")}

Provide a risk assessment in JSON:
{
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "recommendation": "PROCEED" | "CAUTION" | "REJECT",
  "analysis": "<one sentence>"
}

IMPORTANT: Provide ONLY the JSON object. Do not include any introductory or concluding text.`;

    const raw = await this.generate(prompt, { temperature: 0.2, max_tokens: 120 });
    return this._parseJSON(raw, {
      risk_level: "MEDIUM",
      recommendation: "CAUTION",
      analysis: "Behavioral analysis unavailable (LLM offline)",
    });
  }

  _parseJSON(text, fallback) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_) {
      console.warn(`[LLM] ⚠️  JSON Parse Error. Raw response: "${text.substring(0, 500)}..."`);
    }
    return fallback;
  }

  _fallback(prompt) {
    // Return a simple default without LLM
    if (prompt.includes("DECISION")) return "Loan evaluated by ML models. AI explanation unavailable (Ollama offline).";
    return "";
  }
}

const llm = new LLMAgent();
module.exports = { llm, LLMAgent };
