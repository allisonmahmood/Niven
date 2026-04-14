import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApprovalRequiredError, ConflictError } from "@niven/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createSandboxService } from "../src/service.js";
import { LocalSandboxStore } from "../src/store.js";
import type { SandboxRuntimeConfig, SandboxState } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

function createBaseState(): SandboxState {
  return {
    version: 1,
    accounts: {
      checking: {
        accountId: "checking",
        availableCashMicros: "100000000",
        cashBalanceMicros: "100000000",
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
        plaidAccountId: "plaid_checking",
        sourceLabel: "seed",
        staticAvailableBalanceMicros: "100000000",
        staticCurrentBalanceMicros: "100000000",
        subtype: "checking",
        type: "depository",
      },
      savings: {
        accountId: "savings",
        availableCashMicros: "25000000",
        cashBalanceMicros: "25000000",
        category: "cash",
        creditLimitMicros: null,
        currencyCode: "USD",
        holderCategory: "personal",
        importedAt: "2026-04-14T00:00:00.000Z",
        mask: "1111",
        name: "Savings",
        officialName: "Savings",
        permissions: {
          canTrade: false,
          canTransfer: true,
        },
        plaidAccountId: "plaid_savings",
        sourceLabel: "seed",
        staticAvailableBalanceMicros: "25000000",
        staticCurrentBalanceMicros: "25000000",
        subtype: "savings",
        type: "depository",
      },
      hsa: {
        accountId: "hsa",
        availableCashMicros: null,
        cashBalanceMicros: null,
        category: "restricted_cash",
        creditLimitMicros: null,
        currencyCode: "USD",
        holderCategory: "personal",
        importedAt: "2026-04-14T00:00:00.000Z",
        mask: "2222",
        name: "HSA",
        officialName: "HSA",
        permissions: {
          canTrade: false,
          canTransfer: false,
        },
        plaidAccountId: "plaid_hsa",
        sourceLabel: "seed",
        staticAvailableBalanceMicros: "6009000000",
        staticCurrentBalanceMicros: "6009000000",
        subtype: "hsa",
        type: "depository",
      },
      brokerage: {
        accountId: "brokerage",
        availableCashMicros: "500000000",
        cashBalanceMicros: "500000000",
        category: "investment",
        creditLimitMicros: null,
        currencyCode: "USD",
        holderCategory: "personal",
        importedAt: "2026-04-14T00:00:00.000Z",
        mask: "3333",
        name: "Brokerage",
        officialName: "Brokerage",
        permissions: {
          canTrade: true,
          canTransfer: false,
        },
        plaidAccountId: "plaid_brokerage",
        sourceLabel: "seed",
        staticAvailableBalanceMicros: "500000000",
        staticCurrentBalanceMicros: "700000000",
        subtype: "brokerage",
        type: "investment",
      },
    },
    events: [],
    idempotency: {},
    importedTransactions: {},
    orders: {},
    positions: {
      "brokerage:ABC": {
        accountId: "brokerage",
        costBasisMicros: "180000000",
        createdAt: "2026-04-14T00:00:00.000Z",
        positionId: "brokerage:ABC",
        quantityAtoms: "200000000",
        securityId: "ABC",
        updatedAt: "2026-04-14T00:00:00.000Z",
      },
    },
    securities: {
      ABC: {
        currencyCode: "USD",
        importedAt: "2026-04-14T00:00:00.000Z",
        isCashSecurity: false,
        name: "Acme Corp",
        plaidSecurityId: "plaid_ABC",
        priceAsOf: "2026-04-14",
        priceMicros: "100000000",
        securityId: "ABC",
        subtype: null,
        symbol: "ABC",
        type: "equity",
      },
    },
    snapshot: {
      importedAccountCount: 4,
      importedAt: "2026-04-14T00:00:00.000Z",
      importedHoldingCount: 1,
      importedSecurityCount: 1,
      importedTransactionCount: 0,
      source: "plaid_sandbox",
    },
    transfers: {},
  };
}

async function createHarness(runtimeOverrides: Partial<SandboxRuntimeConfig> = {}) {
  const dir = await createTempDir("niven-wealth-sandbox-");
  const runtimeConfig: SandboxRuntimeConfig = {
    auditPath: path.join(dir, "audit.log"),
    dataDirectory: dir,
    requireMutationApproval: false,
    statePath: path.join(dir, "state.json"),
    ...runtimeOverrides,
  };
  const store = new LocalSandboxStore(runtimeConfig.statePath);
  await store.replaceState(createBaseState());

  return {
    runtimeConfig,
    service: createSandboxService({
      runtimeConfig,
      store,
    }),
    store,
  };
}

