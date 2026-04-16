import { describe, expect, it, vi } from "vitest";

import {
  createPiUiBridge,
  getThreadAssistantText,
  type PiUiBridgeSession,
  type ThreadAssistantMessage,
} from "../src/piUiBridge.js";

function createAssistantMessage(options: {
  timestamp: number;
  content?: unknown[];
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
}) {
  return {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4",
    content: options.content ?? [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options.stopReason ?? "stop",
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    timestamp: options.timestamp,
  };
}

function createUserMessage(text: string, timestamp: number) {
  return {
    role: "user",
    content: text,
    timestamp,
  };
}

function createToolResultMessage(options: {
  toolCallId: string;
  toolName: string;
  timestamp: number;
  details?: unknown;
  isError?: boolean;
}) {
  return {
    role: "toolResult",
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    content: [],
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.isError !== undefined ? { isError: options.isError } : {}),
    timestamp: options.timestamp,
  };
}

function getAssistantMessages(state: { messages: unknown[] }): ThreadAssistantMessage[] {
  return state.messages.filter(
    (message): message is ThreadAssistantMessage =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "assistant",
  );
}

function getLatestAssistant(state: { messages: unknown[] }): ThreadAssistantMessage {
  const assistant = getAssistantMessages(state).at(-1);
  if (!assistant) {
    throw new Error("Expected an assistant message in bridge state.");
  }
  return assistant;
}

