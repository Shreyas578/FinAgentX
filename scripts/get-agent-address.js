const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const mnemonic = process.env.AGENT_MNEMONIC;
    if (!mnemonic) {
        console.error("AGENT_MNEMONIC not found in .env");
        process.exit(1);
    }
    const wallet = ethers.Wallet.fromPhrase(mnemonic);
    console.log(wallet.address);
}

main();
