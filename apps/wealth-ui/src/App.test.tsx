import type { PiUiState } from "@niven/wealth-chat-bridge/pi-ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVisualizationArtifact } from "../../../packages/wealth-chat-bridge/src/visualization.ts";

const echartsSpies = vi.hoisted(() => {
  const setOption = vi.fn();
  const resize = vi.fn();
  const dispose = vi.fn();
  const init = vi.fn(() => ({
    dispose,
    resize,
    setOption,
  }));

  return { dispose, init, resize, setOption };
});

vi.mock("echarts", () => ({
  init: echartsSpies.init,
}));

import App from "./App";
import { useChatStore } from "./chatStore";

const runtimeGlobals = globalThis as typeof globalThis & {
  __NIVEN_API_TOKEN__?: unknown;
};

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
    echartsSpies.dispose.mockReset();
    echartsSpies.init.mockClear();
    echartsSpies.resize.mockReset();
    echartsSpies.setOption.mockReset();
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    delete runtimeGlobals.__NIVEN_API_TOKEN__;
    useChatStore.setState({
      connection: "closed",
      error: null,
      state: null,
    });
  });

  afterEach(() => {
    delete runtimeGlobals.__NIVEN_API_TOKEN__;
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

  it("threads the API token through bootstrap fetches and the SSE URL", async () => {
    runtimeGlobals.__NIVEN_API_TOKEN__ = "secret-token";
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ state: createState() }));

    render(<App />);

    expect(await screen.findByText("Opening bell.")).toBeInTheDocument();
    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];

    expect(path).toBe("/api/v1/chat/threads");
    expect(new Headers((init as RequestInit | undefined)?.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(MockEventSource.instances[0]?.url).toBe(
      "/api/v1/chat/threads/thread-1/events?apiToken=secret-token",
    );
  });

  it("renders markdown formatting for assistant messages inside primitives", async () => {
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

  it("renders visualization tool results inline and compiles them into an echarts option", async () => {
    const artifact = createVisualizationArtifact({
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
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        state: createState({
          messages: [
            {
              content: [
                {
                  args: { title: "Top holdings" },
                  argsText: '{"title":"Top holdings"}',
                  result: artifact,
                  status: "complete",
                  toolCallId: "tool-chart-1",
                  toolName: "create_visualization",
                  type: "tool-call",
                },
                {
                  text: "Here is your holdings chart.",
                  type: "text",
                },
              ],
              createdAt: new Date("2026-04-16T09:00:00.000Z").toISOString(),
              id: "msg-chart",
              role: "assistant",
              status: "complete",
            },
          ],
          toolExecutions: {
            "tool-chart-1": {
              args: { title: "Top holdings" },
              result: artifact,
              status: "complete",
              toolCallId: "tool-chart-1",
              toolName: "create_visualization",
            },
          },
        }),
      }),
    );

    render(<App />);

    expect(await screen.findByText("Top holdings")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Bar chart comparing holdings market value by symbol.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Here is your holdings chart.")).toBeInTheDocument();
    expect(echartsSpies.init).toHaveBeenCalledTimes(1);
    expect(echartsSpies.setOption).toHaveBeenCalledWith(
      expect.objectContaining({
        series: expect.any(Array),
        xAxis: expect.objectContaining({ type: "category" }),
      }),
      true,
    );
  });

  it("keeps completed generic tool payloads collapsed by default", async () => {
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

  it("falls back to a generic error card when a visualization tool call fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        state: createState({
          messages: [
            {
              content: [
                {
                  args: { title: "Top holdings" },
                  argsText: '{"title":"Top holdings"}',
                  isError: true,
                  result: {},
                  status: "incomplete",
                  toolCallId: "tool-chart-error",
                  toolName: "create_visualization",
                  type: "tool-call",
                },
              ],
              createdAt: new Date("2026-04-16T09:00:00.000Z").toISOString(),
              id: "msg-chart-error",
              role: "assistant",
              status: "complete",
            },
          ],
        }),
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 4, name: "create_visualization" }),
    ).toBeInTheDocument();
    expect(screen.getByText("incomplete")).toBeInTheDocument();
    expect(screen.getByText("{}")).toBeInTheDocument();
    expect(
      screen.queryByText("Preparing an inline chart from the current sandbox data."),
    ).not.toBeInTheDocument();
  });

  it("disposes the active thread when the app unmounts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ state: createState() }));

    const { unmount } = render(<App />);

    expect(await screen.findByText("Opening bell.")).toBeInTheDocument();
    unmount();

    await waitFor(() => {
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/v1/chat/threads/thread-1/dispose",
        expect.objectContaining({
          keepalive: true,
          method: "POST",
        }),
      );
    });
  });

  it("disposes a thread created after the app unmounts", async () => {
    let resolveCreateThread!: (value: Response) => void;
    const createThreadResponse = new Promise<Response>((resolve) => {
      resolveCreateThread = resolve;
    });

    vi.mocked(fetch)
      .mockReturnValueOnce(createThreadResponse)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { unmount } = render(<App />);
    unmount();

    resolveCreateThread(jsonResponse({ state: createState() }));

    await waitFor(() => {
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/v1/chat/threads/thread-1/dispose",
        expect.objectContaining({
          keepalive: true,
          method: "POST",
        }),
      );
    });
  });

  it("submits composer text to the thread message endpoint", async () => {
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

  it("clears stale transport errors after a successful send", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ state: createState() }))
      .mockResolvedValueOnce(jsonResponse({ state: createState() }));

    render(<App />);

    expect(await screen.findByText("Opening bell.")).toBeInTheDocument();
    await act(async () => {
      useChatStore.getState().setError("Network request failed.");
    });
    expect(await screen.findByText("Network request failed.")).toBeInTheDocument();

    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Send a message");

    await user.type(composer, "Retry the request.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.queryByText("Network request failed.")).not.toBeInTheDocument();
    });
  });
});
