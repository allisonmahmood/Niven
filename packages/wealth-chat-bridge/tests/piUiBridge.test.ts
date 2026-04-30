import { describe, expect, it, vi } from "vitest";

import {
  createPiUiBridge,
  type PiUiBridgeSession,
  type ThreadAssistantMessage,
} from "../src/piUiBridge.js";
import { createVisualizationArtifact } from "../src/visualization.js";

function createAssistantMessage(options: {
  timestamp: number;
  content?: unknown[];
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
}) {
  return {
    api: "openai-codex-responses",
    content: options.content ?? [],
    model: "gpt-5.4",
    provider: "openai-codex",
    role: "assistant",
    stopReason: options.stopReason ?? "stop",
    timestamp: options.timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function createToolResultMessage(options: {
  toolCallId: string;
  toolName: string;
  timestamp: number;
  content?: unknown[];
  details?: unknown;
  isError?: boolean;
}) {
  return {
    content: options.content ?? [],
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.isError !== undefined ? { isError: options.isError } : {}),
    role: "toolResult",
    timestamp: options.timestamp,
    toolCallId: options.toolCallId,
    toolName: options.toolName,
  };
}

function createAgentToolEnvelope(details: unknown) {
  return {
    content: [{ text: JSON.stringify(details), type: "text" }],
    details,
  };
}

function getLatestAssistant(state: { messages: unknown[] }): ThreadAssistantMessage {
  const assistant = state.messages.findLast(
    (message): message is ThreadAssistantMessage =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "assistant",
  );

  if (!assistant) {
    throw new Error("Expected an assistant message.");
  }

  return assistant;
}

function createFakeSession(initialMessages: readonly unknown[] = []) {
  const listeners = new Set<(event: unknown) => void>();
  let messages = [...initialMessages];

  const session: PiUiBridgeSession = {
    sessionId: "session-1",
    get messages() {
      return messages;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };

  return {
    emit(event: unknown) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    session,
    setMessages(nextMessages: readonly unknown[]) {
      messages = [...nextMessages];
    },
  };
}

describe("PiUiBridge", () => {
  it("preserves structured visualization tool results from toolResult.details", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-visualization",
    });

    await bridge.sendMessage("Show me a holdings chart.");

    const toolTurnAssistant = createAssistantMessage({
      stopReason: "toolUse",
      timestamp: 1_000,
    });

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({ type: "turn_start" });
    fakeSession.emit({ type: "message_start", message: toolTurnAssistant });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        contentIndex: 0,
        partial: createAssistantMessage({
          content: [
            {
              arguments: {},
              id: "tool-chart-1",
              name: "create_visualization",
              type: "toolCall",
            },
          ],
          stopReason: "toolUse",
          timestamp: 1_000,
        }),
        type: "toolcall_start",
      },
    });
    fakeSession.emit({
      type: "tool_execution_start",
      args: {},
      toolCallId: "tool-chart-1",
      toolName: "create_visualization",
    });

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

    fakeSession.emit({
      type: "tool_execution_end",
      isError: false,
      result: artifact,
      toolCallId: "tool-chart-1",
      toolName: "create_visualization",
    });
    fakeSession.emit({
      type: "turn_end",
      message: toolTurnAssistant,
      toolResults: [
        createToolResultMessage({
          details: artifact,
          timestamp: 1_001,
          toolCallId: "tool-chart-1",
          toolName: "create_visualization",
        }),
      ],
    });

    const assistant = getLatestAssistant(bridge.getState());
    expect(assistant.content[0]).toMatchObject({
      args: {},
      argsText: "",
      isError: false,
      result: artifact,
      status: "complete",
      toolCallId: "tool-chart-1",
      toolName: "create_visualization",
      type: "tool-call",
    });
    expect(bridge.getState().toolExecutions["tool-chart-1"]).toMatchObject({
      result: artifact,
      status: "complete",
      toolName: "create_visualization",
    });
  });

  it("normalizes wrapped agent tool envelopes emitted during tool execution", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-visualization-envelope",
    });

    await bridge.sendMessage("Show my top holdings as a bar chart.");

    const toolTurnAssistant = createAssistantMessage({
      stopReason: "toolUse",
      timestamp: 2_000,
    });

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({ type: "turn_start" });
    fakeSession.emit({ type: "message_start", message: toolTurnAssistant });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        contentIndex: 0,
        partial: createAssistantMessage({
          content: [
            {
              arguments: { title: "Top holdings" },
              id: "tool-chart-2",
              name: "create_visualization",
              type: "toolCall",
            },
          ],
          stopReason: "toolUse",
          timestamp: 2_000,
        }),
        type: "toolcall_start",
      },
    });
    fakeSession.emit({
      type: "tool_execution_start",
      args: { title: "Top holdings" },
      toolCallId: "tool-chart-2",
      toolName: "create_visualization",
    });

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

    fakeSession.emit({
      type: "tool_execution_end",
      isError: false,
      result: createAgentToolEnvelope(artifact),
      toolCallId: "tool-chart-2",
      toolName: "create_visualization",
    });
    fakeSession.emit({
      type: "turn_end",
      message: toolTurnAssistant,
      toolResults: [
        createToolResultMessage({
          details: artifact,
          timestamp: 2_001,
          toolCallId: "tool-chart-2",
          toolName: "create_visualization",
        }),
      ],
    });

    const assistant = getLatestAssistant(bridge.getState());
    expect(assistant.content[0]).toMatchObject({
      result: artifact,
      status: "complete",
      toolCallId: "tool-chart-2",
      toolName: "create_visualization",
      type: "tool-call",
    });
    expect(bridge.getState().toolExecutions["tool-chart-2"]).toMatchObject({
      result: artifact,
      status: "complete",
      toolName: "create_visualization",
    });
  });

  it("preserves structured visualization error details when tool results omit error details", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-visualization-error",
    });

    await bridge.sendMessage("Show my holdings as a pie chart.");

    const toolTurnAssistant = createAssistantMessage({
      stopReason: "toolUse",
      timestamp: 3_000,
    });

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({ type: "turn_start" });
    fakeSession.emit({ type: "message_start", message: toolTurnAssistant });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        contentIndex: 0,
        partial: createAssistantMessage({
          content: [
            {
              arguments: { title: "Holdings pie" },
              id: "tool-chart-error",
              name: "create_visualization",
              type: "toolCall",
            },
          ],
          stopReason: "toolUse",
          timestamp: 3_000,
        }),
        type: "toolcall_start",
      },
    });
    fakeSession.emit({
      type: "tool_execution_start",
      args: { title: "Holdings pie" },
      toolCallId: "tool-chart-error",
      toolName: "create_visualization",
    });

    const errorPayload = {
      error: "Visualization validation failed.",
      issues: ["Pie visualizations require spec.labelKey."],
      retryHint: "Correct the visualization spec and call create_visualization again.",
      retryable: true,
    };

    fakeSession.emit({
      type: "tool_execution_end",
      isError: true,
      result: createAgentToolEnvelope(errorPayload),
      toolCallId: "tool-chart-error",
      toolName: "create_visualization",
    });
    fakeSession.emit({
      type: "turn_end",
      message: toolTurnAssistant,
      toolResults: [
        createToolResultMessage({
          content: [
            {
              text: "create_visualization failed.\nVisualization validation failed.\nIssues:\n- Pie visualizations require spec.labelKey.",
              type: "text",
            },
          ],
          isError: true,
          timestamp: 3_001,
          toolCallId: "tool-chart-error",
          toolName: "create_visualization",
        }),
      ],
    });

    const assistant = getLatestAssistant(bridge.getState());
    expect(assistant.content[0]).toMatchObject({
      isError: true,
      result: errorPayload,
      status: "incomplete",
      toolCallId: "tool-chart-error",
      toolName: "create_visualization",
      type: "tool-call",
    });
    expect(bridge.getState().toolExecutions["tool-chart-error"]).toMatchObject({
      isError: true,
      result: errorPayload,
      status: "error",
      toolName: "create_visualization",
    });
  });

  it("preserves error status when the final tool result omits isError", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-tool-error-status",
    });

    await bridge.sendMessage("Transfer $100 to savings.");

    const toolTurnAssistant = createAssistantMessage({
      stopReason: "toolUse",
      timestamp: 4_000,
    });
    const errorPayload = {
      error: "Approval missing.",
      retryable: false,
    };

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({ type: "turn_start" });
    fakeSession.emit({ type: "message_start", message: toolTurnAssistant });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        contentIndex: 0,
        partial: createAssistantMessage({
          content: [
            {
              arguments: { amount: "100.00" },
              id: "tool-transfer-1",
              name: "transfer_cash",
              type: "toolCall",
            },
          ],
          stopReason: "toolUse",
          timestamp: 4_000,
        }),
        type: "toolcall_start",
      },
    });
    fakeSession.emit({
      type: "tool_execution_start",
      args: { amount: "100.00" },
      toolCallId: "tool-transfer-1",
      toolName: "transfer_cash",
    });
    fakeSession.emit({
      type: "tool_execution_end",
      isError: true,
      result: errorPayload,
      toolCallId: "tool-transfer-1",
      toolName: "transfer_cash",
    });
    fakeSession.emit({
      type: "turn_end",
      message: toolTurnAssistant,
      toolResults: [
        createToolResultMessage({
          details: errorPayload,
          timestamp: 4_001,
          toolCallId: "tool-transfer-1",
          toolName: "transfer_cash",
        }),
      ],
    });

    const assistant = getLatestAssistant(bridge.getState());
    expect(assistant.content[0]).toMatchObject({
      isError: true,
      result: errorPayload,
      status: "incomplete",
      toolCallId: "tool-transfer-1",
      toolName: "transfer_cash",
      type: "tool-call",
    });
    expect(bridge.getState().toolExecutions["tool-transfer-1"]).toMatchObject({
      isError: true,
      result: errorPayload,
      status: "error",
      toolName: "transfer_cash",
    });
  });
});
