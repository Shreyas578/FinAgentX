// FinAgentX — Sepolia Deployment Script
// IMPORTANT: Add your PRIVATE_KEY and SEPOLIA_RPC_URL to .env before running.
// This script will PAUSE before deploying and ask you to confirm your .env is set.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ── Mock USDT (for testing) ────────────────────────────────────────────────
let SEPOLIA_USDT = "";

async function waitForConfirmation() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  ⚠️  FINAGENTX DEPLOYMENT — PRE-FLIGHT CHECK                 ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log("║  Before proceeding, ensure your .env file contains:          ║");
    console.log("║                                                              ║");
    console.log("║  PRIVATE_KEY=<your_wallet_private_key_without_0x>           ║");
    console.log("║  SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<YOUR_KEY>    ║");
    console.log("║  ETHERSCAN_API_KEY=<optional_for_verification>              ║");
    console.log("║                                                              ║");
    console.log("║  USDT (Sepolia): 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
    rl.question("  ✅ Press ENTER to deploy, or Ctrl+C to abort: ", () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  // await waitForConfirmation();

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\n🚀 Deploying FinAgentX contracts to Sepolia...`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`   USDT:     ${SEPOLIA_USDT}\n`);

  if (balance < ethers.parseEther("0.05")) {
    throw new Error("Insufficient Sepolia ETH! Need at least 0.05 ETH for deployment gas.");
  }

  // ── 0. Deploy MockUSDT ──────────────────────────────────────────────────
  console.log("📄 Deploying MockUSDT.sol...");
  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const mockUSDT = await MockUSDT.deploy();
  await mockUSDT.waitForDeployment();
  SEPOLIA_USDT = await mockUSDT.getAddress();
  console.log(`   ✅ MockUSDT deployed: ${SEPOLIA_USDT}`);

  // ── 1. Deploy CreditScore ────────────────────────────────────────────────
  console.log("📄 Deploying CreditScore.sol...");
  const CreditScore = await ethers.getContractFactory("CreditScore");
  const creditScore = await CreditScore.deploy();
  await creditScore.waitForDeployment();
  const creditScoreAddr = await creditScore.getAddress();
  console.log(`   ✅ CreditScore deployed: ${creditScoreAddr}`);

  // ── 2. Deploy LendingPool ────────────────────────────────────────────────
  console.log("📄 Deploying LendingPool.sol...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(SEPOLIA_USDT);
  await lendingPool.waitForDeployment();
  const lendingPoolAddr = await lendingPool.getAddress();
  console.log(`   ✅ LendingPool deployed: ${lendingPoolAddr}`);

  // ── 3. Deploy LoanManager ────────────────────────────────────────────────
  console.log("📄 Deploying LoanManager.sol...");
  const LoanManager = await ethers.getContractFactory("LoanManager");
  const loanManager = await LoanManager.deploy(lendingPoolAddr, creditScoreAddr);
  await loanManager.waitForDeployment();
  const loanManagerAddr = await loanManager.getAddress();
  console.log(`   ✅ LoanManager deployed: ${loanManagerAddr}`);

  // ── 4. Wire up permissions ───────────────────────────────────────────────
  console.log("\n🔧 Configuring contract permissions...");
  let tx = await lendingPool.setLoanManager(loanManagerAddr);
  await tx.wait();
  console.log("   ✅ LendingPool → LoanManager linked");

  tx = await creditScore.setLoanManager(loanManagerAddr);
  await tx.wait();
  console.log("   ✅ CreditScore → LoanManager linked");

  // ── 4b. Register Asset and Seed Liquidity ─────────────────────────────────
  console.log("\n🔧 Registering USDT and seeding liquidity...");
  tx = await loanManager.registerAsset("USDT", SEPOLIA_USDT, lendingPoolAddr);
  await tx.wait();
  console.log("   ✅ USDT registered in LoanManager");

  const seedAmount = ethers.parseUnits("500000", 6);
  tx = await mockUSDT.approve(lendingPoolAddr, seedAmount);
  await tx.wait();
  tx = await lendingPool.deposit(seedAmount);
  await tx.wait();
  console.log("   ✅ Seeded 500,000 MockUSDT into LendingPool");

  // ── 5. Save deployed addresses ───────────────────────────────────────────
  const addresses = {
    network: "sepolia",
    chainId: 11155111,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    usdt: SEPOLIA_USDT,
    creditScore: creditScoreAddr,
    lendingPool: lendingPoolAddr,
    loanManager: loanManagerAddr,
  };

  const outputPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));

  // Also copy to agent and frontend
  const agentPath = path.join(__dirname, "..", "agent", "deployed-addresses.json");
  const frontendPath = path.join(__dirname, "..", "frontend", "src", "deployed-addresses.json");
  fs.writeFileSync(agentPath, JSON.stringify(addresses, null, 2));
  fs.writeFileSync(frontendPath, JSON.stringify(addresses, null, 2));

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  🎉 FINAGENTX DEPLOYMENT COMPLETE                            ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  CreditScore:  ${creditScoreAddr}  ║`);
  console.log(`║  LendingPool:  ${lendingPoolAddr}  ║`);
  console.log(`║  LoanManager:  ${loanManagerAddr}  ║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  📁 Addresses saved to deployed-addresses.json               ║");
  console.log("║  🔍 Verify on: https://sepolia.etherscan.io                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Optional Etherscan verification
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("🔍 Verifying contracts on Etherscan...");
    try {
      await run("verify:verify", { address: creditScoreAddr, constructorArguments: [] });
      await run("verify:verify", { address: lendingPoolAddr, constructorArguments: [SEPOLIA_USDT] });
      await run("verify:verify", { address: loanManagerAddr, constructorArguments: [lendingPoolAddr, creditScoreAddr] });
      console.log("   ✅ All contracts verified on Etherscan!");
    } catch (e) {
      console.log("   ⚠️  Verification failed (contracts still deployed):", e.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Deployment failed:", err.message);
    process.exit(1);
  });
