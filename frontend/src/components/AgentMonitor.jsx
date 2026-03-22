// FinAgentX — Agent Monitor (12-step autonomous loop viewer)
export default function AgentMonitor({ agent }) {
  const steps = [
    { n: 1,  label: 'Listen for loan requests',        icon: '👂' },
    { n: 2,  label: 'Fetch borrower on-chain data',    icon: '⛓️' },
    { n: 3,  label: 'Generate ML features',            icon: '🔢' },
    { n: 4,  label: 'Run ALL ML models (ensemble)',    icon: '🧠' },
    { n: 5,  label: 'Combine predictions',             icon: '⚙️' },
    { n: 6,  label: 'Behavioral risk detection',       icon: '🔍' },
    { n: 7,  label: 'Compute risk + uncertainty',      icon: '📐' },
    { n: 8,  label: 'LLM negotiation + explanation',   icon: '🤖' },
    { n: 9,  label: 'Decide: APPROVE / REJECT',        icon: '⚖️' },
    { n: 10, label: 'Execute on-chain via WDK',        icon: '⚡' },
    { n: 11, label: 'Monitor repayments + penalties',  icon: '⏰' },
    { n: 12, label: 'Reallocate capital',              icon: '💸' },
  ]

  const recentActivity = agent.activities || []
  const recentSteps    = new Set(recentActivity.slice(0, 20).map(a => a.step))

  return (
    <div>
      {/* Connection status */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title">Agent Status</div>
            <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
              {[
                { label: 'Status',      value: agent.connected ? '🟢 Online' : '🔴 Offline' },
                { label: 'Protocol',    value: 'WDK + MCP + Ollama' },
                { label: 'Model',       value: 'Gemma 2B (WSL)' },
                { label: 'Network',     value: 'Ethereum Sepolia' },
                { label: 'Cycles',      value: agent.agentHealth?.loopCycles ?? '—' },
                { label: 'Monitoring', value: `${agent.agentHealth?.monitoredLoans ?? 0} loans` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
          {agent.agentHealth?.agentAddress && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>AGENT WALLET</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--cyan)' }}>
                {agent.agentHealth.agentAddress.slice(0, 8)}…{agent.agentHealth.agentAddress.slice(-6)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="two-col">
        {/* Loop visualization */}
        <div className="card">
          <div className="card-title">12-Step Autonomous Loop</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {steps.map(s => {
              const isActive  = recentSteps.has(s.n)
              const lastActive = recentActivity.find(a => a.step === s.n)
              return (
                <div key={s.n} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: isActive ? 'var(--cyan-dim)' : 'var(--bg-glass)',
                  border: `1px solid ${isActive ? 'var(--border-strong)' : 'var(--border)'}`,
                  borderRadius: 8,
                  transition: 'all 0.3s',
                }}>
                  <div style={{
                    width: 24, height: 24, flexShrink: 0,
                    background: isActive ? 'var(--cyan)' : 'rgba(255,255,255,0.06)',
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: isActive ? '#000' : 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                  }}>{s.n}</div>
                  <div style={{ fontSize: 12, flex: 1 }}>
                    <span style={{ color: isActive ? 'var(--cyan)' : 'var(--text-secondary)' }}>
                      {s.icon} {s.label}
                    </span>
                    {lastActive && (
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {lastActive.msg} · {lastActive.time}
                      </div>
                    )}
                  </div>
                  {isActive && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', animation: 'pulse 1s infinite' }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Live activity feed */}
        <div className="card">
          <div className="card-title">Live Activity Feed ({recentActivity.length})</div>
          <div className="activity-log">
            {recentActivity.length === 0
              ? <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Waiting for on-chain activity…</p>
              : recentActivity.map(a => (
                <div className="activity-item" key={a.id}>
                  <div className="activity-step">{a.step}</div>
                  <div style={{ flex: 1 }}>
                    <div className="activity-msg">{a.msg}</div>
                    <div className="activity-meta">
                      Loan #{a.loanId} · {a.borrower} · {a.time}
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}
