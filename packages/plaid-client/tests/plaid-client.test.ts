import { CountryCode } from "plaid";
import { describe, expect, it, vi } from "vitest";

import { createSandboxItem, type PlaidApiLike, syncTransactions } from "../src/index.js";

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

describe("createSandboxItem", () => {
  it("creates a sandbox public token and exchanges it", async () => {
    const client = createPlaidClient({
      itemPublicTokenExchange: vi.fn(async () => {
        return {
          data: {
            access_token: "access-sandbox",
            item_id: "item-123",
            request_id: "exchange-request",
          },
        };
      }),
      sandboxPublicTokenCreate: vi.fn(async () => {
        return {
          data: {
            public_token: "public-sandbox",
            request_id: "sandbox-request",
          },
        };
      }),
    });

    const result = await createSandboxItem(
      {
        institutionId: "ins_109508",
        initialProducts: ["transactions"],
      },
      client,
    );

    expect(result.itemId).toBe("item-123");
    expect(result.accessToken).toBe("access-sandbox");
    expect(result.countryCodes).toEqual([CountryCode.Us]);
    expect(client.sandboxPublicTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        initial_products: ["transactions"],
        institution_id: "ins_109508",
      }),
    );
    expect(client.itemPublicTokenExchange).toHaveBeenCalledWith({
      public_token: "public-sandbox",
    });
  });
});

describe("syncTransactions", () => {
  it("aggregates paginated sync responses and returns the final cursor", async () => {
    const client = createPlaidClient({
      transactionsSync: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            added: [
              {
                account_id: "acc_1",
                amount: 15.75,
                date: "2026-04-11",
                pending: false,
                transaction_id: "txn_1",
              },
            ],
            has_more: true,
            modified: [],
            next_cursor: "cursor-1",
            removed: [],
            request_id: "req-1",
          },
        })
        .mockResolvedValueOnce({
          data: {
            added: [],
            has_more: false,
            modified: [
              {
                account_id: "acc_1",
                amount: -50.0,
                date: "2026-04-10",
                pending: false,
                transaction_id: "txn_2",
              },
            ],
            next_cursor: "cursor-2",
            removed: [{ transaction_id: "txn_3" }],
            request_id: "req-2",
          },
        }),
    });

    const result = await syncTransactions("access-token", null, client);

    expect(result.added).toHaveLength(1);
    expect(result.modified).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.nextCursor).toBe("cursor-2");
    expect(client.transactionsSync).toHaveBeenNthCalledWith(1, {
      access_token: "access-token",
    });
    expect(client.transactionsSync).toHaveBeenNthCalledWith(2, {
      access_token: "access-token",
      cursor: "cursor-1",
    });
  });
});
