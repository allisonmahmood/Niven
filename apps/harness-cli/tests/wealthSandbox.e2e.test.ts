import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type ExtensionContext, SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createApiApp } from "../../wealth-api/src/app.js";
import { resetSandboxFromPlaidSample } from "../../wealth-api/src/bootstrap.js";
import { WealthApiClient } from "../src/wealthApiClient.js";
import { createWealthTools } from "../src/wealthTools.js";

const hasPlaidSandboxEnv = Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

function createContext(messages: string[]): ExtensionContext {
  const sessionManager = SessionManager.inMemory("/tmp/pi-wealth-sandbox");

  for (const message of messages) {
    sessionManager.appendMessage({
      content: message,
      role: "user",
      timestamp: Date.now(),
    });
  }

  return {
    abort() {},
    compact() {},
    cwd: "/tmp/pi-wealth-sandbox",
    getContextUsage() {
      return undefined;
    },
    getSystemPrompt() {
      return "";
    },
    hasPendingMessages() {
      return false;
    },
    hasUI: false,
    isIdle() {
      return true;
    },
    model: undefined,
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    sessionManager,
    shutdown() {},
    signal: undefined,
    ui: {} as ExtensionContext["ui"],
  };
}

function getTool(name: string, client: WealthApiClient) {
  const tool = createWealthTools(client).find((entry) => entry.name === name);

  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool;
}

describe.skipIf(!hasPlaidSandboxEnv)("wealth sandbox e2e", () => {
  it("imports a Plaid sample snapshot and uses sandbox-native reads and mutations through the restricted tools", async () => {
    const previousDataDir = process.env.NIVEN_SANDBOX_DATA_DIR;
    const previousApprovalSetting = process.env.NIVEN_REQUIRE_MUTATION_APPROVAL;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "niven-wealth-sandbox-"));

    process.env.NIVEN_SANDBOX_DATA_DIR = tempDir;
    process.env.NIVEN_REQUIRE_MUTATION_APPROVAL = "false";

    try {
      await resetSandboxFromPlaidSample();
      const app = createApiApp({
        apiToken: "sandbox-token",
      });
      const client = new WealthApiClient({
        apiToken: "sandbox-token",
        baseUrl: "http://wealth.test",
        fetchImpl: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          return app.request(request);
        },
      });

      const accounts = await getTool("list_accounts", client).execute(
        "tool-list-accounts",
        {},
        undefined,
        undefined,
        createContext(["Show my accounts."]),
      );
      const accountRows = (
        accounts.details as { readonly accounts: Array<Record<string, unknown>> }
      ).accounts;
      expect(accountRows.length).toBeGreaterThan(0);

      const holdings = await getTool("list_holdings", client).execute(
        "tool-list-holdings",
        {},
        undefined,
        undefined,
        createContext(["Show my holdings."]),
      );
      expect(
        (holdings.details as { readonly holdings: unknown[] }).holdings.length,
      ).toBeGreaterThan(0);

      const cashAccounts = accountRows.filter((account) => {
        const permissions = account.permissions as { readonly canTransfer?: boolean } | undefined;
        return permissions?.canTransfer === true;
      });
      expect(cashAccounts.length).toBeGreaterThanOrEqual(2);

      const previewTransfer = await getTool("move_cash", client).execute(
        "tool-preview-transfer",
        {
          amount: "25.00",
          executionMode: "preview",
          fromAccountId: cashAccounts[0]?.accountId as string,
          idempotencyKey: "preview-transfer",
          toAccountId: cashAccounts[1]?.accountId as string,
        },
        undefined,
        undefined,
        createContext(["Preview moving $25.00 between my cash accounts."]),
      );
      expect(previewTransfer.details).toEqual(
        expect.objectContaining({
          mode: "dry_run",
        }),
      );

      const liveTransfer = await getTool("move_cash", client).execute(
        "tool-live-transfer",
        {
          amount: "25.00",
          executionMode: "execute",
          fromAccountId: cashAccounts[0]?.accountId as string,
          idempotencyKey: "live-transfer",
          toAccountId: cashAccounts[1]?.accountId as string,
        },
        undefined,
        undefined,
        createContext(["APPROVE: move $25.00 between my cash accounts."]),
      );
      expect(liveTransfer.details).toEqual(
        expect.objectContaining({
          mode: "live",
        }),
      );

      const transfers = await getTool("list_cash_transfers", client).execute(
        "tool-list-transfers",
        {},
        undefined,
        undefined,
        createContext(["Show my transfers."]),
      );
      expect(
        (transfers.details as { readonly transfers: unknown[] }).transfers.length,
      ).toBeGreaterThan(0);
    } finally {
      process.env.NIVEN_SANDBOX_DATA_DIR = previousDataDir;
      process.env.NIVEN_REQUIRE_MUTATION_APPROVAL = previousApprovalSetting;
      await rm(tempDir, { force: true, recursive: true });
    }
  }, 120_000);
});
