import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSandboxFromPlaidSample } from "../src/bootstrap.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("resetSandboxFromPlaidSample", () => {
  it("writes a fresh sandbox snapshot into the local state file", async () => {
    const dir = await createTempDir("niven-wealth-reset-");

    const result = await resetSandboxFromPlaidSample({
      plaidClient: {
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
              accounts: [],
            },
          }),
        investmentsHoldingsGet: vi.fn().mockResolvedValue({
          data: {
            accounts: [],
            holdings: [],
            item: {},
            request_id: "holdings-1",
            securities: [],
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
            added: [],
            has_more: false,
            modified: [],
            next_cursor: "cursor-1",
            removed: [],
            request_id: "sync-1",
          },
        }),
      } as never,
      runtimeConfig: {
        auditPath: path.join(dir, "audit.log"),
        dataDirectory: dir,
        requireMutationApproval: false,
        statePath: path.join(dir, "state.json"),
      },
    });

    expect(result.importedAccountCount).toBe(1);
    expect(result.importedHoldingCount).toBe(0);
    expect(result.importedTransactionCount).toBe(0);
  });
});
