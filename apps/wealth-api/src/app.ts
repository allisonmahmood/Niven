import { NivenError, UnauthorizedError, ValidationError } from "@niven/shared";
import { createSandboxService, type SandboxService } from "@niven/wealth-sandbox";
import { Hono } from "hono";
import { getThreadStateEnvelope, type WealthChatRegistry } from "./chatRegistry.js";

export interface CreateApiAppOptions {
  readonly apiToken?: string;
  readonly chatRegistry?: WealthChatRegistry;
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

  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationError("Request body must be valid JSON.");
    }

    throw error;
  }
}

function readSendMessageInput(body: unknown): {
  readonly text: string;
  readonly whileRunning?: "followUp" | "steer";
} {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Message body must be an object.");
  }

  const record = body as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const whileRunning =
    record.whileRunning === "steer" || record.whileRunning === "followUp"
      ? record.whileRunning
      : undefined;

  if (!text) {
    throw new ValidationError("text is required.");
  }

  return whileRunning ? { text, whileRunning } : { text };
}

function createSseResponse(
  request: Request,
  subscribe: (listener: (payload: string) => void) => () => void,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let unsubscribed = false;
      let unsubscribe = () => {
        unsubscribed = true;
      };

      const close = () => {
        if (unsubscribed) {
          return;
        }

        unsubscribe();
        unsubscribed = true;
        controller.close();
      };

      unsubscribe = subscribe((payload) => {
        controller.enqueue(encoder.encode(payload));
      });

      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = new Hono();
  const service = options.service ?? createSandboxService();
  const chatRegistry = options.chatRegistry;

  app.use("*", async (context, next) => {
    if (!options.apiToken || context.req.path === "/health") {
      await next();
      return;
    }

    const authorization = context.req.header("authorization");
    const bearerToken =
      authorization?.startsWith("Bearer ") === true ? authorization.slice("Bearer ".length) : null;
    const eventStreamToken = context.req.path.endsWith("/events")
      ? new URL(context.req.url).searchParams.get("apiToken")
      : null;

    if (bearerToken !== options.apiToken && eventStreamToken !== options.apiToken) {
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

  if (chatRegistry) {
    app.post("/v1/chat/threads", async (context) => {
      const thread = await chatRegistry.createThread();

      return context.json({
        data: getThreadStateEnvelope(thread),
        ok: true,
      });
    });

    app.get("/v1/chat/threads/:threadId", async (context) => {
      const thread = chatRegistry.getThread(context.req.param("threadId"));

      return context.json({
        data: getThreadStateEnvelope(thread),
        ok: true,
      });
    });

    app.get("/v1/chat/threads/:threadId/state", async (context) => {
      const thread = chatRegistry.getThread(context.req.param("threadId"));

      return context.json({
        data: getThreadStateEnvelope(thread),
        ok: true,
      });
    });

    app.get("/v1/chat/threads/:threadId/events", async (context) => {
      const thread = chatRegistry.getThread(context.req.param("threadId"));

      return createSseResponse(context.req.raw, (listener) => {
        return thread.subscribe((state) => {
          listener(`event: state\ndata: ${JSON.stringify({ state })}\n\n`);
        });
      });
    });

    app.post("/v1/chat/threads/:threadId/dispose", (context) => {
      chatRegistry.disposeThread(context.req.param("threadId"));
      return new Response(null, { status: 204 });
    });

    app.post("/v1/chat/threads/:threadId/messages", async (context) => {
      const thread = chatRegistry.getThread(context.req.param("threadId"));
      const body = readSendMessageInput(await readJsonBody(context.req.raw));

      await thread.sendMessage(
        body.text,
        body.whileRunning ? { whileRunning: body.whileRunning } : {},
      );

      return context.json({
        data: getThreadStateEnvelope(thread),
        ok: true,
      });
    });

    app.post("/v1/chat/threads/:threadId/cancel", async (context) => {
      const thread = chatRegistry.getThread(context.req.param("threadId"));
      await thread.cancel();

      return context.json({
        data: getThreadStateEnvelope(thread),
        ok: true,
      });
    });
  }

  return app;
}
