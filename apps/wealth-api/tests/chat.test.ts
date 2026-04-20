import type { PiUiState, WealthChatThread } from "@niven/wealth-chat-bridge";
import type { SandboxService } from "@niven/wealth-sandbox";
import { describe, expect, it, vi } from "vitest";

import { createApiApp } from "../src/app.js";
import type { WealthChatRegistry } from "../src/chatRegistry.js";

function createService(overrides: Partial<SandboxService> = {}): SandboxService {
  return {
    depositCash: vi.fn(),
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

function createState(overrides: Partial<PiUiState> = {}): PiUiState {
  return {
    compaction: undefined,
    isRunning: false,
    lastError: undefined,
    messages: [],
    phase: "idle",
    queue: { followUp: [], steering: [] },
    retry: undefined,
    sessionId: "session-1",
    threadId: "thread-1",
    toolExecutions: {},
    ...overrides,
  };
}

function createThread(
  overrides: Partial<WealthChatThread> = {},
  state = createState(),
): WealthChatThread {
  return {
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(),
    followUp: vi.fn(async () => {}),
    getState: vi.fn(() => state),
    prompt: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    subscribe(listener) {
      listener(state);
      return () => {};
    },
    ...overrides,
  };
}

function createRegistry(thread: WealthChatThread): WealthChatRegistry {
  return {
    createThread: vi.fn(async () => thread),
    disposeThread: vi.fn(() => true),
    dispose: vi.fn(),
    getThread: vi.fn(() => thread),
  };
}

describe("wealth api chat routes", () => {
  it("creates a chat thread and returns the initial state", async () => {
    const thread = createThread();
    const app = createApiApp({
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.state.threadId).toBe("thread-1");
  });

  it("streams full state snapshots over SSE", async () => {
    const thread = createThread();
    const app = createApiApp({
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-1/events");
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Expected an SSE response body.");
    }

    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: state");
    expect(text).toContain('"threadId":"thread-1"');

    await reader.cancel();
  });

  it("accepts the API token in the SSE query string when auth is enabled", async () => {
    const thread = createThread();
    const app = createApiApp({
      apiToken: "secret-token",
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-1/events?apiToken=secret-token");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("returns the current thread state over the state endpoint", async () => {
    const thread = createThread({}, createState({ phase: "running", threadId: "thread-2" }));
    const app = createApiApp({
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-2/state");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.state.phase).toBe("running");
    expect(body.data.state.threadId).toBe("thread-2");
  });

  it("passes message text and active-run mode through to the thread", async () => {
    const thread = createThread();
    const app = createApiApp({
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-1/messages", {
      body: JSON.stringify({
        text: "Use the safe account.",
        whileRunning: "followUp",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(thread.sendMessage).toHaveBeenCalledWith("Use the safe account.", {
      whileRunning: "followUp",
    });
  });

  it("returns a validation error for malformed chat message JSON", async () => {
    const thread = createThread();
    const app = createApiApp({
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-1/messages", {
      body: '{"text":',
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Request body must be valid JSON.");
    expect(thread.sendMessage).not.toHaveBeenCalled();
  });

  it("disposes threads through the explicit dispose endpoint", async () => {
    const thread = createThread();
    const registry = createRegistry(thread);
    const app = createApiApp({
      chatRegistry: registry,
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-1/dispose", {
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(registry.disposeThread).toHaveBeenCalledWith("thread-1");
  });

  it("cancels the active run through the thread", async () => {
    const thread = createThread();
    const app = createApiApp({
      chatRegistry: createRegistry(thread),
      service: createService(),
    });

    const response = await app.request("/v1/chat/threads/thread-1/cancel", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(thread.cancel).toHaveBeenCalledTimes(1);
  });
});
