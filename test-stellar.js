const stellarService = require('./services/stellarService');
const StellarSdk = require('stellar-sdk');

async function runTest() {
  console.log("🚀 Starting Stellar Service Verification...");

  try {
    // 1. Create Student Wallet
    console.log("\n--- Step 1: Create Student Wallet ---");
    const studentWallet = await stellarService.createWallet();
    console.log("✅ Student Wallet Created:");
    console.log("   Public:", studentWallet.publicKey);
    console.log("   Secret:", studentWallet.secret);

    // 2. Simulate Vendor
    const { Keypair } = require('stellar-sdk');
    const vendorKey = Keypair.random();
    console.log("\n--- Step 2: Simulate Vendor Payment ---");
    console.log("   Vendor Public:", vendorKey.publicKey());

    // Fund Vendor (Required for it to receive payments)
    console.log("   Funding Vendor...");
    const friendbotResponse = await fetch(`https://friendbot.stellar.org?addr=${vendorKey.publicKey()}`);
    await friendbotResponse.json();

    // Check balance before
    let initialBalanceXLM = await stellarService.getBalance(studentWallet.publicKey);
    console.log("   Initial Student Balance (XLM):", initialBalanceXLM);
    console.log("   Initial Student Balance (KES):", stellarService.XLM_to_KES(initialBalanceXLM));

    // Make Payment (100 KES = 5 XLM)
    const kesAmount = "100";
    console.log(`   Making Payment of ${kesAmount} KES...`);
    await stellarService.makePayment(studentWallet.secret, vendorKey.publicKey(), kesAmount);
    console.log("✅ Payment Successful!");
    
    // Check balance after
    let finalBalanceXLM = await stellarService.getBalance(studentWallet.publicKey);
    console.log("   Final Student Balance (XLM):", finalBalanceXLM);
    console.log("   Final Student Balance (KES):", stellarService.XLM_to_KES(finalBalanceXLM));

    // Wait, testing Vendor Balance
    let vendorBalanceXLM = await stellarService.getBalance(vendorKey.publicKey());
    console.log("   Final Vendor Balance (XLM):", vendorBalanceXLM);
    
    console.log("\n🎉 All Tests Passed!");

  } catch (error) {
    console.error("\n❌ Test Failed:", error);
    if (error.response && error.response.data) {
      console.error("Error Details:", JSON.stringify(error.response.data.extras, null, 2));
    }
  }
}

runTest();