describe("wealth sandbox service", () => {
  it("lists accounts with derived balances", async () => {
    const { service } = await createHarness();

    const result = await service.listAccounts();
    const accounts = result.accounts as Array<Record<string, unknown>>;
    const brokerage = accounts.find((account) => account.accountId === "brokerage");

    expect(accounts).toHaveLength(4);
    expect(brokerage).toEqual(
      expect.objectContaining({
        accountId: "brokerage",
        cashBalance: "500.00",
        currentBalance: "700.00",
      }),
    );
  });

  it("previews and executes internal cash transfers without losing money", async () => {
    const { service } = await createHarness();

    const preview = await service.transferCash({
      amount: "25.00",
      control: {
        approved: true,
        dryRun: true,
        idempotencyKey: "transfer-preview",
      },
      fromAccountId: "checking",
      toAccountId: "savings",
    });

    expect(preview.mode).toBe("dry_run");
    expect((preview.preview as Record<string, unknown>).resultingFromCurrentBalance).toBe("75.00");

    const live = await service.transferCash({
      amount: "25.00",
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "transfer-live",
      },
      fromAccountId: "checking",
      toAccountId: "savings",
    });

    expect(live.mode).toBe("live");

    const accounts = await service.listAccounts();
    const checking = (accounts.accounts as Array<Record<string, unknown>>).find((account) => {
      return account.accountId === "checking";
    });
    const savings = (accounts.accounts as Array<Record<string, unknown>>).find((account) => {
      return account.accountId === "savings";
    });

    expect(checking).toEqual(expect.objectContaining({ currentBalance: "75.00" }));
    expect(savings).toEqual(expect.objectContaining({ currentBalance: "50.00" }));
  });

  it("previews and executes external cash deposits into a checking account", async () => {
    const { service } = await createHarness();

    const preview = await service.depositCash({
      accountId: "checking",
      amount: "2400.00",
      control: {
        approval: {
          approved: true,
        },
        dryRun: true,
        idempotencyKey: "deposit-preview",
      },
      date: "2026-04-14",
      description: "Payday",
    });

    expect(preview.mode).toBe("dry_run");
    expect((preview.preview as Record<string, unknown>).resultingCurrentBalance).toBe("2500.00");

    const live = await service.depositCash({
      accountId: "checking",
      amount: "2400.00",
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "deposit-live",
      },
      date: "2026-04-14",
      description: "Payday",
    });

    expect(live.mode).toBe("live");

    const accounts = await service.listAccounts();
    const checking = (accounts.accounts as Array<Record<string, unknown>>).find((account) => {
      return account.accountId === "checking";
    });
    expect(checking).toEqual(
      expect.objectContaining({
        availableBalance: "2500.00",
        currentBalance: "2500.00",
      }),
    );

    const activity = await service.listAccountActivity("checking", { limit: 5 });
    expect(activity.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityType: "cash_deposit_in",
          amount: "2400.00",
          description: "Payday",
        }),
      ]),
    );
  });

  it("rejects transfers from non-transferable or underfunded accounts", async () => {
    const { service } = await createHarness();

    await expect(
      service.transferCash({
        amount: "10.00",
        control: {
          approval: {
            approved: true,
          },
          idempotencyKey: "transfer-hsa",
        },
        fromAccountId: "hsa",
        toAccountId: "checking",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      service.transferCash({
        amount: "1000.00",
        control: {
          approval: {
            approved: true,
          },
          idempotencyKey: "transfer-overdraft",
        },
        fromAccountId: "checking",
        toAccountId: "savings",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      service.depositCash({
        accountId: "hsa",
        amount: "10.00",
        control: {
          approval: {
            approved: true,
          },
          idempotencyKey: "deposit-hsa",
        },
        date: "2026-04-14",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("executes buys and sells with exact position and cash updates", async () => {
    const { service } = await createHarness();

    const buy = await service.submitTrade({
      accountId: "brokerage",
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "buy-abc",
      },
      quantity: "1.50",
      securityId: "ABC",
      side: "buy",
    });

    expect(buy.mode).toBe("live");

    let account = await service.getAccount("brokerage");
    expect((account.account as Record<string, unknown>).cashBalance).toBe("350.00");
    expect((account.holdings as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({
        quantity: "3.5",
      }),
    );

    const sell = await service.submitTrade({
      accountId: "brokerage",
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "sell-abc",
      },
      quantity: "0.50",
      securityId: "ABC",
      side: "sell",
    });

    expect(sell.mode).toBe("live");

    account = await service.getAccount("brokerage");
    expect((account.account as Record<string, unknown>).cashBalance).toBe("400.00");
    expect((account.holdings as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({
        quantity: "3",
      }),
    );
  });

  it("requires approval when mutation approvals are enabled", async () => {
    const { service } = await createHarness({
      requireMutationApproval: true,
    });

    await expect(
      service.submitTrade({
        accountId: "brokerage",
        control: {
          idempotencyKey: "buy-no-approval",
        },
        quantity: "1.00",
        securityId: "ABC",
        side: "buy",
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
});
