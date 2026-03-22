// FinAgentX — Risk Visualizer
import { useState } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'

const modelColors = {
  linear: '#00d2ff',
  ridge:  '#7c3aff',
  lasso:  '#00f5a0',
  random_forest: '#f59e0b',
}

const DEFAULT_FEATURES = {
  tx_frequency: 50,
  avg_balance: 1.5,
  balance_volatility: 0.3,
  repayment_history: 0.85,
  failed_repayments: 0,
  days_since_active: 10,
}

export default function RiskVisualizer({ agent, wallet, features, setFeatures }) {
  const [result, setResult]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  const handleSlider = (key, val) => {
    setFeatures(prev => ({ ...prev, [key]: parseFloat(val) }))
  }

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:8000/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...features, wallet: wallet.account }),
      })
      if (!res.ok) throw new Error('ML API not running — start `uvicorn api:app --port 8000`')
      setResult(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const radarData = [
    { subject: 'TX Activity',    value: Math.min(features.tx_frequency / 2, 100) },
    { subject: 'Balance',       value: Math.min(features.avg_balance * 10, 100) },
    { subject: 'Stability',     value: (1 - features.balance_volatility / 2) * 100 },
    { subject: 'Repayments',    value: features.repayment_history * 100 },
    { subject: 'Zero Defaults', value: (1 - features.failed_repayments / 15) * 100 },
    { subject: 'Recency',       value: (1 - features.days_since_active / 365) * 100 },
  ]

  const barData = result?.individual_predictions
    ? Object.entries(result.individual_predictions).map(([model, val]) => ({
        model: model.replace('_', ' '),
        default: parseFloat((val * 100).toFixed(1)),
        color: modelColors[model] || '#7a92b0',
      }))
    : []

  const featureSliders = [
    { key: 'tx_frequency',      label: 'TX Frequency (mo)',     min: 0, max: 200, step: 1,    fmt: v => `${v}` },
    { key: 'avg_balance',       label: 'Avg Balance (ETH)',     min: 0, max: 20,  step: 0.1,  fmt: v => `${v.toFixed(1)}` },
    { key: 'balance_volatility',label: 'Balance Volatility',    min: 0, max: 2,   step: 0.05, fmt: v => v.toFixed(2) },
    { key: 'repayment_history', label: 'Repayment History',     min: 0, max: 1,   step: 0.05, fmt: v => `${(v*100).toFixed(0)}%` },
    { key: 'failed_repayments', label: 'Failed Repayments',     min: 0, max: 15,  step: 1,    fmt: v => `${v}` },
    { key: 'days_since_active', label: 'Days Since Active',     min: 0, max: 365, step: 1,    fmt: v => `${v}d` },
  ]

  const scoreColor = result
    ? result.credit_score >= 70 ? 'var(--green)'
    : result.credit_score >= 40 ? 'var(--yellow)'
    : 'var(--red)'
    : 'var(--cyan)'

  return (
    <div>
      <div className="two-col" style={{ marginBottom: 20 }}>
        {/* Feature Sliders */}
        <div className="card">
          <div className="card-title">Borrower Profile Simulator</div>
          {featureSliders.map(s => (
            <div key={s.key} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label htmlFor={s.key} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.label}</label>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>
                  {s.fmt(features[s.key])}
                </span>
              </div>
              <input 
                id={s.key}
                name={s.key}
                type="range" 
                min={s.min} 
                max={s.max} 
                step={s.step}
                value={features[s.key]}
                onChange={e => setFeatures(f => ({ ...f, [s.key]: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--cyan)' }}
              />
            </div>
          ))}
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }}
            onClick={runAnalysis} disabled={loading}>
            {loading ? <><div className="spinner"/>Running Models…</> : '🧠 Run Ensemble Analysis'}
          </button>
          {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        </div>

        {/* Radar Chart */}
        <div className="card">
          <div className="card-title">Risk Profile Radar</div>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.06)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#7a92b0', fontSize: 11 }} />
              <Radar dataKey="value" stroke="#00d2ff" fill="#00d2ff" fillOpacity={0.2}
                dot={{ fill: '#00d2ff', r: 3 }} />
            </RadarChart>
          </ResponsiveContainer>

          {result && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Credit Score</div>
              <div style={{ fontSize: 48, fontWeight: 800, fontFamily: 'var(--font-mono)', color: scoreColor, lineHeight: 1 }}>
                {result.credit_score.toFixed(0)}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>/ 100</div>
              <div style={{ marginTop: 10 }}>
                <span className={`badge ${result.decision === 'APPROVE' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 13 }}>
                  {result.decision === 'APPROVE' ? '✓ APPROVED' : '✗ REJECTED'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Model predictions bar chart */}
      {result && (
        <div className="two-col">
          <div className="card">
            <div className="card-title">Model Predictions (Default %)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: '#7a92b0', fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="model" tick={{ fill: '#7a92b0', fontSize: 11 }} width={90} />
                <Tooltip
                  contentStyle={{ background: '#0d1526', border: '1px solid rgba(0,210,255,0.2)', borderRadius: 8 }}
                  formatter={(v) => [`${v.toFixed(1)}%`, 'Default Prob']}
                />
                <Bar dataKey="default" radius={[0, 4, 4, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Ensemble (weighted): </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: result.default_prob > 0.6 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                {(result.default_prob * 100).toFixed(1)}% default probability
              </span>
              <span style={{ color: 'var(--text-dim)', marginLeft: 12 }}>
                Uncertainty: {result.uncertainty_level} (σ={result.model_std_dev?.toFixed(3)})
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Confidence-Aware Adjustments</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              {[
                { label: 'Model Variance',        value: result.model_variance?.toFixed(6), color: result.uncertainty_level === 'HIGH' ? 'var(--red)' : 'var(--green)' },
                { label: 'Uncertainty Level',     value: result.uncertainty_level },
                { label: 'Loan Reduction',        value: result.loan_reduction_pct > 0 ? `-${result.loan_reduction_pct.toFixed(0)}%` : 'None', color: result.loan_reduction_pct > 0 ? 'var(--yellow)' : 'var(--green)' },
                { label: 'Extra Interest (bps)',  value: result.interest_increase_bps > 0 ? `+${result.interest_increase_bps} bps` : 'None', color: result.interest_increase_bps > 0 ? 'var(--yellow)' : 'var(--green)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: color || 'var(--cyan)' }}>{value ?? '—'}</span>
                </div>
              ))}

              <div style={{ padding: '10px 12px', background: 'rgba(0,210,255,0.05)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>ENSEMBLE WEIGHTS</div>
                {[['Linear', '10%'], ['Ridge', '20%'], ['Lasso', '20%'], ['Random Forest', '50%']].map(([m, w]) => (
                  <div key={m} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{m}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
