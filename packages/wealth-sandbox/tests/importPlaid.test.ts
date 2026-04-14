import { describe, expect, it, vi } from "vitest";

import { createSandboxStateFromPlaidSample } from "../src/importPlaid.js";

function createPlaidClient() {
  return {
    accountsBalanceGet: vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          accounts: [
            {
              account_id: "plaid_checking",
              balances: {
                available: 90,
                current: 100,
                iso_currency_code: "USD",
                limit: null,
              },
              holder_category: "personal",
              mask: "0000",
              name: "Plaid Checking",
              official_name: "Checking",
              subtype: "checking",
              type: "depository",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          accounts: [
            {
              account_id: "plaid_brokerage",
              balances: {
                available: null,
                current: 500,
                iso_currency_code: "USD",
                limit: null,
              },
              holder_category: "personal",
              mask: "1111",
              name: "Plaid Brokerage",
              official_name: "Brokerage",
              subtype: "brokerage",
              type: "investment",
            },
          ],
        },
      }),
    investmentsHoldingsGet: vi.fn().mockResolvedValue({
      data: {
        accounts: [],
        holdings: [
          {
            account_id: "plaid_brokerage",
            cost_basis: 1,
            institution_price: 1,
            institution_price_as_of: "2026-04-14",
            institution_value: 200,
            iso_currency_code: "USD",
            quantity: 200,
            security_id: "CASH",
          },
          {
            account_id: "plaid_brokerage",
            cost_basis: 45,
            institution_price: 50,
            institution_price_as_of: "2026-04-14",
            institution_value: 100,
            iso_currency_code: "USD",
            quantity: 2,
            security_id: "ABC",
          },
        ],
        item: {},
        request_id: "holdings-1",
        securities: [
          {
            is_cash_equivalent: true,
            iso_currency_code: "USD",
            name: "U S Dollar",
            security_id: "CASH",
            ticker_symbol: null,
            type: "cash",
          },
          {
            close_price: 50,
            close_price_as_of: "2026-04-14",
            is_cash_equivalent: false,
            iso_currency_code: "USD",
            name: "Acme Corp",
            security_id: "ABC",
            ticker_symbol: "ABC",
            type: "equity",
          },
        ],
      },
    }),
    itemPublicTokenExchange: vi.fn().mockResolvedValue({
      data: {
        access_token: "access_token",
        item_id: "item_id",
        request_id: "exchange-1",
      },
    }),
    sandboxPublicTokenCreate: vi.fn().mockResolvedValue({
      data: {
        public_token: "public_token",
        request_id: "sandbox-1",
      },
    }),
    transactionsSync: vi.fn().mockResolvedValue({
      data: {
        added: [
          {
            account_id: "plaid_checking",
            amount: -12.34,
            date: "2026-04-13",
            name: "Coffee Shop",
            pending: false,
            transaction_id: "txn_1",
          },
        ],
        has_more: false,
        modified: [],
        next_cursor: "cursor-1",
        removed: [],
        request_id: "sync-1",
      },
    }),
  };
}

describe("createSandboxStateFromPlaidSample", () => {
  it("normalizes Plaid data into sandbox-native accounts, holdings, and transactions", async () => {
    const state = await createSandboxStateFromPlaidSample({
      clock: () => "2026-04-14T00:00:00.000Z",
      plaidClient: createPlaidClient() as never,
    });

    expect(state.snapshot).toEqual(
      expect.objectContaining({
        importedAccountCount: 2,
        importedHoldingCount: 1,
        importedSecurityCount: 1,
        importedTransactionCount: 1,
      }),
    );
    expect(state.accounts.plaid_checking).toEqual(
      expect.objectContaining({
        category: "cash",
        cashBalanceMicros: "100000000",
      }),
    );
    expect(state.accounts.plaid_brokerage).toEqual(
      expect.objectContaining({
        category: "investment",
        cashBalanceMicros: "400000000",
        permissions: expect.objectContaining({
          canTrade: true,
          canTransfer: true,
        }),
      }),
    );
    expect(state.securities.ABC?.name).toBe("Acme Corp");
    expect(state.positions["plaid_brokerage:ABC"]?.quantityAtoms).toBe("200000000");
    expect(state.importedTransactions.txn_1?.name).toBe("Coffee Shop");
  });
});
