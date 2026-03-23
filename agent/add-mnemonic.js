const fs = require('fs');
const path = require('path');

async function main() {
    const { default: WDK } = await import("@tetherto/wdk");
    const mnemonic = WDK.getRandomSeedPhrase();
    const envPath = path.join(__dirname, '../.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    if (envContent.includes('AGENT_MNEMONIC')) {
        console.log("AGENT_MNEMONIC already exists in .env. Skipping.");
    } else {
        const newEnvContent = envContent + `\n\n# Tether WDK mnemonic (BIP-39)\nAGENT_MNEMONIC="${mnemonic}"\n`;
        fs.writeFileSync(envPath, newEnvContent);
        console.log("New AGENT_MNEMONIC generated and added to .env");
        console.log("Mnemonic:", mnemonic);
    }
}

main().catch(console.error);
