const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

async function main() {
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    const pk = process.env.PRIVATE_KEY;
    const oldWallet = new ethers.Wallet(pk, provider);
    const oldAddress = await oldWallet.getAddress();
    const oldBalance = await provider.getBalance(oldAddress);
    
    console.log(`Old Agent Address: ${oldAddress}`);
    console.log(`Old Balance:       ${ethers.formatEther(oldBalance)} ETH`);

    const { wdk } = require("./wdk");
    await wdk.init();
    const newAddress = wdk.getAgentAddress();
    console.log(`New Agent Address: ${newAddress}`);

    if (oldBalance > ethers.parseEther("0.01")) {
        console.log("Old agent has enough ETH. Attempting to register new agent...");
        const addrPath = require("path").join(__dirname, "deployed-addresses.json");
        const addresses = JSON.parse(require("fs").readFileSync(addrPath, "utf8"));
        
        const loanManager = new ethers.Contract(addresses.loanManager, ["function registerAgent(address) external"], oldWallet);
        
        try {
            const tx = await loanManager.registerAgent(newAddress);
            console.log(`Registration TX: ${tx.hash}`);
            await tx.wait();
            console.log("✅ New agent registered successfully!");
            
            console.log("Transferring 0.05 ETH for gas...");
            const tx2 = await oldWallet.sendTransaction({
                to: newAddress,
                value: ethers.parseEther("0.05")
            });
            console.log(`Transfer TX: ${tx2.hash}`);
            await tx2.wait();
            console.log("✅ ETH transferred!");
        } catch (err) {
            console.error("Failed to register/transfer:", err.message);
        }
    } else {
        console.log("Old agent balance too low to automate migration.");
    }
}

main().catch(console.error);
