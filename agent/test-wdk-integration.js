const { wdk } = require("./wdk");
require("dotenv").config({ path: "../.env" });

async function testIntegration() {
    console.log("🚀 Testing Tether WDK Integration for FinAgentX...");

    try {
        // 1. Initialize WDK
        await wdk.init();
        
        // 2. Check Agent Address
        const agentAddr = wdk.getAgentAddress();
        console.log(`✅ WDK Initialized successfuly!`);
        console.log(`📡 Agent Address: ${agentAddr}`);

        // 3. Check Balances
        console.log(`📊 Checking balances for ${agentAddr}...`);
        const balances = await wdk.getWalletBalance(agentAddr);
        console.log(`   ETH:  ${balances.eth}`);
        console.log(`   USDT: ${balances.usdt}`);

        // 4. Check Contract connectivity
        console.log(`🔗 Checking contract connectivity...`);
        const nextLoanId = await wdk.getNextLoanId();
        console.log(`   Next Loan ID: ${nextLoanId}`);

        console.log("\n✨ WDK Integration Verified! ✨");
        if (balances.eth === "0.0000") {
            console.log("⚠️  WARNING: Your new agent address has 0 ETH. Please fund it with Sepolia ETH to perform transactions.");
        }
        
        process.exit(0);
    } catch (error) {
        console.error("❌ WDK Integration Test Failed:", error);
        process.exit(1);
    }
}

testIntegration();
