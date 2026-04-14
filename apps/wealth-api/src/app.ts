import { NivenError, UnauthorizedError, ValidationError } from "@niven/shared";
import { createWealthService, type WealthService } from "@niven/wealth-tools/services";
import { Hono } from "hono";

export interface CreateApiAppOptions {
  readonly apiToken?: string;
  readonly service?: WealthService;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new ValidationError(`Invalid boolean value: ${value}`);
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Invalid integer value: ${value}`);
  }

  return parsed;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");

  if (contentLength === "0") {
    return {};
  }

  return request.json();
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = new Hono();
  const service = options.service ?? createWealthService();

  app.use("*", async (context, next) => {
    if (!options.apiToken || context.req.path === "/health") {
      await next();
      return;
    }

    const authorization = context.req.header("authorization");

    if (authorization !== `Bearer ${options.apiToken}`) {
      throw new UnauthorizedError("Missing or invalid bearer token.");
    }

    await next();
  });

  app.onError((error, context) => {
    if (error instanceof NivenError) {
      context.status(error.status as never);
      return context.json({
        error: {
          code: error.code,
          details: error.details,
          message: error.message,
        },
        ok: false,
      });
    }

    context.status(500);
    return context.json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
    });
  });

  app.get("/health", (context) => {
    return context.json({
      data: {
        status: "ok",
      },
      ok: true,
    });
  });

  app.get("/v1/config", (context) => {
    return context.json({
      data: service.getConfig(),
      ok: true,
    });
  });

  app.get("/v1/items", async (context) => {
    return context.json({
      data: await service.listItems(),
      ok: true,
    });
  });

  app.post("/v1/items/sandbox/link", async (context) => {
    return context.json({
      data: await service.linkSandboxItem(await readJsonBody(context.req.raw)),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId", async (context) => {
    return context.json({
      data: await service.getItem(context.req.param("itemId")),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId/accounts", async (context) => {
    return context.json({
      data: await service.getAccounts(context.req.param("itemId")),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId/balances", async (context) => {
    return context.json({
      data: await service.getBalances(context.req.param("itemId")),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/transactions/sync", async (context) => {
    return context.json({
      data: await service.syncTransactions(
        context.req.param("itemId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/transactions/refresh", async (context) => {
    return context.json({
      data: await service.refreshTransactions(
        context.req.param("itemId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId/transactions", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.getTransactions(context.req.param("itemId"), {
        accountId: query.accountId,
        endDate: query.endDate,
        limit: parseInteger(query.limit),
        pending: parseBoolean(query.pending),
        query: query.query,
        refresh: parseBoolean(query.refresh),
        startDate: query.startDate,
      }),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/transactions/sandbox/create", async (context) => {
    return context.json({
      data: await service.createSandboxTransactions(
        context.req.param("itemId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId/investments/holdings", async (context) => {
    return context.json({
      data: await service.getHoldings(context.req.param("itemId")),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId/investments/transactions", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.getInvestmentTransactions(context.req.param("itemId"), {
        accountIds: query.accountIds ? query.accountIds.split(",").filter(Boolean) : undefined,
        endDate: query.endDate,
        startDate: query.startDate,
      }),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/sandbox/reset-login", async (context) => {
    return context.json({
      data: await service.resetSandboxLogin(
        context.req.param("itemId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/sandbox/fire-webhook", async (context) => {
    return context.json({
      data: await service.fireSandboxItemWebhook(
        context.req.param("itemId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.get("/v1/transfers/configuration", async (context) => {
    return context.json({
      data: await service.getTransferConfiguration(),
      ok: true,
    });
  });

  app.get("/v1/transfers/balance", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.getTransferBalance({
        type: query.type,
      }),
      ok: true,
    });
  });

  app.get("/v1/items/:itemId/accounts/:accountId/transfers/capabilities", async (context) => {
    return context.json({
      data: await service.getTransferCapabilities(
        context.req.param("itemId"),
        context.req.param("accountId"),
      ),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/accounts/:accountId/transfers/authorize", async (context) => {
    return context.json({
      data: await service.authorizeTransfer(
        context.req.param("itemId"),
        context.req.param("accountId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/accounts/:accountId/transfers", async (context) => {
    return context.json({
      data: await service.createTransfer(
        context.req.param("itemId"),
        context.req.param("accountId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.get("/v1/transfers", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listTransfers({
        count: parseInteger(query.count),
        endDate: query.endDate,
        fundingAccountId: query.fundingAccountId,
        offset: parseInteger(query.offset),
        startDate: query.startDate,
      }),
      ok: true,
    });
  });

  app.get("/v1/transfers/recurring", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listRecurringTransfers({
        count: parseInteger(query.count),
        endTime: query.endTime,
        fundingAccountId: query.fundingAccountId,
        offset: parseInteger(query.offset),
        startTime: query.startTime,
      }),
      ok: true,
    });
  });

  app.get("/v1/transfers/by-authorization/:authorizationId", async (context) => {
    return context.json({
      data: await service.getTransfer({
        authorizationId: context.req.param("authorizationId"),
      }),
      ok: true,
    });
  });

  app.get("/v1/transfers/:transferId", async (context) => {
    return context.json({
      data: await service.getTransfer({
        transferId: context.req.param("transferId"),
      }),
      ok: true,
    });
  });

  app.post("/v1/transfers/:transferId/cancel", async (context) => {
    return context.json({
      data: await service.cancelTransfer(
        context.req.param("transferId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.post("/v1/items/:itemId/accounts/:accountId/transfers/recurring", async (context) => {
    return context.json({
      data: await service.createRecurringTransfer(
        context.req.param("itemId"),
        context.req.param("accountId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  app.post("/v1/transfers/recurring/:recurringTransferId/cancel", async (context) => {
    return context.json({
      data: await service.cancelRecurringTransfer(
        context.req.param("recurringTransferId"),
        await readJsonBody(context.req.raw),
      ),
      ok: true,
    });
  });

  return app;
}
