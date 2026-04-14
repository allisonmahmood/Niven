import { createPlaidApiClient, type PlaidApiLike } from "@niven/plaid-client";

import { SandboxAuditLogger } from "./audit.js";
import { readSandboxRuntimeConfig } from "./config.js";
import { createSandboxStateFromPlaidSample } from "./importPlaid.js";
import { LocalSandboxStore } from "./store.js";
import type { SandboxRuntimeConfig } from "./types.js";

export interface ResetSandboxFromPlaidSampleResult {
  readonly importedAccountCount: number;
  readonly importedAt: string;
  readonly importedHoldingCount: number;
  readonly importedSecurityCount: number;
  readonly importedTransactionCount: number;
}

export async function resetSandboxFromPlaidSample(
  options: {
    readonly clock?: () => string;
    readonly plaidClient?: PlaidApiLike;
    readonly runtimeConfig?: SandboxRuntimeConfig;
    readonly store?: LocalSandboxStore;
  } = {},
): Promise<ResetSandboxFromPlaidSampleResult> {
  const runtimeConfig = options.runtimeConfig ?? readSandboxRuntimeConfig();
  const store = options.store ?? new LocalSandboxStore(runtimeConfig.statePath);
  const auditLogger = new SandboxAuditLogger(runtimeConfig.auditPath);
  const state = await createSandboxStateFromPlaidSample({
    ...(options.clock ? { clock: options.clock } : {}),
    plaidClient: options.plaidClient ?? createPlaidApiClient(),
  });

  await store.replaceState(state);
  await auditLogger.record({
    action: "sandbox_reset_from_plaid_sample",
    metadata: {
      source: "plaid_sandbox",
    },
    result: {
      accountCount: state.snapshot?.importedAccountCount ?? 0,
      holdingCount: state.snapshot?.importedHoldingCount ?? 0,
      securityCount: state.snapshot?.importedSecurityCount ?? 0,
      transactionCount: state.snapshot?.importedTransactionCount ?? 0,
    },
    status: "succeeded",
    ...(state.snapshot?.importedAt ? { timestamp: state.snapshot.importedAt } : {}),
  });

  return {
    importedAccountCount: state.snapshot?.importedAccountCount ?? 0,
    importedAt: state.snapshot?.importedAt ?? new Date().toISOString(),
    importedHoldingCount: state.snapshot?.importedHoldingCount ?? 0,
    importedSecurityCount: state.snapshot?.importedSecurityCount ?? 0,
    importedTransactionCount: state.snapshot?.importedTransactionCount ?? 0,
  };
}
