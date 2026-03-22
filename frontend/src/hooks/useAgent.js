// FinAgentX — Agent WebSocket + REST Hook
import { useState, useEffect, useRef, useCallback } from 'react'

const AGENT_URL = 'http://localhost:3001'
const WS_URL    = 'ws://localhost:3001'

export function useAgent() {
  const [connected, setConnected]       = useState(false)
  const [agentHealth, setAgentHealth]   = useState(null)
  const [poolStats, setPoolStats]       = useState(null)
  const [treasury, setTreasury]         = useState(null)
  const [activities, setActivities]     = useState([])
  const [loanDecisions, setLoanDecisions] = useState([])
  const [marketStats, setMarketStats]   = useState(null)
  const ws = useRef(null)

  // Connect WebSocket
  useEffect(() => {
    const connect = () => {
      try {
        ws.current = new WebSocket(WS_URL)
        ws.current.onopen  = () => setConnected(true)
        ws.current.onclose = () => { setConnected(false); setTimeout(connect, 3000) }
        ws.current.onerror = () => { setConnected(false) }
        ws.current.onmessage = (e) => {
          try {
            const { type, payload, timestamp } = JSON.parse(e.data)
            handleMessage(type, payload, timestamp)
          } catch (_) {}
        }
      } catch (_) {
        setTimeout(connect, 3000)
      }
    }
    connect()
    return () => ws.current?.close()
  }, [])

  const handleMessage = (type, payload, timestamp) => {
    const time = new Date(timestamp).toLocaleTimeString()

    if (type === 'LOAN_STEP') {
      setActivities(prev => [{
        id: Date.now() + Math.random(),
        step: payload.step,
        msg:  payload.msg,
        loanId: payload.loanId,
        borrower: payload.borrower,
        time,
      }, ...prev].slice(0, 100))
    }

    if (type === 'LOAN_DECISION') {
      setLoanDecisions(prev => [{ ...payload, time, id: Date.now() }, ...prev].slice(0, 50))
    }

    if (type === 'CAPITAL_STRATEGY') {
      setTreasury(prev => ({ ...prev, lastStrategy: payload }))
    }
  }

  // Poll agent REST endpoints
  useEffect(() => {
    const poll = async () => {
      try {
        const [health, pool, treas, market] = await Promise.allSettled([
          fetch(`${AGENT_URL}/health`).then(r => r.json()),
          fetch(`${AGENT_URL}/pool`).then(r => r.json()),
          fetch(`${AGENT_URL}/treasury`).then(r => r.json()),
          fetch(`${AGENT_URL}/market`).then(r => r.json()),
        ])
        if (health.status   === 'fulfilled') setAgentHealth(health.value)
        if (pool.status     === 'fulfilled') setPoolStats(pool.value)
        if (treas.status    === 'fulfilled') setTreasury(t => ({ ...(t || {}), ...treas.value }))
        if (market.status   === 'fulfilled') setMarketStats(market.value)
      } catch (_) {}
    }
    poll()
    const interval = setInterval(poll, 10_000)
    return () => clearInterval(interval)
  }, [])

  const predictRisk = useCallback(async (features) => {
    const res = await fetch('http://localhost:8000/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
    })
    if (!res.ok) throw new Error('ML API unavailable')
    return res.json()
  }, [])

  return {
    connected, agentHealth, poolStats, treasury,
    activities, loanDecisions, marketStats,
    predictRisk,
  }
}
