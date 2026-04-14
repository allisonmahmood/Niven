import { describe, expect, it, vi } from "vitest";

import { WealthApiClient, type WealthApiError } from "../src/wealthApiClient.js";

describe("WealthApiClient", () => {
  it("sends bearer auth, JSON bodies, and query params", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            ok: true,
          },
          ok: true,
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      );
    });
    const client = new WealthApiClient({
      apiToken: "secret-token",
      baseUrl: "http://127.0.0.1:4321",
      fetchImpl,
    });

    await client.listAccountActivity("account_1", {
      limit: 25,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4321/v1/accounts/account_1/activity?limit=25");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-token");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
  });

  it("serializes mutation bodies for POST requests", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            mode: "dry_run",
          },
          ok: true,
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      );
    });
    const client = new WealthApiClient({
      baseUrl: "http://127.0.0.1:4321",
      fetchImpl,
    });

    await client.transferCash({
      amount: "25.00",
      control: {
        dryRun: true,
        idempotencyKey: "transfer-1",
      },
      fromAccountId: "checking",
      toAccountId: "savings",
    });

    const [, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe(
      JSON.stringify({
        amount: "25.00",
        control: {
          dryRun: true,
          idempotencyKey: "transfer-1",
        },
        fromAccountId: "checking",
        toAccountId: "savings",
      }),
    );
  });

  it("normalizes API errors from the shared envelope", async () => {
    const client = new WealthApiClient({
      baseUrl: "http://127.0.0.1:4321",
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: "UNAUTHORIZED",
              message: "Missing or invalid bearer token.",
            },
            ok: false,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 401,
          },
        );
      }),
    });

    await expect(client.listAccounts()).rejects.toEqual(
      expect.objectContaining<Partial<WealthApiError>>({
        code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token.",
        status: 401,
      }),
    );
  });
});
