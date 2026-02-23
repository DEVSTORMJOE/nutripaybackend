const stellarService = require('./services/stellarService');
const StellarSdk = require('stellar-sdk');

async function runTest() {
  console.log("🚀 Starting Stellar Service Verification...");

  try {
    // 1. Create Student Wallet
    console.log("\n--- Step 1: Create Student Wallet ---");
    const studentWallet = await stellarService.createStudentWallet();
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
    await fetch(`https://friendbot.stellar.org?addr=${vendorKey.publicKey()}`);

    // Check balance before
    const { Horizon } = require('stellar-sdk');
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    let initialBalance = await server.loadAccount(studentWallet.publicKey);
    console.log("   Initial Balance:", initialBalance.balances.find(b => b.asset_type === 'native').balance);

    // Make Payment (10 XLM)
    await stellarService.makePayment(studentWallet.publicKey, vendorKey.publicKey(), "10");
    console.log("✅ Payment Successful!");

    // 3. Simulate Refund (Sponsor)
    const sponsorKey = Keypair.random(); // In reality, sponsor exists.
    // We need to fund sponsor minimally to exist if we are merging? 
    // Actually, mergeAccount requires destination to exist? Yes.
    // Let's fund sponsor first via friendbot for the test to work.
    console.log("\n--- Step 3: Simulate Refund ---");
    console.log("   Sponsor Public:", sponsorKey.publicKey());
    await fetch(`https://friendbot.stellar.org?addr=${sponsorKey.publicKey()}`);
    console.log("   Sponsor funded (for existence).");

    // Process Refund
    await stellarService.processRefund(studentWallet.publicKey, sponsorKey.publicKey());
    console.log("✅ Refund/Merge Successful!");

    console.log("\n🎉 All Tests Passed!");

  } catch (error) {
    console.error("\n❌ Test Failed:", error);
    if (error.response && error.response.data) {
      console.error("Error Details:", JSON.stringify(error.response.data.extras, null, 2));
    }
  }
}

runTest();
