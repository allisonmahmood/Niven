import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalSandboxStore } from "../src/store.js";
import type { SandboxState } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

function createState(): SandboxState {
  return {
    version: 1,
    accounts: {},
    events: [],
    idempotency: {},
    importedTransactions: {},
    orders: {},
    positions: {},
    securities: {},
    snapshot: null,
    transfers: {},
  };
}

describe("LocalSandboxStore", () => {
  it("reloads externally updated state without requiring an API restart", async () => {
    const dir = await createTempDir("niven-wealth-sandbox-store-");
    const statePath = path.join(dir, "state.json");
    const reader = new LocalSandboxStore(statePath);
    const writer = new LocalSandboxStore(statePath);

    await reader.replaceState(createState());

    const nextState = createState();
    nextState.accounts.account_1 = {
      accountId: "account_1",
      availableCashMicros: "1000000",
      cashBalanceMicros: "1000000",
      category: "cash",
      creditLimitMicros: null,
      currencyCode: "USD",
      holderCategory: "personal",
      importedAt: "2026-04-14T00:00:00.000Z",
      mask: "0000",
      name: "Checking",
      officialName: "Checking",
      permissions: {
        canTrade: false,
        canTransfer: true,
      },
      plaidAccountId: "plaid_account_1",
      sourceLabel: "seed",
      staticAvailableBalanceMicros: "1000000",
      staticCurrentBalanceMicros: "1000000",
      subtype: "checking",
      type: "depository",
    };

    await writer.replaceState(nextState);

    const reloaded = await reader.readState();

    expect(reloaded.accounts.account_1?.name).toBe("Checking");
  });
});
