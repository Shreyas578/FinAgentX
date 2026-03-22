// FinAgentX — MetaMask Wallet Hook
import { useState, useCallback } from 'react'
import { ethers } from 'ethers'

const SEPOLIA_CHAIN_ID = '0xaa36a7' // 11155111 in hex

export function useWallet() {
  const [account, setAccount]   = useState(null)
  const [provider, setProvider] = useState(null)
  const [signer, setSigner]     = useState(null)
  const [chainId, setChainId]   = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError]       = useState(null)

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install MetaMask.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })

      // Switch to Sepolia if needed
      const currentChain = await window.ethereum.request({ method: 'eth_chainId' })
      if (currentChain !== SEPOLIA_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: SEPOLIA_CHAIN_ID }],
          })
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: SEPOLIA_CHAIN_ID,
                chainName: 'Sepolia Testnet',
                nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://sepolia.infura.io/v3/'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              }],
            })
          }
        }
      }

      const web3Provider = new ethers.BrowserProvider(window.ethereum)
      const web3Signer   = await web3Provider.getSigner()
      const network      = await web3Provider.getNetwork()

      setAccount(accounts[0])
      setProvider(web3Provider)
      setSigner(web3Signer)
      setChainId(Number(network.chainId))

      // Listen for account/chain changes
      window.ethereum.on('accountsChanged', (accs) => {
        setAccount(accs[0] || null)
        if (!accs[0]) { setSigner(null); setProvider(null) }
      })
      window.ethereum.on('chainChanged', () => window.location.reload())

    } catch (err) {
      setError(err.message)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAccount(null)
    setProvider(null)
    setSigner(null)
    setChainId(null)
  }, [])

  const formatAddress = (addr) => addr
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : ''

  const isCorrectChain = chainId === 11155111

  return { account, provider, signer, chainId, connecting, error, connect, disconnect, formatAddress, isCorrectChain }
}
