import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { WealthToolService } from "../src/wealthService.js";
import { createWealthTools } from "../src/wealthTools.js";

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

function createService(): WealthToolService {
  return {
    getAccount: vi.fn(),
    getConfig: vi.fn(),
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
  };
}

function getTool(name: string) {
  const tool = createWealthTools(createService()).find((entry) => entry.name === name);

  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool;
}

describe("wealth tools", () => {
  it("creates a visualization artifact for inline chart rendering", async () => {
    const tool = getTool("create_visualization");
    const result = await tool.execute(
      "tool-chart-1",
      {
        altText: "Bar chart comparing holdings market value by symbol.",
        spec: {
          chartType: "bar",
          data: [
            { marketValue: 1400, symbol: "AAPL" },
            { marketValue: 920, symbol: "MSFT" },
          ],
          series: [{ dataKey: "marketValue", name: "Market value" }],
          valueFormat: "currency",
          xKey: "symbol",
        },
        summary: "Comparing the two largest holdings by current market value.",
        title: "Top holdings",
      },
      undefined,
      undefined,
      createContext(["Show my top holdings as a chart"]),
    );

    expect(result.details).toEqual({
      altText: "Bar chart comparing holdings market value by symbol.",
      kind: "visualization",
      renderer: "echarts",
      spec: {
        chartType: "bar",
        data: [
          { marketValue: 1400, symbol: "AAPL" },
          { marketValue: 920, symbol: "MSFT" },
        ],
        series: [{ dataKey: "marketValue", name: "Market value" }],
        valueFormat: "currency",
        xKey: "symbol",
      },
      summary: "Comparing the two largest holdings by current market value.",
      title: "Top holdings",
      version: 1,
    });
  });

  it("rejects invalid visualization requests before returning tool details", async () => {
    const tool = getTool("create_visualization");

    const result = await tool.execute(
      "tool-chart-2",
      {
        altText: "Pie chart comparing holdings.",
        spec: {
          chartType: "pie",
          data: [{ marketValue: 1400, symbol: "AAPL" }],
          series: [{ dataKey: "marketValue", name: "Market value" }],
        },
        summary: "Missing labelKey.",
      },
      undefined,
      undefined,
      createContext(["Show my holdings as a pie chart"]),
    );

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      error: "Visualization validation failed.",
      retryable: true,
    });
    expect((result.details as { issues: string[] }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/labelKey/i)]),
    );
    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as { text: string }).text).toMatch(/labelKey/i);
  });
});
