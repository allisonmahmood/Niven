import { NivenError, UnauthorizedError, ValidationError } from "@niven/shared";
import { createSandboxService, type SandboxService } from "@niven/wealth-sandbox";
import { Hono } from "hono";

export interface CreateApiAppOptions {
  readonly apiToken?: string;
  readonly service?: SandboxService;
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
  const service = options.service ?? createSandboxService();

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

  app.get("/v1/config", async (context) => {
    return context.json({
      data: await service.getConfig(),
      ok: true,
    });
  });

  app.get("/v1/accounts", async (context) => {
    return context.json({
      data: await service.listAccounts(),
      ok: true,
    });
  });

  app.get("/v1/accounts/:accountId", async (context) => {
    return context.json({
      data: await service.getAccount(context.req.param("accountId")),
      ok: true,
    });
  });

  app.get("/v1/accounts/:accountId/activity", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listAccountActivity(context.req.param("accountId"), {
        limit: parseInteger(query.limit),
      }),
      ok: true,
    });
  });

  app.get("/v1/holdings", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listHoldings({
        accountId: query.accountId,
        limit: parseInteger(query.limit),
      }),
      ok: true,
    });
  });

  app.get("/v1/securities", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listSecurities({
        limit: parseInteger(query.limit),
        query: query.query,
      }),
      ok: true,
    });
  });

  app.post("/v1/transfers/internal", async (context) => {
    return context.json({
      data: await service.transferCash(await readJsonBody(context.req.raw)),
      ok: true,
    });
  });

  app.get("/v1/transfers", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listTransfers({
        limit: parseInteger(query.limit),
      }),
      ok: true,
    });
  });

  app.get("/v1/transfers/:transferId", async (context) => {
    return context.json({
      data: await service.getTransfer(context.req.param("transferId")),
      ok: true,
    });
  });

  app.post("/v1/orders", async (context) => {
    return context.json({
      data: await service.submitTrade(await readJsonBody(context.req.raw)),
      ok: true,
    });
  });

  app.get("/v1/orders", async (context) => {
    const query = context.req.query();

    return context.json({
      data: await service.listOrders({
        accountId: query.accountId,
        limit: parseInteger(query.limit),
      }),
      ok: true,
    });
  });

  app.get("/v1/orders/:orderId", async (context) => {
    return context.json({
      data: await service.getOrder(context.req.param("orderId")),
      ok: true,
    });
  });

  return app;
}
