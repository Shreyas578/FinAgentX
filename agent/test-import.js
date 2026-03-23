async function test() {
    try {
        const { default: WDK } = await import("@tetherto/wdk");
        const { default: WalletManagerEvm } = await import("@tetherto/wdk-wallet-evm");
        
        console.log("WDK loaded successfully!");
        const mnemonic = WDK.getRandomSeedPhrase();
        console.log("Random mnemonic:", mnemonic);
        
        const wdk = new WDK(mnemonic);
        console.log("WDK instance created.");
    } catch (err) {
        console.error("Failed to load WDK:", err);
    }
}

test();
