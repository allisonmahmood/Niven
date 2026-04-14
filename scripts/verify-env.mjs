#!/usr/bin/env node

const requiredPlaidKeys = ["PLAID_CLIENT_ID", "PLAID_SECRET"];
const missingKeys = requiredPlaidKeys.filter((key) => {
  const value = process.env[key];
  return typeof value !== "string" || value.trim().length === 0;
});

if (missingKeys.length > 0) {
  console.error(
    `[verify-env] Missing required Plaid environment variable${missingKeys.length > 1 ? "s" : ""}: ${missingKeys.join(", ")}`,
  );
  console.error("[verify-env] Put them in the repo root .env file or export them in your shell.");
  process.exit(1);
}

const plaidEnv = process.env.PLAID_ENV?.trim() || "sandbox";

if (plaidEnv !== "sandbox") {
  console.error("[verify-env] This build is sandbox-only. Set PLAID_ENV=sandbox.");
  process.exit(1);
}

console.log(`[verify-env] Plaid environment looks good. PLAID_ENV=${plaidEnv}`);
