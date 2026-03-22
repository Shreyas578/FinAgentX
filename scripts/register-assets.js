const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addrPath, "utf8"));
  const [deployer] = await ethers.getSigners();
  
  console.log(`Using deployer: ${deployer.address}`);
  
  const loanManager = await ethers.getContractAt("LoanManager", addresses.loanManager);
  
  // Registering the primary USDT asset first
  console.log("Registering USDT asset...");
  const tx = await loanManager.registerAsset("USDT", addresses.usdt, addresses.lendingPool);
  await tx.wait();
  console.log("✅ USDT registered in LoanManager");

  // Placeholder for other assets (USA₮, XAU₮, BTC)
  // To use these, the user should deploy a LendingPool for each and provide the address.
  console.log("\nNote: To support USA₮, XAU₮, and BTC, deploy separate LendingPool instances and register them here.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
