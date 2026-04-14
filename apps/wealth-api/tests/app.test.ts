import { ValidationError } from "@niven/shared";
import type { SandboxService } from "@niven/wealth-sandbox";
import { describe, expect, it, vi } from "vitest";

import { createApiApp } from "../src/app.js";

function createService(overrides: Partial<SandboxService> = {}): SandboxService {
  return {
    getAccount: vi.fn(),
    getConfig: vi.fn(async () => ({ mode: "wealth_sandbox" })),
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

describe("wealth api", () => {
  it("requires a bearer token when configured", async () => {
    const app = createApiApp({
      apiToken: "secret-token",
      service: createService(),
    });

    const response = await app.request("/v1/accounts");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns route-level validation errors as JSON", async () => {
    const app = createApiApp({
      service: createService(),
    });

    const response = await app.request("/v1/accounts/account_1/activity?limit=abc");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("passes request bodies through to the sandbox service layer", async () => {
    const service = createService({
      transferCash: vi.fn(async (input) => {
        return {
          echoed: input,
          mode: "live",
        };
      }),
    });
    const app = createApiApp({
      service,
    });

    const payload = {
      amount: "25.00",
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "transfer-1",
      },
      fromAccountId: "checking",
      toAccountId: "savings",
    };

    const response = await app.request("/v1/transfers/internal", {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(service.transferCash).toHaveBeenCalledWith(payload);
  });

  it("normalizes sandbox service errors with the shared error envelope", async () => {
    const app = createApiApp({
      service: createService({
        listAccounts: vi.fn(async () => {
          throw new ValidationError("boom");
        }),
      }),
    });

    const response = await app.request("/v1/accounts");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe("boom");
  });
});
