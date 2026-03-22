// FinAgentX — Main App Shell
import { useState } from 'react'
import { useWallet } from './hooks/useWallet'
import { useAgent }  from './hooks/useAgent'
import Dashboard        from './components/Dashboard'
import LoanRequest      from './components/LoanRequest'
import AgentMonitor     from './components/AgentMonitor'
import RiskVisualizer   from './components/RiskVisualizer'
import AgentMarketplace from './components/AgentMarketplace'

const NAV = [
  { id: 'dashboard',    label: 'Dashboard',       icon: '⬡' },
  { id: 'loan',         label: 'Request Loan',     icon: '⚡' },
  { id: 'monitor',      label: 'Agent Monitor',    icon: '🤖' },
  { id: 'risk',         label: 'Risk Visualizer',  icon: '📊' },
  { id: 'marketplace',  label: 'Agent Market',     icon: '🌐' },
]

export default function App() {
  const DEFAULT_FEATURES = {
    tx_frequency:       50,
    avg_balance:        1.5,
    balance_volatility: 0.3,
    repayment_history:  0.85,
    failed_repayments:  0,
    days_since_active:  10,
  }

  const [page, setPage]                         = useState('dashboard')
  const [simulationFeatures, setSimulationFeatures] = useState(DEFAULT_FEATURES)
  const wallet = useWallet()
  const agent  = useAgent()

  const renderPage = () => {
    const props = { wallet, agent, features: simulationFeatures, setFeatures: setSimulationFeatures }
    switch (page) {
      case 'dashboard':   return <Dashboard   {...props} />
      case 'loan':        return <LoanRequest {...props} />
      case 'monitor':     return <AgentMonitor {...props} />
      case 'risk':        return <RiskVisualizer {...props} />
      case 'marketplace': return <AgentMarketplace {...props} />
      default:            return <Dashboard   {...props} />
    }
  }

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-name">FinAgentX</div>
          <div className="brand-sub">Autonomous Lending Agent</div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Agent status */}
        <div className="agent-status">
          <div className={`agent-dot ${agent.connected ? '' : 'inactive'}`} />
          <span style={{ fontSize: 11 }}>
            Agent {agent.connected ? 'Online' : 'Offline'}
            {agent.agentHealth && ` · ${agent.agentHealth.loopCycles} cycles`}
          </span>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">
              {NAV.find(n => n.id === page)?.icon}{' '}
              {NAV.find(n => n.id === page)?.label}
            </h1>
            <p className="page-sub">
              Autonomous On-Chain AI Lending — Ethereum Sepolia
            </p>
          </div>

          {/* Wallet button */}
          {wallet.account ? (
            <div className="wallet-badge" onClick={wallet.disconnect}>
              <div className="wallet-dot" />
              {wallet.formatAddress(wallet.account)}
              {wallet.isCorrectChain
                ? <span style={{ color: 'var(--green)', fontSize: 10 }}>Sepolia ✓</span>
                : <span style={{ color: 'var(--red)', fontSize: 10 }}>Wrong Chain!</span>
              }
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={wallet.connect}
              disabled={wallet.connecting}
            >
              {wallet.connecting
                ? <><div className="spinner" />Connecting…</>
                : '🦊 Connect MetaMask'
              }
            </button>
          )}
        </div>

        {/* Page content */}
        {renderPage()}
      </main>
    </div>
  )
}
