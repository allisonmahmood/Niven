import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PlaidApiLike } from "@niven/plaid-client";
import { ApprovalRequiredError } from "@niven/shared";
import { describe, expect, it, vi } from "vitest";
import type { WealthRuntimeConfig } from "../src/config.js";
import { AuditLogger } from "../src/security/audit.js";
import { createWealthService } from "../src/services/platform.js";
import { LocalWealthStore } from "../src/store/localStore.js";

function createPlaidClient(overrides: Partial<PlaidApiLike> = {}): PlaidApiLike {
  return {
    accountsBalanceGet: vi.fn(),
    accountsGet: vi.fn(),
    investmentsHoldingsGet: vi.fn(),
    investmentsTransactionsGet: vi.fn(),
    itemGet: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
    sandboxItemFireWebhook: vi.fn(),
    sandboxItemResetLogin: vi.fn(),
    sandboxPublicTokenCreate: vi.fn(),
    sandboxTransactionsCreate: vi.fn(),
    sandboxTransferFireWebhook: vi.fn(),
    transactionsRefresh: vi.fn(),
    transactionsSync: vi.fn(),
    transferAuthorizationCreate: vi.fn(),
    transferBalanceGet: vi.fn(),
    transferCancel: vi.fn(),
    transferCapabilitiesGet: vi.fn(),
    transferConfigurationGet: vi.fn(),
    transferCreate: vi.fn(),
    transferGet: vi.fn(),
    transferList: vi.fn(),
    transferRecurringCancel: vi.fn(),
    transferRecurringCreate: vi.fn(),
    transferRecurringList: vi.fn(),
    ...overrides,
  } as PlaidApiLike;
}

async function createHarness(
  overrides: { plaidClient?: Partial<PlaidApiLike>; runtime?: Partial<WealthRuntimeConfig> } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "niven-wealth-tools-"));
  const runtimeConfig: WealthRuntimeConfig = {
    auditPath: path.join(dir, "audit.log"),
    dataDirectory: dir,
    requireMutationApproval: false,
    storePath: path.join(dir, "store.json"),
    ...overrides.runtime,
  };
  const store = new LocalWealthStore(runtimeConfig.storePath);
  const auditLogger = new AuditLogger(runtimeConfig.auditPath);
  const plaidClient = createPlaidClient(overrides.plaidClient);

  const service = createWealthService({
    auditLogger,
    plaidClient,
    runtimeConfig,
    store,
  });

  return { auditLogger, dir, plaidClient, runtimeConfig, service, store };
}

describe("wealth service mutations", () => {
  it("links a sandbox item and replays the cached result for the same idempotency key", async () => {
    const { plaidClient, service } = await createHarness({
      plaidClient: {
        itemPublicTokenExchange: vi.fn(async () => {
          return {
            data: {
              access_token: "access-linked",
              item_id: "item-linked",
              request_id: "exchange-1",
            },
          };
        }),
        sandboxPublicTokenCreate: vi.fn(async () => {
          return {
            data: {
              public_token: "public-linked",
              request_id: "sandbox-1",
            },
          };
        }),
      },
    });

    const input = {
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "link-1",
      },
      initialProducts: ["transactions"],
      institutionId: "ins_1",
    };

    const first = await service.linkSandboxItem(input);
    const second = await service.linkSandboxItem(input);

    expect(first.mode).toBe("live");
    expect(second.mode).toBe("live");
    expect(second.replayed).toBe(true);
    expect(plaidClient.sandboxPublicTokenCreate).toHaveBeenCalledTimes(1);
    expect("accessToken" in first.item).toBe(false);
  });

  it("blocks mutations when approvals are required and missing", async () => {
    const { service } = await createHarness({
      runtime: {
        requireMutationApproval: true,
      },
    });

    await expect(
      service.linkSandboxItem({
        control: {
          idempotencyKey: "blocked-1",
        },
        initialProducts: ["transactions"],
        institutionId: "ins_blocked",
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("syncs transactions into the local cache and serves transaction history", async () => {
    const { plaidClient, service, store } = await createHarness({
      plaidClient: {
        transactionsSync: vi.fn().mockResolvedValueOnce({
          data: {
            added: [
              {
                account_id: "acc_1",
                amount: 25.0,
                date: "2026-04-12",
                name: "Groceries",
                pending: false,
                transaction_id: "txn_1",
              },
            ],
            has_more: false,
            modified: [],
            next_cursor: "cursor-1",
            removed: [],
            request_id: "req-sync",
          },
        }),
      },
    });

    await store.saveItem({
      accessToken: "access-token",
      countryCodes: ["US"],
      createdAt: "2026-04-12T00:00:00.000Z",
      initialProducts: ["transactions"],
      institutionId: "ins_1",
      itemId: "item_1",
      lastTransactionsRefreshAt: null,
      lastTransactionsSyncAt: null,
      transactionsCursor: null,
    });

    const syncResult = await service.syncTransactions("item_1", {
      approval: {
        approved: true,
      },
      idempotencyKey: "sync-1",
    });
    const history = await service.getTransactions("item_1", {});

    expect(syncResult.mode).toBe("live");
    expect(history.transactions).toHaveLength(1);
    expect(history.summary.transactionCount).toBe(1);
    expect(plaidClient.transactionsSync).toHaveBeenCalledTimes(1);
  });

  it("supports dry-run transfer creation without calling Plaid", async () => {
    const { plaidClient, service, store } = await createHarness({
      plaidClient: {
        accountsGet: vi.fn(async () => {
          return {
            data: {
              accounts: [
                {
                  account_id: "acc_1",
                  balances: {
                    available: 100,
                    current: 100,
                  },
                  mask: "0000",
                  name: "Checking",
                  official_name: "Primary Checking",
                  subtype: "checking",
                  type: "depository",
                },
              ],
              item: {
                available_products: [],
                billed_products: [],
                institution_id: "ins_1",
                item_id: "item_1",
                products: ["transactions"],
              },
              request_id: "accounts-1",
            },
          };
        }),
        transferCreate: vi.fn(),
      },
    });

    await store.saveItem({
      accessToken: "access-token",
      countryCodes: ["US"],
      createdAt: "2026-04-12T00:00:00.000Z",
      initialProducts: ["transactions"],
      institutionId: "ins_1",
      itemId: "item_1",
      lastTransactionsRefreshAt: null,
      lastTransactionsSyncAt: null,
      transactionsCursor: null,
    });

    const result = await service.createTransfer("item_1", "acc_1", {
      authorizationId: "auth_1",
      control: {
        approval: {
          approved: true,
        },
        dryRun: true,
        idempotencyKey: "transfer-dry-run",
      },
      description: "Move funds",
    });

    expect(result.mode).toBe("dry_run");
    expect(plaidClient.transferCreate).not.toHaveBeenCalled();
  });

  it("writes mutation audit entries", async () => {
    const { runtimeConfig, service } = await createHarness({
      plaidClient: {
        itemPublicTokenExchange: vi.fn(async () => {
          return {
            data: {
              access_token: "access-linked",
              item_id: "item-linked",
              request_id: "exchange-1",
            },
          };
        }),
        sandboxPublicTokenCreate: vi.fn(async () => {
          return {
            data: {
              public_token: "public-linked",
              request_id: "sandbox-1",
            },
          };
        }),
      },
    });

    await service.linkSandboxItem({
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "audit-1",
      },
      initialProducts: ["transactions"],
      institutionId: "ins_audit",
    });

    const auditFile = await readFile(runtimeConfig.auditPath, "utf8");
    expect(auditFile).toContain("sandbox_link_item");
    expect(auditFile).not.toContain("access-linked");
  });
});