function createFakeSession(initialMessages: readonly unknown[] = []) {
  const listeners: Array<(event: unknown) => void> = [];
  let messages = [...initialMessages];

  const session: PiUiBridgeSession = {
    sessionId: "session-1",
    get messages() {
      return messages;
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };

  return {
    session,
    emit(event: unknown) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    setMessages(nextMessages: readonly unknown[]) {
      messages = [...nextMessages];
    },
  };
}

describe("PiUiBridge", () => {
  it("maps streaming state and reconciles the final message list on agent_end", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-1",
    });

    await bridge.sendMessage("What is my checking balance?");

    expect(fakeSession.session.prompt).toHaveBeenCalledWith("What is my checking balance?");
    expect(bridge.getState().messages).toHaveLength(1);
    expect(bridge.getState().messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "What is my checking balance?" }],
    });

    const toolTurnAssistant = createAssistantMessage({
      timestamp: 1_000,
      stopReason: "toolUse",
    });

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({ type: "turn_start" });
    fakeSession.emit({
      type: "queue_update",
      steering: ["Use the transfer-safe account only"],
      followUp: ["Also summarize recent activity"],
    });
    fakeSession.emit({
      type: "message_start",
      message: toolTurnAssistant,
    });

    const firstAssistantId = getLatestAssistant(bridge.getState()).id;

    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "text_start",
        contentIndex: 0,
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [{ type: "text", text: "" }],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Let me",
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [{ type: "text", text: "Let me" }],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: " check.",
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [{ type: "text", text: "Let me check." }],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "thinking_start",
        contentIndex: 1,
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "" },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 1,
        delta: "Need the balance tool.",
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "Need the balance tool." },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 2,
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "Need the balance tool." },
            { type: "toolCall", id: "tool-1", name: "get_balance", arguments: {} },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 2,
        delta: '{"account":"checking"',
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "Need the balance tool." },
            { type: "toolCall", id: "tool-1", name: "get_balance", arguments: {} },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 2,
        delta: "}",
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "Need the balance tool." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "get_balance",
              arguments: { account: "checking" },
            },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 2,
        toolCall: {
          type: "toolCall",
          id: "tool-1",
          name: "get_balance",
          arguments: { account: "checking" },
        },
        partial: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "Need the balance tool." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "get_balance",
              arguments: { account: "checking" },
            },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: toolTurnAssistant,
      assistantMessageEvent: {
        type: "done",
        reason: "toolUse",
        message: createAssistantMessage({
          timestamp: 1_000,
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Let me check." },
            { type: "thinking", thinking: "Need the balance tool." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "get_balance",
              arguments: { account: "checking" },
            },
          ],
        }),
      },
    });
    fakeSession.emit({
      type: "message_end",
      message: toolTurnAssistant,
    });

    let state = bridge.getState();
    const firstAssistant = getAssistantMessages(state)[0];
    expect(firstAssistant.id).toBe(firstAssistantId);
    expect(firstAssistant.status).toBe("running");
    expect(firstAssistant.content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "reasoning", text: "Need the balance tool." },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "get_balance",
        args: { account: "checking" },
        argsText: '{"account":"checking"}',
        status: "running",
      },
    ]);
    expect(state.toolExecutions["tool-1"]).toMatchObject({
      toolCallId: "tool-1",
      toolName: "get_balance",
      args: { account: "checking" },
      status: "pending",
    });
    expect(state.queue).toEqual({
      steering: ["Use the transfer-safe account only"],
      followUp: ["Also summarize recent activity"],
    });

    fakeSession.emit({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "get_balance",
      args: { account: "checking" },
    });
    fakeSession.emit({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "get_balance",
      args: { account: "checking" },
      partialResult: { progress: "50%" },
    });
    fakeSession.emit({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "get_balance",
      result: { balance: 1234 },
      isError: false,
    });
    fakeSession.emit({
      type: "turn_end",
      message: toolTurnAssistant,
      toolResults: [
        createToolResultMessage({
          toolCallId: "tool-1",
          toolName: "get_balance",
          timestamp: 1_001,
          details: { balance: 1234 },
        }),
      ],
    });
    fakeSession.emit({
      type: "queue_update",
      steering: [],
      followUp: [],
    });

    const finalAssistant = createAssistantMessage({
      timestamp: 1_002,
      stopReason: "stop",
    });

    fakeSession.emit({ type: "turn_start" });
    fakeSession.emit({
      type: "message_start",
      message: finalAssistant,
    });
    fakeSession.emit({
      type: "message_update",
      message: finalAssistant,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Your checking balance is $1,234.",
        partial: createAssistantMessage({
          timestamp: 1_002,
          stopReason: "stop",
          content: [{ type: "text", text: "Your checking balance is $1,234." }],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: finalAssistant,
      assistantMessageEvent: {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          timestamp: 1_002,
          stopReason: "stop",
          content: [{ type: "text", text: "Your checking balance is $1,234." }],
        }),
      },
    });
    fakeSession.emit({
      type: "message_end",
      message: finalAssistant,
    });
    fakeSession.emit({
      type: "turn_end",
      message: finalAssistant,
      toolResults: [],
    });

    const finalMessages = [
      createUserMessage("What is my checking balance?", 999),
      createAssistantMessage({
        timestamp: 1_000,
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Let me check." },
          { type: "thinking", thinking: "Need the balance tool." },
          {
            type: "toolCall",
            id: "tool-1",
            name: "get_balance",
            arguments: { account: "checking" },
          },
        ],
      }),
      createToolResultMessage({
        toolCallId: "tool-1",
        toolName: "get_balance",
        timestamp: 1_001,
        details: { balance: 1234 },
      }),
      createAssistantMessage({
        timestamp: 1_002,
        stopReason: "stop",
        content: [{ type: "text", text: "Your checking balance is $1,234." }],
      }),
    ];
    fakeSession.setMessages(finalMessages);
    fakeSession.emit({
      type: "agent_end",
      messages: finalMessages,
    });

    state = bridge.getState();
    const assistants = getAssistantMessages(state);

    expect(state.isRunning).toBe(false);
    expect(state.phase).toBe("idle");
    expect(state.queue).toEqual({ steering: [], followUp: [] });
    expect(state.messages).toHaveLength(3);
    expect(assistants[0]?.id).toBe(firstAssistantId);
    expect(assistants[0]?.content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "reasoning", text: "Need the balance tool." },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "get_balance",
        args: { account: "checking" },
        argsText: '{"account":"checking"}',
        result: { balance: 1234 },
        isError: false,
        status: "complete",
      },
    ]);
    expect(assistants[1]?.status).toBe("complete");
    const finalAssistantMessage = assistants[1];
    if (!finalAssistantMessage) {
      throw new Error("Expected a final assistant message after reconciliation.");
    }
    expect(getThreadAssistantText(finalAssistantMessage)).toBe("Your checking balance is $1,234.");
    expect(state.toolExecutions["tool-1"]).toMatchObject({
      partialResult: { progress: "50%" },
      result: { balance: 1234 },
      status: "complete",
    });
  });

  it("marks aborted output incomplete and returns to idle after agent_end", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-abort",
    });

    await bridge.cancelRun();
    expect(fakeSession.session.abort).toHaveBeenCalledTimes(1);

    const abortedAssistant = createAssistantMessage({
      timestamp: 2_000,
      stopReason: "aborted",
      errorMessage: "Request aborted.",
    });

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({
      type: "message_start",
      message: abortedAssistant,
    });
    fakeSession.emit({
      type: "message_update",
      message: abortedAssistant,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Partial answer",
        partial: createAssistantMessage({
          timestamp: 2_000,
          stopReason: "aborted",
          errorMessage: "Request aborted.",
          content: [{ type: "text", text: "Partial answer" }],
        }),
      },
    });
    fakeSession.emit({
      type: "message_update",
      message: abortedAssistant,
      assistantMessageEvent: {
        type: "error",
        reason: "aborted",
        error: createAssistantMessage({
          timestamp: 2_000,
          stopReason: "aborted",
          errorMessage: "Request aborted.",
          content: [{ type: "text", text: "Partial answer" }],
        }),
      },
    });
    fakeSession.emit({
      type: "agent_end",
      messages: [
        createAssistantMessage({
          timestamp: 2_000,
          stopReason: "aborted",
          errorMessage: "Request aborted.",
          content: [{ type: "text", text: "Partial answer" }],
        }),
      ],
    });

    const state = bridge.getState();
    const assistant = getLatestAssistant(state);

    expect(state.phase).toBe("idle");
    expect(state.isRunning).toBe(false);
    expect(state.lastError).toBe("Request aborted.");
    expect(assistant.status).toBe("incomplete");
    expect(getThreadAssistantText(assistant)).toBe("Partial answer");
  });

  it("keeps unresolved tool calls nonterminal after agent_end reconciliation", () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-interrupted-tool",
    });

    const interruptedAssistant = createAssistantMessage({
      timestamp: 3_000,
      stopReason: "toolUse",
    });

    fakeSession.emit({ type: "agent_start" });
    fakeSession.emit({
      type: "message_update",
      message: interruptedAssistant,
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "tool-2",
          name: "move_money",
          arguments: { amount: 50, from: "checking", to: "savings" },
        },
        partial: createAssistantMessage({
          timestamp: 3_000,
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "tool-2",
              name: "move_money",
              arguments: { amount: 50, from: "checking", to: "savings" },
            },
          ],
        }),
      },
    });

    const finalMessages = [
      createAssistantMessage({
        timestamp: 3_000,
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "tool-2",
            name: "move_money",
            arguments: { amount: 50, from: "checking", to: "savings" },
          },
        ],
      }),
    ];
    fakeSession.setMessages(finalMessages);
    fakeSession.emit({
      type: "agent_end",
      messages: finalMessages,
    });

    const state = bridge.getState();
    const assistant = getLatestAssistant(state);
    const toolPart = assistant.content[0];

    expect(state.toolExecutions["tool-2"]).toMatchObject({
      toolCallId: "tool-2",
      toolName: "move_money",
      args: { amount: 50, from: "checking", to: "savings" },
      status: "pending",
    });
    expect(toolPart).toEqual({
      type: "tool-call",
      toolCallId: "tool-2",
      toolName: "move_money",
      args: { amount: 50, from: "checking", to: "savings" },
      argsText: '{"amount":50,"from":"checking","to":"savings"}',
      status: "running",
    });
  });

  it("requires explicit steer or followUp while running and prefixes approvals", async () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-running-send",
    });

    fakeSession.emit({ type: "agent_start" });

    await expect(bridge.sendMessage("Handle this now")).rejects.toThrow(
      "Cannot send a message while the agent is running",
    );
    expect(fakeSession.session.steer).not.toHaveBeenCalled();
    expect(fakeSession.session.followUp).not.toHaveBeenCalled();

    await bridge.sendMessage("Handle this now", { whileRunning: "steer" });
    await bridge.approveLiveMutation("move $50 from checking to savings", {
      whileRunning: "followUp",
    });

    expect(fakeSession.session.steer).toHaveBeenCalledWith("Handle this now");
    expect(fakeSession.session.followUp).toHaveBeenCalledWith(
      "APPROVE: move $50 from checking to savings",
    );
    expect(bridge.getState().messages).toHaveLength(0);
  });

  it("surfaces retry and compaction phases while the run is active", () => {
    const fakeSession = createFakeSession();
    const bridge = createPiUiBridge({
      session: fakeSession.session,
      threadId: "thread-phases",
    });

    fakeSession.emit({ type: "agent_start" });
    expect(bridge.getState()).toMatchObject({
      phase: "running",
      isRunning: true,
    });

    fakeSession.emit({
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 1_500,
      errorMessage: "Upstream overloaded",
    });

    let state = bridge.getState();
    expect(state.phase).toBe("retrying");
    expect(state.retry).toEqual({
      attempt: 2,
      maxAttempts: 3,
      delayMs: 1_500,
      errorMessage: "Upstream overloaded",
    });

    fakeSession.emit({
      type: "auto_retry_end",
      success: true,
      attempt: 2,
    });

    state = bridge.getState();
    expect(state.phase).toBe("running");
    expect(state.retry).toBeUndefined();

    fakeSession.emit({
      type: "compaction_start",
      reason: "threshold",
    });

    state = bridge.getState();
    expect(state.phase).toBe("compacting");
    expect(state.compaction).toEqual({
      reason: "threshold",
      active: true,
    });

    fakeSession.emit({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    });

    state = bridge.getState();
    expect(state.phase).toBe("running");
    expect(state.compaction).toBeUndefined();

    fakeSession.emit({
      type: "auto_retry_start",
      attempt: 3,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: "Still overloaded",
    });
    fakeSession.emit({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: "Retries exhausted",
    });

    state = bridge.getState();
    expect(state.phase).toBe("error");
    expect(state.isRunning).toBe(false);
    expect(state.lastError).toBe("Retries exhausted");
  });
});
