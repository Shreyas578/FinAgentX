// FinAgentX — Loan Request Component
import { useState } from 'react'
import { ethers } from 'ethers'
import addresses from '../deployed-addresses.json'

const LOAN_MANAGER_ABI = [
  "function requestLoan(uint256 amount, uint256 durationSeconds, string calldata assetSymbol) returns (uint256)",
]
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]

const USDT_ADDR = addresses?.usdt || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const LM_ADDR   = addresses?.loanManager || ''
const LP_ADDR   = addresses?.lendingPool || ''

// Score ring SVG component
function ScoreRing({ score, label, color = '#00d2ff' }) {
  const r = 52, cx = 70, cy = 70
  const circ    = 2 * Math.PI * r
  const offset  = circ * (1 - (score ?? 0) / 100)
  const getColor = (s) => {
    if (s >= 70) return '#00f5a0'
    if (s >= 40) return '#f59e0b'
    return '#ff4d6d'
  }
  const c = getColor(score ?? 50)
  return (
    <div className="score-ring">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10"/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${c})`, transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="score-value">
        <div className="score-number" style={{ color: c }}>{score?.toFixed(0) ?? '—'}</div>
        <div className="score-label">{label}</div>
      </div>
    </div>
  )
}

export default function LoanRequest({ wallet, agent, features, setFeatures }) {
  const [amount,   setAmount]   = useState('')
  const [duration, setDuration] = useState('60')
  const [mlResult, setMlResult] = useState(null)
  const [decision, setDecision] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [txStep,   setTxStep]   = useState('')
  const [error,    setError]    = useState(null)

  const previewRisk = async () => {
    if (!amount || !wallet.account) return
    setLoading(true)
    setError(null)
    try {
      // Fetch ML risk estimate from API
      const res = await fetch('http://localhost:8000/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...features,
          wallet: wallet.account,
        })
      })
      if (!res.ok) throw new Error('ML API unavailable — start the Python server')
      const data = await res.json()
      setMlResult(data)
      setDecision(data.decision)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const submitLoan = async () => {
    if (!wallet.signer || !LM_ADDR) {
      setError('Wallet not connected or contracts not deployed')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const amountUnits = ethers.parseUnits(amount, 6)
      const durationSec = parseInt(duration)

      // 1. Approve LendingPool for repayment (extra buffer)
      setTxStep('Approving USDT allowance for pool…')
      const usdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, wallet.signer)
      const approveTx = await usdt.approve(LP_ADDR, amountUnits * 2n)
      await approveTx.wait()

      // 2. Request loan
      setTxStep('Submitting loan request on-chain…')
      const lm = new ethers.Contract(LM_ADDR, LOAN_MANAGER_ABI, wallet.signer)
      const tx = await lm.requestLoan(amountUnits, durationSec, "USDT")
      const receipt = await tx.wait()

      setTxStep(`✅ Loan requested! Tx: ${receipt.hash.slice(0, 18)}…`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="two-col">
      {/* Form */}
      <div>
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Request a Loan</div>

          {!wallet.account && (
            <div style={{ padding: '12px 16px', background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>
              🦊 Please connect your MetaMask wallet first
            </div>
          )}

          <div className="form-group">
            <label htmlFor="loanAmount" className="form-label">Loan Amount (USDT)</label>
            <input
              id="loanAmount"
              name="loanAmount"
              className="form-input"
              type="number"
              placeholder="e.g. 500"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="1" max="10000"
            />
          </div>

          <div className="form-group">
            <label htmlFor="durationDays" className="form-label">Duration</label>
            <select 
              id="durationDays" 
              name="durationDays" 
              className="form-input" 
              value={duration} 
              onChange={e => setDuration(e.target.value)}
            >
              {[
                { label: '1 Minute',        val: 60 },
                { label: '5 Minutes',       val: 300 },
                { label: '30 Minutes',      val: 1800 },
                { label: '1 Hour',          val: 3600 },
                { label: '1 Day',           val: 86400 },
                { label: '7 Days',          val: 7 * 86400 },
                { label: '30 Days',         val: 30 * 86400 },
              ].map(d => (
                <option key={d.val} value={d.val} style={{ background: '#0d1526', color: '#fff' }}>{d.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-ghost" onClick={previewRisk} disabled={loading || !amount || !wallet.account}>
              {loading ? <><div className="spinner"/>Analyzing…</> : '🔍 Preview Risk'}
            </button>
            <button className="btn btn-primary" onClick={submitLoan} disabled={loading || !amount || !wallet.account || !LM_ADDR}>
              {loading ? <><div className="spinner"/>Processing…</> : '⚡ Submit On-Chain'}
            </button>
          </div>

          {txStep && <div style={{ marginTop: 14, fontSize: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{txStep}</div>}
          {error  && <div style={{ marginTop: 14, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        </div>

        {/* Explanation */}
        {mlResult?.decision === 'REJECT' && (
          <div className="card">
            <div className="card-title">⚠️ Rejection Analysis</div>
            <div className="explanation-box">
              {mlResult.rejection_reason || 'Risk threshold exceeded based on your on-chain profile.'}
            </div>
            {mlResult.individual_predictions && (
              <div style={{ marginTop: 16 }}>
                <div className="card-title">Model Breakdown</div>
                {Object.entries(mlResult.individual_predictions).map(([model, val]) => (
                  <div className="model-bar" key={model}>
                    <div className="model-bar-label">
                      <span style={{ textTransform: 'capitalize' }}>{model.replace('_', ' ')}</span>
                      <span style={{ color: val > 0.6 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                        {(val * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="model-bar-track">
                      <div className="model-bar-fill"
                        style={{ width: `${val * 100}%`, background: val > 0.6 ? 'var(--red)' : val > 0.4 ? 'var(--yellow)' : 'var(--green)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Risk Score Panel */}
      <div>
        <div className="card" style={{ marginBottom: 20, textAlign: 'center' }}>
          <div className="card-title">ML Risk Assessment</div>

          <div style={{ display: 'flex', justifyContent: 'space-around', padding: '16px 0' }}>
            <ScoreRing score={mlResult?.credit_score} label="Credit Score" />
            <ScoreRing
              score={mlResult ? (1 - mlResult.default_prob) * 100 : undefined}
              label="Safety Score"
            />
          </div>

          {mlResult && (
            <>
              <div className="glow-divider"/>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
                <span className={`badge ${decision === 'APPROVE' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 14, padding: '6px 18px' }}>
                  {decision === 'APPROVE' ? '✓ APPROVED' : '✗ REJECTED'}
                </span>
              </div>

              {mlResult.decision === 'APPROVE' && (
                <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(0,245,160,0.2)', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Estimated Interest Rate</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
                    {mlResult.interest_increase_bps
                      ? `${((500 + mlResult.interest_increase_bps) / 100).toFixed(2)}%`
                      : '5.00%'
                    }
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'left' }}>
                {[
                  { label: 'Default Probability', value: `${(mlResult.default_prob * 100).toFixed(1)}%`, warn: mlResult.default_prob > 0.4 },
                  { label: 'Model Uncertainty',   value: mlResult.uncertainty_level },
                  { label: 'Loan Reduction',      value: mlResult.loan_reduction_pct > 0 ? `-${mlResult.loan_reduction_pct.toFixed(0)}%` : 'None' },
                  { label: 'Model Std Dev',       value: mlResult.model_std_dev?.toFixed(4) },
                ].map(({ label, value, warn }) => (
                  <div key={label} style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: warn ? 'var(--red)' : 'var(--cyan)' }}>{value ?? '—'}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!mlResult && (
            <div style={{ padding: '32px 0', color: 'var(--text-dim)', fontSize: 13 }}>
              Enter loan details and click "Preview Risk" to see ML assessment
            </div>
          )}
        </div>

        {/* Agent explanation */}
        {agent.loanDecisions[0]?.explanation && (
          <div className="card">
            <div className="card-title">🤖 AI Explanation (Gemma 2B)</div>
            <div className="explanation-box">{agent.loanDecisions[0].explanation}</div>
          </div>
        )}
      </div>
    </div>
  )
}
