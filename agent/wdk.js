/**
 * FinAgentX — WDK Wallet & Contract Interface
 * Refactored to use the official Tether Wallet Development Kit (WDK)
 * Handles signing, contract calls, and event listening for Sepolia
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ── ABIs (minimal) ───────────────────────────────────────────────────────────
const LOAN_MANAGER_ABI = [
  "function requestLoan(uint256 amount, uint256 durationSeconds, string calldata assetSymbol) returns (uint256)",
  "function approveLoan(uint256 loanId, uint256 interestRate, uint256 defaultProbBps, string calldata explanation) external",
  "function rejectLoan(uint256 loanId, string calldata reason) external",
  "function repayLoan(uint256 loanId) external",
  "function collectRepayment(uint256 loanId) external",
  "function liquidateLoan(uint256 loanId) external",
  "function markDefault(uint256 loanId) external",
  "function getLoan(uint256 loanId) view returns (tuple(uint256 id, address borrower, uint256 amount, uint256 interestRate, uint256 dueDate, uint256 issuedAt, uint256 repaidAt, uint256 creditScoreAtIssuance, uint256 defaultProbability, uint8 status, string llmExplanation, string assetSymbol))",
  "function getBorrowerLoans(address borrower) view returns (uint256[])",
  "function isOverdue(uint256 loanId) view returns (bool)",
  "function activeLoanId(address borrower) view returns (uint256)",
  "function nextLoanId() view returns (uint256)",
  "function registerAsset(string calldata symbol, address token, address pool) external",
  "function registerAgent(address agent) external",
  "function calculateInterest(uint256 principal, uint256 rateBps, uint256 startTime) view returns (uint256)",
  "event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 duration, string assetSymbol)",
  "event LoanApproved(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 interestRate, uint256 dueDate)",
  "event LoanRejected(uint256 indexed loanId, address indexed borrower, string reason)",
  "event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 totalRepaid)",
  "event LoanDefaulted(uint256 indexed loanId, address indexed borrower, uint256 amountOutstanding)",
  "event LoanLiquidated(uint256 indexed loanId, address indexed borrower, uint256 penalty)",
];

const LENDING_POOL_ABI = [
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 shareAmount) external",
  "function getAvailableLiquidity() view returns (uint256)",
  "function getUtilizationRate() view returns (uint256)",
  "function totalDeposited() view returns (uint256)",
  "function totalBorrowed() view returns (uint256)",
  "function totalInterestEarned() view returns (uint256)",
];

const CREDIT_SCORE_ABI = [
  "function getScore(address borrower) view returns (uint256)",
  "function getProfile(address borrower) view returns (uint256 score, uint256 totalLoans, uint256 successfulRepayments, uint256 failedRepayments, uint256 lastUpdated, bool exists)",
  "function getRepaymentRate(address borrower) view returns (uint256)",
  "function adjustScore(address borrower, uint256 newScore, string calldata reason) external",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// ── WDK Module Loader ────────────────────────────────────────────────────────
let WDKCore, WalletManagerEvm;

async function loadWDK() {
  if (WDKCore && WalletManagerEvm) return;
  // Dynamic import since these are ESM packages
  const wdkMod = await import("@tetherto/wdk");
  const walletMod = await import("@tetherto/wdk-wallet-evm");
  WDKCore = wdkMod.default;
  WalletManagerEvm = walletMod.default;
}

class WDKWallet {
  constructor() {
    this.wdk          = null;
    this.wdkAccount   = null;
    this.provider     = null;
    this.signer       = null; // ethers signer for low-level compatibility
    this.addresses    = null;
    this.contracts    = {};
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;

    await loadWDK();

    // Load deployed addresses
    const addrPath = path.join(__dirname, "deployed-addresses.json");
    if (!fs.existsSync(addrPath)) {
      throw new Error("deployed-addresses.json not found. Run `npm run deploy:sepolia` first.");
    }
    this.addresses = JSON.parse(fs.readFileSync(addrPath, "utf8"));

    // Connect to Sepolia
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL not set in .env");
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // Initialize Tether WDK
    const mnemonic = process.env.AGENT_MNEMONIC || process.env.MNEMONIC;
    
    if (mnemonic) {
      console.log(`[WDK] 🛠️ Initializing Tether WDK with mnemonic…`);
      this.wdk = new WDKCore(mnemonic);
      this.wdk.registerWallet("ethereum", WalletManagerEvm, {
        provider: rpcUrl,
      });
      // Use standard BIP-44 path index 0
      this.wdkAccount = await this.wdk.getAccount("ethereum", 0);
      
      const agentAddress = await this.wdkAccount.getAddress();
      
      // For contract compatibility, create an ethers signer from the WDK account's private key
      // and connect it to our provider.
      const kp = this.wdkAccount.keyPair;
      this.signer = new ethers.Wallet(ethers.hexlify(kp.privateKey), this.provider);
      
      console.log(`[WDK] Official Tether WDK Account initialized: ${agentAddress}`);
    } else {
      // Legacy fallback
      const privateKey = process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
      if (!privateKey) throw new Error("Neither AGENT_MNEMONIC nor AGENT_PRIVATE_KEY set in .env");
      
      console.log(`[WDK] ⚠️ No mnemonic found. Falling back to legacy private key.`);
      this.signer = new ethers.Wallet(
        privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
        this.provider
      );
    }

    // Instantiate contracts
    this.contracts.loanManager  = new ethers.Contract(this.addresses.loanManager,  LOAN_MANAGER_ABI,  this.signer);
    this.contracts.lendingPool  = new ethers.Contract(this.addresses.lendingPool,  LENDING_POOL_ABI,  this.signer);
    this.contracts.creditScore  = new ethers.Contract(this.addresses.creditScore,  CREDIT_SCORE_ABI,  this.signer);
    this.contracts.usdt         = new ethers.Contract(this.addresses.usdt,         ERC20_ABI,         this.signer);

    const network = await this.provider.getNetwork();
    const balance = await this.provider.getBalance(this.signer.address);

    console.log(`🔐 WDK Layer initialized`);
    console.log(`   Agent:   ${this.signer.address}`);
    console.log(`   Network: ${network.name} (chainId: ${network.chainId})`);
    console.log(`   Balance: ${ethers.formatEther(balance)} ETH`);

    this._initialized = true;
  }

  // ── Loan Management ─────────────────────────────────────────────────────────

  async approveLoan(loanId, interestRateBps, defaultProbBps, explanation) {
    await this.init();
    console.log(`[WDK] Approving loan #${loanId} at ${interestRateBps/100}% interest`);
    
    // If using WDK Account, we can use the sendTransaction method for extra safety
    if (this.wdkAccount) {
      const data = this.contracts.loanManager.interface.encodeFunctionData("approveLoan", [
        loanId, interestRateBps, defaultProbBps, explanation.substring(0, 500)
      ]);
      const result = await this.wdkAccount.sendTransaction({
        to: this.addresses.loanManager,
        value: 0,
        data: data
      });
      console.log(`[WDK] ✅ Loan #${loanId} approved via Tether WDK | tx: ${result.hash}`);
      return { hash: result.hash };
    } else {
      const tx = await this.contracts.loanManager.approveLoan(
        loanId, interestRateBps, defaultProbBps,
        explanation.substring(0, 500)
      );
      const receipt = await tx.wait();
      console.log(`[WDK] ✅ Loan #${loanId} approved | tx: ${receipt.hash}`);
      return receipt;
    }
  }

  async rejectLoan(loanId, reason) {
    await this.init();
    console.log(`[WDK] Rejecting loan #${loanId}: ${reason.substring(0, 80)}`);
    
    if (this.wdkAccount) {
      const data = this.contracts.loanManager.interface.encodeFunctionData("rejectLoan", [loanId, reason.substring(0, 300)]);
      const result = await this.wdkAccount.sendTransaction({
        to: this.addresses.loanManager,
        value: 0,
        data: data
      });
      return { hash: result.hash };
    } else {
      const tx = await this.contracts.loanManager.rejectLoan(loanId, reason.substring(0, 300));
      return tx.wait();
    }
  }

  async collectRepayment(loanId) {
    await this.init();
    console.log(`[WDK] 🤖 Autonomously collecting repayment for loan #${loanId}`);
    
    if (this.wdkAccount) {
      const data = this.contracts.loanManager.interface.encodeFunctionData("collectRepayment", [loanId]);
      const result = await this.wdkAccount.sendTransaction({
        to: this.addresses.loanManager,
        value: 0,
        data: data
      });
      return { hash: result.hash };
    } else {
      const tx = await this.contracts.loanManager.collectRepayment(loanId);
      return tx.wait();
    }
  }

  async liquidateLoan(loanId) {
    await this.init();
    console.log(`[WDK] Liquidating overdue loan #${loanId}`);
    
    if (this.wdkAccount) {
      const data = this.contracts.loanManager.interface.encodeFunctionData("liquidateLoan", [loanId]);
      const result = await this.wdkAccount.sendTransaction({
        to: this.addresses.loanManager,
        value: 0,
        data: data
      });
      return { hash: result.hash };
    } else {
      const tx = await this.contracts.loanManager.liquidateLoan(loanId);
      return tx.wait();
    }
  }

  async markDefault(loanId) {
    await this.init();
    if (this.wdkAccount) {
      const data = this.contracts.loanManager.interface.encodeFunctionData("markDefault", [loanId]);
      const result = await this.wdkAccount.sendTransaction({
        to: this.addresses.loanManager,
        value: 0,
        data: data
      });
      return { hash: result.hash };
    } else {
      const tx = await this.contracts.loanManager.markDefault(loanId);
      return tx.wait();
    }
  }

  // ── Read Operations ──────────────────────────────────────────────────────────

  async getLoan(loanId) {
    await this.init();
    const l = await this.contracts.loanManager.getLoan(loanId);
    return {
      id:       Number(l.id),
      borrower: l.borrower,
      amount:   ethers.formatUnits(l.amount, 6),
      interestRate: Number(l.interestRate),
      dueDate:  Number(l.dueDate),
      issuedAt: Number(l.issuedAt),
      status:   Number(l.status),
      creditScoreAtIssuance: Number(l.creditScoreAtIssuance),
      defaultProbability: Number(l.defaultProbability),
      llmExplanation: l.llmExplanation,
      assetSymbol: l.assetSymbol,
    };
  }

  async getNextLoanId() {
    await this.init();
    return Number(await this.contracts.loanManager.nextLoanId());
  }

  async isOverdue(loanId) {
    await this.init();
    return this.contracts.loanManager.isOverdue(loanId);
  }

  async getCreditProfile(wallet) {
    await this.init();
    const [score, totalLoans, successRepaid, failedRepaid, lastUpdated, exists] =
      await this.contracts.creditScore.getProfile(wallet);
    const repayRate = await this.contracts.creditScore.getRepaymentRate(wallet);
    return {
      score: Number(score),
      totalLoans: Number(totalLoans),
      successfulRepayments: Number(successRepaid),
      failedRepayments: Number(failedRepaid),
      lastUpdated: Number(lastUpdated),
      exists,
      repaymentRate: Number(repayRate),
    };
  }

  async getPoolStats() {
    await this.init();
    const [liquidity, utilizationRate, totalDeposited, totalBorrowed, totalInterest] = await Promise.all([
      this.contracts.lendingPool.getAvailableLiquidity(),
      this.contracts.lendingPool.getUtilizationRate(),
      this.contracts.lendingPool.totalDeposited(),
      this.contracts.lendingPool.totalBorrowed(),
      this.contracts.lendingPool.totalInterestEarned(),
    ]);
    return {
      availableLiquidity:  ethers.formatUnits(liquidity, 6),
      utilizationRate:     Number(utilizationRate) / 100,
      totalDeposited:      ethers.formatUnits(totalDeposited, 6),
      totalBorrowed:       ethers.formatUnits(totalBorrowed, 6),
      totalInterestEarned: ethers.formatUnits(totalInterest, 6),
    };
  }

  async getWalletTxCount(address) {
    await this.init();
    return this.provider.getTransactionCount(address);
  }

  async getWalletBalance(address, symbol = "USDT") {
    await this.init();
    
    if (this.wdkAccount && address.toLowerCase() === (await this.wdkAccount.getAddress()).toLowerCase()) {
      // Use WDK's native balance methods for the agent itself
      const ethWei = await this.wdkAccount.getBalance();
      const usdtAddress = this.addresses.usdt;
      const usdtUnits = await this.wdkAccount.getTokenBalance(usdtAddress);
      
      return {
        eth: parseFloat(ethers.formatEther(ethWei)).toFixed(4),
        [symbol.toLowerCase()]: parseFloat(ethers.formatUnits(usdtUnits, 6)).toFixed(2),
      };
    }

    const ethBal  = await this.provider.getBalance(address);
    const tokenBal = await this.contracts.usdt.balanceOf(address);
    const decimals = await this.contracts.usdt.decimals();

    return {
      eth:  parseFloat(ethers.formatEther(ethBal)).toFixed(4),
      [symbol.toLowerCase()]: parseFloat(ethers.formatUnits(tokenBal, decimals)).toFixed(2),
    };
  }

  async getBlockHistory(address, fromBlock = "earliest") {
    await this.init();
    const currentBlock = await this.provider.getBlockNumber();
    const startBlock   = Math.max(0, currentBlock - 1000);
    return { currentBlock, startBlock, address };
  }

  // ── Event Listening ──────────────────────────────────────────────────────────

  async listenForLoanRequests(callback) {
    if (!this._initialized) { await this.init(); }
    console.log("[WDK] 👂 Polling for LoanRequested events on Sepolia…");
    
    let lastBlock = await this.provider.getBlockNumber();
    
    setInterval(async () => {
      try {
        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock <= lastBlock) return;

        const filter = this.contracts.loanManager.filters.LoanRequested();
        const logs = await this.contracts.loanManager.queryFilter(filter, lastBlock + 1, currentBlock);
        
        for (const log of logs) {
          const { loanId, borrower, amount, duration, assetSymbol } = log.args;
          callback({
            loanId:   Number(loanId),
            borrower,
            amount:   ethers.formatUnits(amount, 6),
            duration: Number(duration),
            assetSymbol,
            txHash:   log.transactionHash,
          });
        }
        lastBlock = currentBlock;
      } catch (err) {
        if (!err.message.includes("filter not found")) {
          console.error("[WDK] Event poll error:", err.message);
        }
      }
    }, 10000);
  }

  async listenForRepayments(callback) {
    if (!this._initialized) return;
    let lastBlock = await this.provider.getBlockNumber();
    
    setInterval(async () => {
      try {
        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock <= lastBlock) return;

        const filter = this.contracts.loanManager.filters.LoanRepaid();
        const logs = await this.contracts.loanManager.queryFilter(filter, lastBlock + 1, currentBlock);
        
        for (const log of logs) {
          const { loanId, borrower, totalRepaid } = log.args;
          callback({
            loanId:      Number(loanId),
            borrower,
            totalRepaid: ethers.formatUnits(totalRepaid, 6),
            txHash:      log.transactionHash,
          });
        }
        lastBlock = currentBlock;
      } catch (err) {}
    }, 12000);
  }

  async listenForDefaults(callback) {
    if (!this._initialized) return;
    let lastBlock = await this.provider.getBlockNumber();
    
    setInterval(async () => {
      try {
        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock <= lastBlock) return;

        const filter = this.contracts.loanManager.filters.LoanDefaulted();
        const logs = await this.contracts.loanManager.queryFilter(filter, lastBlock + 1, currentBlock);
        
        for (const log of logs) {
          const { loanId, borrower, amountOutstanding } = log.args;
          callback({
            loanId:            Number(loanId),
            borrower,
            amountOutstanding: ethers.formatUnits(amountOutstanding, 6),
            txHash:            log.transactionHash,
          });
        }
        lastBlock = currentBlock;
      } catch (err) {}
    }, 15000);
  }

  stopListening() {
    console.log("[WDK] Polling listeners active.");
  }

  getAgentAddress() {
    return this.signer?.address;
  }
}

const wdk = new WDKWallet();
module.exports = { wdk, WDKWallet };

