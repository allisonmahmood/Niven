import { ValidationError } from "@niven/shared";
import type { WealthService } from "@niven/wealth-tools/services";
import { describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/app.js";

function createService(overrides: Partial<WealthService> = {}): WealthService {
  return {
    authorizeTransfer: vi.fn(),
    cancelRecurringTransfer: vi.fn(),
    cancelTransfer: vi.fn(),
    createRecurringTransfer: vi.fn(),
    createSandboxTransactions: vi.fn(),
    createTransfer: vi.fn(),
    fireSandboxItemWebhook: vi.fn(),
    getAccounts: vi.fn(),
    getBalances: vi.fn(),
    getConfig: vi.fn(() => ({ sandboxOnly: true })),
    getHoldings: vi.fn(),
    getInvestmentTransactions: vi.fn(),
    getItem: vi.fn(),
    getTransactions: vi.fn(),
    getTransfer: vi.fn(),
    getTransferBalance: vi.fn(),
    getTransferCapabilities: vi.fn(),
    getTransferConfiguration: vi.fn(),
    linkSandboxItem: vi.fn(),
    listItems: vi.fn(),
    listRecurringTransfers: vi.fn(),
    listTransfers: vi.fn(),
    refreshTransactions: vi.fn(),
    resetSandboxLogin: vi.fn(),
    syncTransactions: vi.fn(),
    ...overrides,
  } as WealthService;
}

describe("wealth api", () => {
  it("requires a bearer token when configured", async () => {
    const app = createApiApp({
      apiToken: "secret-token",
      service: createService(),
    });

    const response = await app.request("/v1/items");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns route-level validation errors as JSON", async () => {
    const app = createApiApp({
      service: createService(),
    });

    const response = await app.request("/v1/items/item_1/transactions?pending=maybe");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("passes request bodies through to the service layer", async () => {
    const service = createService({
      linkSandboxItem: vi.fn(async (input) => {
        return {
          echoed: input,
          mode: "live",
        } as never;
      }),
    });
    const app = createApiApp({
      service,
    });

    const payload = {
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "link-1",
      },
      initialProducts: ["transactions"],
      institutionId: "ins_1",
    };

    const response = await app.request("/v1/items/sandbox/link", {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(service.linkSandboxItem).toHaveBeenCalledWith(payload);
  });

  it("normalizes service errors with the shared error envelope", async () => {
    const app = createApiApp({
      service: createService({
        listItems: vi.fn(async () => {
          throw new ValidationError("boom");
        }),
      }),
    });

    const response = await app.request("/v1/items");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe("boom");
  });
});
