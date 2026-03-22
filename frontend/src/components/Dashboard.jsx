import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import addresses from '../deployed-addresses.json'

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]
const LM_ABI = [
  "function activeLoanId(address) view returns (uint256)",
  "function getLoan(uint256) view returns (tuple(uint256 id, address borrower, uint256 amount, uint256 interestRate, uint256 dueDate, uint256 issuedAt, uint256 repaidAt, uint256 creditScoreAtIssuance, uint256 defaultProbability, uint8 status, string llmExplanation))",
  "function repayLoan(uint256) external",
  "function calculateInterest(uint256, uint256, uint256) view returns (uint256)",
]

const LM_ADDR = addresses.loanManager
const USDT_ADDR = addresses.usdt

const mockCapitalData = Array.from({ length: 12 }, (_, i) => ({
  month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
  deposited: 8000 + i * 500 + Math.random() * 800,
  borrowed: 3000 + i * 350 + Math.random() * 600,
  interest: 100 + i * 45 + Math.random() * 80,
}))

export default function Dashboard({ wallet, agent }) {
  const [activeLoan, setActiveLoan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [txStep, setTxStep] = useState('')
  const [error, setError] = useState(null)

  const pool = agent.poolStats || {}
  const treasury = agent.treasury || {}
  const health = agent.agentHealth || {}

  // Fetch active loan
  useEffect(() => {
    if (!wallet.account || !wallet.provider) return
    const fetchActive = async () => {
      try {
        const lm = new ethers.Contract(LM_ADDR, LM_ABI, wallet.provider)
        const loanId = await lm.activeLoanId(wallet.account)
        if (loanId > 0n) {
          const loanData = await lm.getLoan(loanId)
          setActiveLoan(loanData)
        } else {
          setActiveLoan(null)
        }
      } catch (e) { console.error("Fetch active loan failed", e) }
    }
    fetchActive()
    const int = setInterval(fetchActive, 10000)
    return () => clearInterval(int)
  }, [wallet.account, wallet.provider])

  const handleRepay = async () => {
    if (!wallet.signer || !activeLoan) return
    setLoading(true)
    setError(null)
    try {
      const lm = new ethers.Contract(LM_ADDR, LM_ABI, wallet.signer)
      const usdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, wallet.signer)

      const interest = await lm.calculateInterest(activeLoan.amount, activeLoan.interestRate, activeLoan.issuedAt)
      const totalDue = activeLoan.amount + interest

      setTxStep('Approving USDT repayment...')
      const appTx = await usdt.approve(LM_ADDR, totalDue)
      await appTx.wait()

      setTxStep('Broadcasting repayment tx...')
      const tx = await lm.repayLoan(activeLoan.id)
      await tx.wait()

      setTxStep('✅ Repaid successfully!')
      setTimeout(() => setTxStep(''), 5000)
      setActiveLoan(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const stats = [
    {
      icon: '💧',
      value: pool.availableLiquidity ? `${parseFloat(pool.availableLiquidity).toLocaleString()} USDT` : '$—',
      label: 'Available Liquidity',
      color: 'cyan',
    },
    {
      icon: '📤',
      value: pool.totalBorrowed ? `$${parseFloat(pool.totalBorrowed).toLocaleString()}` : '$—',
      label: 'Total Deployed',
      color: 'purple',
    },
    {
      icon: '💰',
      value: pool.totalInterestEarned ? `$${parseFloat(pool.totalInterestEarned).toFixed(2)}` : '$—',
      label: 'Interest Earned',
      color: 'green',
    },
    {
      icon: '📊',
      value: pool.utilizationRate ? `${pool.utilizationRate.toFixed(1)}%` : '—',
      label: 'Utilization Rate',
      color: 'yellow',
    },
  ]

  const healthStats = [
    {
      icon: '🔄',
      value: health.loopCycles ?? '—',
      label: 'Agent Cycles',
      color: 'cyan',
    },
    {
      icon: '⚡',
      value: health.processedLoans ?? '—',
      label: 'Loans Processed',
      color: 'purple',
    },
    {
      icon: '🏦',
      value: treasury.reinvestCycles ?? '—',
      label: 'Reinvest Cycles',
      color: 'green',
    },
    {
      icon: '⏱️',
      value: health.uptime ? `${Math.floor(health.uptime / 60)}m` : '—',
      label: 'Agent Uptime',
      color: 'yellow',
    },
  ]

  return (
    <div>
      {/* Active Loan Alert */}
      {activeLoan && activeLoan.status === 1 && (
        <div className="card" style={{ marginBottom: 24, border: '1px solid var(--green)', background: 'rgba(0,245,160,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="card-title" style={{ color: 'var(--green)', marginBottom: 4 }}>⚡ Active Loan Detected</div>
              <div style={{ display: 'flex', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>ID</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>#{activeLoan.id.toString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>PRINCIPAL</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{ethers.formatUnits(activeLoan.amount, 6)} USDT</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>RATE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--yellow)' }}>{(Number(activeLoan.interestRate) / 100).toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>DUE DATE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: activeLoan.dueDate < Date.now() / 1000 ? 'var(--red)' : 'var(--text-primary)' }}>
                    {new Date(Number(activeLoan.dueDate) * 1000).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={handleRepay} disabled={loading}>
                {loading ? <><div className="spinner" />Processing...</> : '💰 Repay Loan + Interest'}
              </button>
              {txStep && <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>{txStep}</div>}
              {error && <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 8, width: 200 }}>{error}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="stats-grid">
        {[...stats, ...healthStats].map((s, i) => (
          <div className="stat-card" key={i}>
            <div className="stat-icon">{s.icon}</div>
            <div className={`stat-value ${s.color}`}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Capital chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Capital Allocation Over Time (USDT)</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={mockCapitalData}>
            <defs>
              <linearGradient id="cyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d2ff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00d2ff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="purple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#7c3aff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="green" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00f5a0" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00f5a0" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="month" tick={{ fill: '#7a92b0', fontSize: 11 }} axisLine={false} />
            <YAxis tick={{ fill: '#7a92b0', fontSize: 11 }} axisLine={false} />
            <Tooltip
              contentStyle={{ background: '#0d1526', border: '1px solid rgba(0,210,255,0.2)', borderRadius: 8 }}
              labelStyle={{ color: '#e8f4ff' }}
            />
            <Area type="monotone" dataKey="deposited" stroke="#00d2ff" fill="url(#cyan)" name="Deposited" />
            <Area type="monotone" dataKey="borrowed" stroke="#7c3aff" fill="url(#purple)" name="Borrowed" />
            <Area type="monotone" dataKey="interest" stroke="#00f5a0" fill="url(#green)" name="Interest" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent decisions */}
      <div className="two-col">
        <div className="card">
          <div className="card-title">Recent Loan Decisions</div>
          {agent.loanDecisions.length === 0
            ? <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No decisions yet — agent listening for requests…</p>
            : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th><th>Borrower</th><th>Decision</th><th>Score</th><th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {agent.loanDecisions.slice(0, 8).map((d, idx) => (
                    <tr key={`${d.loanId}-${idx}`}>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{d.loanId}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{d.borrower?.slice(0, 10)}…</td>
                      <td>
                        <span className={`badge ${d.decision === 'APPROVE' ? 'badge-green' : 'badge-red'}`}>
                          {d.decision === 'APPROVE' ? '✓' : '✗'} {d.decision}
                        </span>
                      </td>
                      <td style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                        {d.creditScore?.toFixed(0)}/100
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {d.interestRate ? `${d.interestRate.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>

        <div className="card">
          <div className="card-title">Treasury Health</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
            {[
              { label: 'Total Profit', value: `$${treasury.totalProfit || '0.00'}`, color: 'var(--green)' },
              { label: 'Total Reinvested', value: `$${treasury.totalReinvested || '0.00'}`, color: 'var(--cyan)' },
              { label: 'Reinvest Cycles', value: treasury.reinvestCycles ?? '0', color: 'var(--purple)' },
              { label: 'Recent Default Rate', value: treasury.recentDefaultRate ?? 'N/A', color: 'var(--yellow)' },
              { label: 'Total Outcomes', value: treasury.totalOutcomes ?? '0', color: 'var(--text-secondary)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
