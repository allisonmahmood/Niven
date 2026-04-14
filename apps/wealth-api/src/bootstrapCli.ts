import { resetSandboxFromPlaidSample } from "@niven/wealth-sandbox";

function writeHelp(): void {
  process.stdout.write(`Reset the local wealth sandbox from a fresh Plaid Sandbox snapshot.

Usage:
  pnpm sandbox:reset-from-plaid

This command:
- pulls sample accounts, balances, holdings, and transactions from Plaid Sandbox
- writes a fresh local wealth sandbox state file
- makes the local sandbox the system of record for later transfers and trades
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  writeHelp();
} else {
  try {
    const result = await resetSandboxFromPlaidSample();

    process.stdout.write(`Sandbox reset complete.\n`);
    process.stdout.write(`Imported at: ${result.importedAt}\n`);
    process.stdout.write(`Accounts: ${result.importedAccountCount}\n`);
    process.stdout.write(`Holdings: ${result.importedHoldingCount}\n`);
    process.stdout.write(`Securities: ${result.importedSecurityCount}\n`);
    process.stdout.write(`Transactions: ${result.importedTransactionCount}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Sandbox reset failed: ${message}\n`);
    process.exitCode = 1;
  }
}
