const { ethers } = require("ethers");
const { Wdk } = require("@tetherto/wdk");
const { WalletManagerEvm } = require("@tetherto/wdk-wallet-evm");
require("dotenv").config({ path: "../.env" });

async function main() {
    // 1. Current address from PRIVATE_KEY
    const pk = process.env.PRIVATE_KEY;
    if (pk) {
        const wallet = new ethers.Wallet(pk);
        console.log("Current Agent Address (from PRIVATE_KEY):", wallet.address);
    }

    // 2. Generate new WDK mnemonic
    const mnemonic = Wdk.getRandomSeedPhrase();
    console.log("\nNew WDK Mnemonic (BIP-39):", mnemonic);

    // 3. New address from WDK
    const wdk = new Wdk(mnemonic);
    const walletManager = new WalletManagerEvm(mnemonic, {
        provider: process.env.SEPOLIA_RPC_URL
    });
    const account = await walletManager.getAccount(0);
    const newAddress = await account.getAddress();
    console.log("New Agent Address (from WDK Mnemonic):   ", newAddress);

    console.log("\nIMPORTANT: To use the official WDK, update .env with:");
    console.log(`AGENT_MNEMONIC="${mnemonic}"`);
    console.log("And ensure the new address is registered as an agent in LoanManager.");
}

main().catch(console.error);
