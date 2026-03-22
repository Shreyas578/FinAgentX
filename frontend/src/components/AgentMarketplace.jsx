// FinAgentX — Agent-to-Agent Marketplace
export default function AgentMarketplace({ agent }) {
  const market = agent.marketStats || {}

  const mockOffers = [
    { offerId: 1, lender: '0xAgentAlpha',  amount: 2000, rateBps: 600,  durationDays: 30, minScore: 50, status: 'OPEN' },
    { offerId: 2, lender: '0xAgentBeta',   amount: 5000, rateBps: 800,  durationDays: 60, minScore: 60, status: 'OPEN' },
    { offerId: 3, lender: '0xAgentGamma',  amount: 1000, rateBps: 450,  durationDays: 14, minScore: 40, status: 'MATCHED' },
    { offerId: 4, lender: '0xFinAgentX',   amount: 1000, rateBps: 800,  durationDays: 30, minScore: 40, status: 'OPEN' },
  ]

  const mockSettlements = [
    { lender: '0xAgentAlpha', borrower: '0xAgentBeta', amount: 1000, finalRateBps: 700, agreedAt: Date.now() - 3600_000 },
    { lender: '0xFinAgentX',  borrower: '0xAgentDelta', amount: 500, finalRateBps: 800, agreedAt: Date.now() - 7200_000 },
  ]

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {[
          { icon: '📢', label: 'Total Offers',   value: market.totalOffers   ?? mockOffers.length,   color: 'cyan' },
          { icon: '🟢', label: 'Open Offers',    value: market.openOffers    ?? mockOffers.filter(o => o.status==='OPEN').length, color: 'green' },
          { icon: '🤝', label: 'Matched Offers', value: market.matchedOffers ?? mockOffers.filter(o => o.status==='MATCHED').length, color: 'purple' },
          { icon: '✅', label: 'Settlements',    value: market.settlements   ?? mockSettlements.length, color: 'yellow' },
        ].map((s, i) => (
          <div className="stat-card" key={i}>
            <div className="stat-icon">{s.icon}</div>
            <div className={`stat-value ${s.color}`}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="two-col">
        {/* Active Offers */}
        <div className="card">
          <div className="card-title">📋 Active Lending Offers</div>
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Lender</th>
                <th>Amount</th>
                <th>Rate</th>
                <th>Duration</th>
                <th>Min Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mockOffers.map(o => (
                <tr key={o.offerId}>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{o.offerId}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cyan)' }}>
                    {o.lender.slice(0, 12)}…
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>${o.amount.toLocaleString()}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--yellow)' }}>
                    {(o.rateBps / 100).toFixed(2)}%
                  </td>
                  <td style={{ fontSize: 12 }}>{o.durationDays}d</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{o.minScore}/100</td>
                  <td>
                    <span className={`badge ${o.status === 'OPEN' ? 'badge-cyan' : 'badge-green'}`}>
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Settlements + How it works */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">✅ Recent Settlements</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {mockSettlements.map((s, i) => (
                <div key={i} style={{ padding: 12, background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>
                      {s.lender.slice(0, 12)}… → {s.borrower.slice(0, 12)}…
                    </span>
                    <span className="badge badge-green">SETTLED</span>
                  </div>
                  <div style={{ display: 'flex', gap: 20 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Amount: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>${s.amount}</span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Rate: <span style={{ color: 'var(--yellow)', fontFamily: 'var(--font-mono)' }}>{(s.finalRateBps/100).toFixed(2)}%</span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {new Date(s.agreedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">🤖 How Agent-to-Agent Lending Works</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {[
                { n: '1', text: 'Agents post lending offers to the marketplace' },
                { n: '2', text: 'Borrowing agents browse offers filtered by credit score' },
                { n: '3', text: 'Gemma 2B LLM negotiates terms autonomously' },
                { n: '4', text: 'ACCEPT / COUNTER / REJECT via agent messaging' },
                { n: '5', text: 'Settlement recorded on-chain via LoanManager.sol' },
              ].map(({ n, text }) => (
                <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 24, height: 24, flexShrink: 0,
                    background: 'var(--cyan-dim)', border: '1px solid var(--border-strong)',
                    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'var(--cyan)', fontFamily: 'var(--font-mono)',
                  }}>{n}</div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 4 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
