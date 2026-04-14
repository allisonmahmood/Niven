export interface WealthApiClientOptions {
  readonly apiToken?: string | undefined;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export interface WealthApiErrorDetails {
  readonly code?: string;
  readonly details?: unknown;
  readonly message: string;
}

export class WealthApiError extends Error {
  readonly code: string | undefined;
  readonly details: unknown;
  readonly status: number;

  constructor(status: number, error: WealthApiErrorDetails) {
    super(error.message);
    this.name = "WealthApiError";
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

interface WealthApiEnvelope<T> {
  readonly data?: T;
  readonly error?: WealthApiErrorDetails;
  readonly ok: boolean;
}

interface RequestOptions {
  readonly body?: unknown;
  readonly method?: "GET" | "POST";
  readonly query?: Record<string, string | number | boolean | undefined | readonly string[]>;
}

function appendQuery(url: URL, query: RequestOptions["query"]): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        url.searchParams.set(key, value.join(","));
      }

      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

export class WealthApiClient {
  private readonly apiToken: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WealthApiClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getAccount(accountId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/accounts/${accountId}`);
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request("/v1/config");
  }

  async getOrder(orderId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/orders/${orderId}`);
  }

  async getTransfer(transferId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/transfers/${transferId}`);
  }

  async listAccountActivity(
    accountId: string,
    query: RequestOptions["query"],
  ): Promise<Record<string, unknown>> {
    return this.request(`/v1/accounts/${accountId}/activity`, query ? { query } : {});
  }

  async listAccounts(): Promise<Record<string, unknown>> {
    return this.request("/v1/accounts");
  }

  async listHoldings(query: RequestOptions["query"]): Promise<Record<string, unknown>> {
    return this.request("/v1/holdings", query ? { query } : {});
  }

  async listOrders(query: RequestOptions["query"]): Promise<Record<string, unknown>> {
    return this.request("/v1/orders", query ? { query } : {});
  }

  async listSecurities(query: RequestOptions["query"]): Promise<Record<string, unknown>> {
    return this.request("/v1/securities", query ? { query } : {});
  }

  async listTransfers(query: RequestOptions["query"]): Promise<Record<string, unknown>> {
    return this.request("/v1/transfers", query ? { query } : {});
  }

  async submitTrade(body: unknown): Promise<Record<string, unknown>> {
    return this.request("/v1/orders", {
      body,
      method: "POST",
    });
  }

  async transferCash(body: unknown): Promise<Record<string, unknown>> {
    return this.request("/v1/transfers/internal", {
      body,
      method: "POST",
    });
  }

  private async request<T extends Record<string, unknown>>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl);
    appendQuery(url, options.query);

    const headers = new Headers({
      accept: "application/json",
    });

    if (this.apiToken) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }

    const requestInit: RequestInit = {
      headers,
      method: options.method ?? "GET",
    };

    if (body !== undefined) {
      requestInit.body = body;
    }

    const response = await this.fetchImpl(url, requestInit);

    let payload: WealthApiEnvelope<T> | undefined;
    try {
      payload = (await response.json()) as WealthApiEnvelope<T>;
    } catch {
      throw new WealthApiError(response.status, {
        message: `Wealth API ${response.status} response was not valid JSON.`,
      });
    }

    if (!response.ok || !payload.ok || !payload.data) {
      throw new WealthApiError(
        response.status,
        payload.error ?? {
          message: `Wealth API request failed with status ${response.status}.`,
        },
      );
    }

    return payload.data;
  }
}
