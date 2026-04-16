import type { PiUiState } from "@niven/wealth-chat-bridge/pi-ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { useChatStore } from "./chatStore";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly close = vi.fn();
  onerror: ((event?: Event) => void) | null = null;
  readonly url: string;
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MessageEvent<string>) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(
    JSON.stringify({
      data: body,
      ok: true,
    }),
    {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    },
  );
}

function createState(overrides: Partial<PiUiState> = {}): PiUiState {
  return {
    compaction: undefined,
    isRunning: false,
    lastError: undefined,
    messages: [
      {
        content: [{ text: "Opening bell.", type: "text" }],
        createdAt: new Date("2026-04-16T09:00:00.000Z").toISOString(),
        id: "msg-1",
        role: "assistant",
        status: "complete",
      },
    ],
    phase: "idle",
    queue: { followUp: [], steering: [] },
    retry: undefined,
    sessionId: "session-1",
    threadId: "thread-1",
    toolExecutions: {},
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = vi.fn();
    useChatStore.setState({
      connection: "closed",
      error: null,
      state: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a thread on boot and renders the initial transcript", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ state: createState() }));

    render(<App />);

    expect(await screen.findByText("Opening bell.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/chat/threads",
      expect.objectContaining({ method: "POST" }),
    );
    expect(MockEventSource.instances[0]?.url).toBe("/api/v1/chat/threads/thread-1/events");
  });

  it("renders markdown formatting for assistant messages", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        state: createState({
          messages: [
            {
              content: [
                {
                  text: "**Current balance:** $500.00\n\nIf you want, I can also: - show recent transactions - compare other cash accounts",
                  type: "text",
                },
              ],
              createdAt: new Date("2026-04-16T09:00:00.000Z").toISOString(),
              id: "msg-markdown",
              role: "assistant",
              status: "complete",
            },
          ],
        }),
      }),
    );

    const { container } = render(<App />);

    expect(await screen.findByText("Current balance:", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Current balance:\*\*/)).not.toBeInTheDocument();
    expect(screen.getByText("show recent transactions")).toBeInTheDocument();
    expect(screen.getByText("compare other cash accounts")).toBeInTheDocument();
    expect(container.querySelectorAll(".message-card li")).toHaveLength(2);
  });

  it("keeps completed reasoning and tool payloads collapsed by default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        state: createState({
          messages: [
            {
              content: [
                {
                  text: "Checked balances and filtered for checking accounts.",
                  type: "reasoning",
                },
                {
                  args: { subtype: "checking" },
                  argsText: '{"subtype":"checking"}',
                  result: { accountCount: 2 },
                  status: "complete",
                  toolCallId: "tool-1",
                  toolName: "list_accounts",
                  type: "tool-call",
                },
                {
                  text: "**Current balance:** $500.00",
                  type: "text",
                },
              ],
              createdAt: new Date("2026-04-16T09:00:00.000Z").toISOString(),
              id: "msg-structured",
              role: "assistant",
              status: "complete",
            },
          ],
          toolExecutions: {
            "tool-1": {
              args: { subtype: "checking" },
              result: { accountCount: 2 },
              status: "complete",
              toolCallId: "tool-1",
              toolName: "list_accounts",
            },
          },
        }),
      }),
    );

    const { container } = render(<App />);

    await screen.findByText("Current balance:", { selector: "strong" });

    expect(container.querySelector(".reasoning-card")).not.toHaveAttribute("open");
    expect(container.querySelector(".tool-card")).not.toHaveAttribute("open");
    expect(container.querySelector(".execution-card")).not.toHaveAttribute("open");
  });

  it("sends composer text to the thread message endpoint", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ state: createState() }))
      .mockResolvedValueOnce(
        jsonResponse({
          state: createState({
            messages: [
              ...createState().messages,
              {
                content: [{ text: "What is my checking balance?", type: "text" }],
                createdAt: new Date("2026-04-16T09:01:00.000Z").toISOString(),
                id: "msg-2",
                role: "user",
              },
            ],
          }),
        }),
      );

    render(<App />);

    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Send a message");

    await user.type(composer, "What is my checking balance?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/v1/chat/threads/thread-1/messages",
        expect.objectContaining({
          body: JSON.stringify({ text: "What is my checking balance?" }),
          method: "POST",
        }),
      );
    });
  });

  it("submits with Enter from the composer input", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ state: createState() }))
      .mockResolvedValueOnce(
        jsonResponse({
          state: createState({
            messages: [
              ...createState().messages,
              {
                content: [{ text: "Show recent transfers", type: "text" }],
                createdAt: new Date("2026-04-16T09:01:10.000Z").toISOString(),
                id: "msg-enter",
                role: "user",
              },
            ],
          }),
        }),
      );

    render(<App />);

    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Send a message");

    await user.type(composer, "Show recent transfers{enter}");

    await waitFor(() => {
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/v1/chat/threads/thread-1/messages",
        expect.objectContaining({
          body: JSON.stringify({ text: "Show recent transfers" }),
          method: "POST",
        }),
      );
    });
  });

  it("applies live SSE snapshots to the transcript and queue panels", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ state: createState() }));

    render(<App />);

    await screen.findByText("Opening bell.");

    MockEventSource.instances[0]?.emit("state", {
      state: createState({
        isRunning: true,
        messages: [
          ...createState().messages,
          {
            content: [{ text: "Streaming a live update.", type: "text" }],
            createdAt: new Date("2026-04-16T09:01:30.000Z").toISOString(),
            id: "msg-live",
            role: "assistant",
            status: "running",
          },
        ],
        phase: "running",
        queue: {
          followUp: ["Summarize holdings after this."],
          steering: ["Use the safer cash account."],
        },
      }),
    });

    expect(await screen.findByText("Streaming a live update.")).toBeInTheDocument();
    expect(screen.getByText("Use the safer cash account.")).toBeInTheDocument();
    expect(screen.getByText("Summarize holdings after this.")).toBeInTheDocument();
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
  });

  it("sends steering when the run is already active", async () => {
    const runningState = createState({
      isRunning: true,
      phase: "running",
      messages: [
        {
          content: [{ text: "Working on it.", type: "text" }],
          createdAt: new Date("2026-04-16T09:02:00.000Z").toISOString(),
          id: "msg-running",
          role: "assistant",
          status: "running",
        },
      ],
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ state: runningState }))
      .mockResolvedValueOnce(jsonResponse({ state: runningState }));

    render(<App />);

    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Steer the active run");

    await user.type(composer, "Use the safer account.");
    await user.click(screen.getByRole("button", { name: "Steer run" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/v1/chat/threads/thread-1/messages",
        expect.objectContaining({
          body: JSON.stringify({
            text: "Use the safer account.",
            whileRunning: "steer",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("cancels an active run through the cancel endpoint", async () => {
    const runningState = createState({
      isRunning: true,
      phase: "running",
      messages: [
        {
          content: [{ text: "Working on it.", type: "text" }],
          createdAt: new Date("2026-04-16T09:02:00.000Z").toISOString(),
          id: "msg-running",
          role: "assistant",
          status: "running",
        },
      ],
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ state: runningState }))
      .mockResolvedValueOnce(jsonResponse({ state: runningState }));

    render(<App />);

    const user = userEvent.setup();
    await screen.findByText("Working on it.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/v1/chat/threads/thread-1/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
