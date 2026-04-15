import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type ExtensionContext, SessionManager } from "@mariozechner/pi-coding-agent";
import type { SandboxService } from "@niven/wealth-sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../../wealth-api/src/app.js";
import { WealthApiClient } from "../src/wealthApiClient.js";
import { createWealthTools } from "../src/wealthTools.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    }),
  );
});

function createContext(messages: string[] = []): ExtensionContext {
  const sessionManager = SessionManager.inMemory("/tmp/pi-wealth-tools");

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
    cwd: "/tmp/pi-wealth-tools",
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

function getTool(name: string, client: object, options?: Parameters<typeof createWealthTools>[1]) {
  const tool = createWealthTools(client as WealthApiClient, options).find(
    (entry) => entry.name === name,
  );

  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool;
}

function createService(overrides: Partial<SandboxService> = {}): SandboxService {
  return {
    getAccount: vi.fn(),
    getConfig: vi.fn(async () => ({ sandboxOnly: true })),
    getOrder: vi.fn(),
    getTransfer: vi.fn(),
    listAccountActivity: vi.fn(),
    listAccounts: vi.fn(),
    listHoldings: vi.fn(),
    listOrders: vi.fn(),
    listSecurities: vi.fn(),
    listTransfers: vi.fn(),
    submitTrade: vi.fn(),
    transferCash: vi.fn(),
    ...overrides,
  };
}

describe("wealth tools", () => {
  it("sends preview controls for internal cash transfers", async () => {
    const client = {
      transferCash: vi.fn(async (body) => {
        return {
          mode: "dry_run",
          request: body,
        };
      }),
    };
    const tool = getTool("move_cash", client);
    const result = await tool.execute(
      "tool-1",
      {
        amount: "25.00",
        executionMode: "preview",
        fromAccountId: "checking",
        idempotencyKey: "transfer-1",
        toAccountId: "savings",
      },
      undefined,
      undefined,
      createContext(["Preview moving cash"]),
    );

    expect(client.transferCash).toHaveBeenCalledWith({
      amount: "25.00",
      control: {
        approval: {
          approved: true,
          approvedBy: "wealth_agent_preview",
          rationale: "Preview-only mutation request.",
        },
        dryRun: true,
        idempotencyKey: "transfer-1",
      },
      description: undefined,
      fromAccountId: "checking",
      toAccountId: "savings",
    });
    expect(result.details).toEqual({
      mode: "dry_run",
      request: {
        amount: "25.00",
        control: {
          approval: {
            approved: true,
            approvedBy: "wealth_agent_preview",
            rationale: "Preview-only mutation request.",
          },
          dryRun: true,
          idempotencyKey: "transfer-1",
        },
        description: undefined,
        fromAccountId: "checking",
        toAccountId: "savings",
      },
    });
  });

  it("does not expose Plaid linking through the agent tool list", () => {
    expect(() => getTool("link_sandbox_item", {})).toThrow("Missing tool link_sandbox_item");
  });

  it("blocks live execution without an explicit approval message", async () => {
    const client = {
      submitTrade: vi.fn(),
    };
    const tool = getTool("submit_trade", client);

    await expect(
      tool.execute(
        "tool-2",
        {
          accountId: "brokerage",
          executionMode: "execute",
          quantity: "1.00",
          securityId: "ABC",
          side: "buy",
        },
        undefined,
        undefined,
        createContext(["Buy one share"]),
      ),
    ).rejects.toThrow('starting with "APPROVE:"');
    expect(client.submitTrade).not.toHaveBeenCalled();
  });

  it("allows live execution once the latest user message starts with APPROVE:", async () => {
    const client = {
      submitTrade: vi.fn(async (body) => {
        return {
          request: body,
        };
      }),
    };
    const tool = getTool("submit_trade", client);
    const result = await tool.execute(
      "tool-3",
      {
        accountId: "brokerage",
        executionMode: "execute",
        idempotencyKey: "trade-1",
        quantity: "1.00",
        securityId: "ABC",
        side: "buy",
      },
      undefined,
      undefined,
      createContext(["APPROVE: buy one share of ABC."]),
    );

    expect(client.submitTrade).toHaveBeenCalledWith({
      accountId: "brokerage",
      control: {
        approval: {
          approved: true,
          approvedBy: "latest_user_message",
          rationale: "APPROVE: buy one share of ABC.",
        },
        dryRun: false,
        idempotencyKey: "trade-1",
      },
      quantity: "1.00",
      securityId: "ABC",
      side: "buy",
    });
    expect(result.details).toEqual({
      request: {
        accountId: "brokerage",
        control: {
          approval: {
            approved: true,
            approvedBy: "latest_user_message",
            rationale: "APPROVE: buy one share of ABC.",
          },
          dryRun: false,
          idempotencyKey: "trade-1",
        },
        quantity: "1.00",
        securityId: "ABC",
        side: "buy",
      },
    });
  });

  it("routes allowed tools through the wealth API surface", async () => {
    const service = createService({
      listAccounts: vi.fn(async () => {
        return {
          accounts: [{ accountId: "checking" }],
          summary: {
            accountCount: 1,
          },
        };
      }),
    });
    const app = createApiApp({
      apiToken: "secret-token",
      service,
    });
    const client = new WealthApiClient({
      apiToken: "secret-token",
      baseUrl: "http://wealth.test",
      fetchImpl: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return app.request(request);
      },
    });
    const tool = getTool("list_accounts", client);
    const result = await tool.execute(
      "tool-4",
      {},
      undefined,
      undefined,
      createContext(["What accounts exist?"]),
    );

    expect(service.listAccounts).toHaveBeenCalledTimes(1);
    expect(result.details).toEqual({
      accounts: [{ accountId: "checking" }],
      summary: {
        accountCount: 1,
      },
    });
  });

  it("updates SOUL.md without requiring an approval message", async () => {
    const tempDir = await createTempDir("niven-wealth-tool-");
    const soulPath = path.join(tempDir, "SOUL.md");
    const auditPath = path.join(tempDir, "soul-updates.jsonl");
    const tool = getTool("update_soul", {}, { soulAuditPath: auditPath, soulPath });

    const result = await tool.execute(
      "tool-5",
      {
        content: `# Niven

You are Niven.

## Voice
- Be much more conversational.
- Keep answers short unless detail is requested.`,
      },
      undefined,
      undefined,
      createContext(["Please be more direct."]),
    );

    expect(result.details).toEqual({
      appliesOnNextSession: true,
      auditPath,
      contentBytes: Buffer.byteLength(
        `# Niven

You are Niven.

## Voice
- Be much more conversational.
- Keep answers short unless detail is requested.
`,
        "utf8",
      ),
      futureSessionsOnly: true,
      soulPath,
      updated: true,
    });
    await expect(readFile(soulPath, "utf8")).resolves.toContain("- Be much more conversational.");
    await expect(readFile(auditPath, "utf8")).resolves.toContain('"mode":"overwrite"');
  });
});
