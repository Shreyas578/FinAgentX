// FinAgentX — Seed Liquidity Script
// Deposits USDT into the LendingPool.sol so the agent can start lending.
// Run: npx hardhat run scripts/seed-liquidity.js --network sepolia

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // 1. Load deployed addresses
  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addrPath)) {
    throw new Error("deployed-addresses.json not found. Run deploy script first.");
  }
  const addresses = JSON.parse(fs.readFileSync(addrPath, "utf8"));

  const USDT_ADDR = addresses.usdt;
  const POOL_ADDR = addresses.lendingPool;

  const [deployer] = await ethers.getSigners();
  console.log(`\n💧 Seeding Liquidity from: ${deployer.address}`);

  // 2. Connect to contracts
  const usdt = await ethers.getContractAt([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ], USDT_ADDR);

  const pool = await ethers.getContractAt([
    "function deposit(uint256 amount) external",
    "function getAvailableLiquidity() view returns (uint256)"
  ], POOL_ADDR);

  // 3. Check balance
  const balance = await usdt.balanceOf(deployer.address);
  const decimals = await usdt.decimals();
  console.log(`   Your USDT Balance: ${ethers.formatUnits(balance, decimals)}`);

  if (balance === 0n) {
    console.error("❌ You have 0 USDT on Sepolia! Get some from faucet.circle.com");
    process.exit(1);
  }

  // Define seed amount (e.g., 10 USDT)
  const seedAmount = ethers.parseUnits("50.0", decimals); // Seed more to satisfy reserve ratio
  
  // 4. Approve
  console.log(`\n⏳ Approving ${ethers.formatUnits(seedAmount, decimals)} USDT for LendingPool...`);
  const approveTx = await usdt.approve(POOL_ADDR, seedAmount);
  await approveTx.wait();
  console.log("   ✅ Approved");

  // 5. Deposit
  console.log(`⏳ Depositing into LendingPool...`);
  const depositTx = await pool.deposit(seedAmount);
  await depositTx.wait();
  console.log("   ✅ Deposit Success!");

  const newLiquidity = await pool.getAvailableLiquidity();
  console.log(`\n📊 Pool Liquidity: ${ethers.formatUnits(newLiquidity, decimals)} USDT`);
  console.log("🚀 Agent is now ready to lend!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
