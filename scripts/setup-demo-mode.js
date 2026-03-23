const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const addressesPath = path.join(__dirname, "../deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n🛠️  Setting up Demo Mode from: ${deployer.address}`);

  const usdtAddr = addresses.usdt;
  const poolAddr = addresses.lendingPool;
  const lmAddr   = addresses.loanManager;

  const usdt = await ethers.getContractAt("IERC20", usdtAddr);
  const pool = await ethers.getContractAt("LendingPool", poolAddr);
  const lm   = await ethers.getContractAt("LoanManager", lmAddr);

  // 1. Seed Liquidity (Skipped - using real USDT)
  console.log(`\n⏳ Seeding skipped (only 1,000 USDT total available)`);

  // 2. Configure Demo Duration (1 minute)
  console.log(`\n⏳ Setting min loan duration to 60 seconds...`);
  const durationTx = await lm.updateMinLoanDuration(60); // 1 minute
  await durationTx.wait();
  console.log(`✅ Min duration set to 60s`);

  // 3. Register Agent (just in case)
  console.log(`\n⏳ Registering deployer as agent...`);
  const regTx = await lm.registerAgent(deployer.address);
  await regTx.wait();
  console.log(`✅ Deployer registered as agent`);

  console.log(`\n🚀 Demo Mode Ready!`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
