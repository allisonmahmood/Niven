import type { AssistantMessageEvent, StopReason } from "@mariozechner/pi-ai";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export type PiUiPhase = "idle" | "running" | "retrying" | "compacting" | "error";
export type ThreadMessageStatus = "running" | "complete" | "incomplete" | "requires-action";

export interface ThreadTextPart {
  type: "text";
  text: string;
}

export interface ThreadReasoningPart {
  type: "reasoning";
  text: string;
}

export interface ThreadToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText: string;
  result?: unknown;
  isError?: boolean;
  status: ThreadMessageStatus;
}

export type MessagePart = ThreadTextPart | ThreadReasoningPart | ThreadToolCallPart;

export interface ThreadUserMessage {
  id: string;
  role: "user";
  content: MessagePart[];
  createdAt: Date;
}

export interface ThreadAssistantMessage {
  id: string;
  role: "assistant";
  content: MessagePart[];
  status: ThreadMessageStatus;
  createdAt: Date;
}

export type ThreadMessage = ThreadUserMessage | ThreadAssistantMessage;

export interface PiToolExecutionState {
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  status: "pending" | "running" | "complete" | "error";
}

export interface PiUiState {
  threadId: string;
  sessionId: string;
  isRunning: boolean;
  phase: PiUiPhase;
  queue: { steering: string[]; followUp: string[] };
  messages: ThreadMessage[];
  toolExecutions: Record<string, PiToolExecutionState>;
  retry?: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string };
  compaction?: { reason: "manual" | "threshold" | "overflow"; active: boolean };
  lastError?: string;
}

export interface PiUiBridgeSession {
  readonly messages: readonly unknown[];
  readonly sessionId?: string;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
}

export interface PiUiBridgeOptions {
  readonly session: PiUiBridgeSession;
  readonly threadId?: string;
}

export interface SendMessageOptions {
  readonly whileRunning?: "steer" | "followUp";
}

interface ToolPartLocation {
  messageId: string;
  contentIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): value is Record<string, string> {
  return typeof value[key] === "string";
}

function hasNumber(value: Record<string, unknown>, key: string): value is Record<string, number> {
  return typeof value[key] === "number";
}

function toDate(value: unknown): Date {
  return typeof value === "number" ? new Date(value) : new Date(0);
}

function getMessageTimestamp(message: unknown): number {
  if (!isRecord(message) || !hasNumber(message, "timestamp")) {
    return 0;
  }

  return typeof message.timestamp === "number" ? message.timestamp : 0;
}

function getMessageRole(message: unknown): string | undefined {
  if (!isRecord(message) || !hasString(message, "role")) {
    return undefined;
  }

  return message.role;
}

function getMessageContent(message: unknown): unknown[] {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content;
}

function getAssistantStopReason(message: unknown): StopReason | undefined {
  if (!isRecord(message) || !hasString(message, "stopReason")) {
    return undefined;
  }

  return message.stopReason as StopReason;
}

function getAssistantErrorMessage(message: unknown): string | undefined {
  if (!isRecord(message) || !hasString(message, "errorMessage")) {
    return undefined;
  }

  return message.errorMessage;
}

function isTextContentPart(content: unknown): content is { type: "text"; text: string } {
  return isRecord(content) && content.type === "text" && hasString(content, "text");
}

function isThinkingContentPart(
  content: unknown,
): content is { type: "thinking"; thinking: string } {
  return isRecord(content) && content.type === "thinking" && hasString(content, "thinking");
}

function isToolCallContentPart(
  content: unknown,
): content is { type: "toolCall"; id: string; name: string; arguments: unknown } {
  return (
    isRecord(content) &&
    content.type === "toolCall" &&
    hasString(content, "id") &&
    hasString(content, "name") &&
    "arguments" in content
  );
}

function isToolResultMessage(message: unknown): message is {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content?: unknown[];
  details?: unknown;
  isError?: boolean;
} {
  return (
    isRecord(message) &&
    message.role === "toolResult" &&
    hasString(message, "toolCallId") &&
    hasString(message, "toolName")
  );
}

function normalizeUserContent(message: unknown): MessagePart[] {
  if (!isRecord(message)) {
    return [];
  }

  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }

  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap((contentPart): MessagePart[] => {
    if (isTextContentPart(contentPart)) {
      return [{ type: "text", text: contentPart.text }];
    }

    return [];
  });
}

function deriveToolResultPayload(message: unknown): unknown {
  if (!isToolResultMessage(message)) {
    return undefined;
  }

  if ("details" in message && message.details !== undefined) {
    return message.details;
  }

  const text = (Array.isArray(message.content) ? message.content : [])
    .filter(isTextContentPart)
    .map((contentPart) => contentPart.text)
    .join("");

  return text.length > 0 ? text : undefined;
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

export function getThreadAssistantText(message: ThreadAssistantMessage): string {
  return message.content
    .filter((part): part is ThreadTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class PiUiBridge {
  private readonly session: PiUiBridgeSession;
  private readonly listeners = new Set<(state: PiUiState) => void>();
  private readonly messageIds = new Map<string, string>();
  private readonly toolPartLocations = new Map<string, ToolPartLocation>();
  private readonly unsubscribeFromSession: () => void;
  private state: PiUiState;
  private nextMessageId = 0;
  private phaseBeforeRetry: PiUiPhase = "idle";
  private phaseBeforeCompaction: PiUiPhase = "idle";

  constructor(options: PiUiBridgeOptions) {
    this.session = options.session;
    const sessionId = options.session.sessionId ?? "session";
    const threadId = options.threadId ?? sessionId;

    this.state = {
      threadId,
      sessionId,
      isRunning: false,
      phase: "idle",
      queue: { steering: [], followUp: [] },
      messages: [],
      toolExecutions: {},
    };

    this.reconcileMessagesFromAgent(this.session.messages);
    this.unsubscribeFromSession = this.session.subscribe((event) => {
      this.applyEvent(event);
    });
  }

  dispose(): void {
    this.unsubscribeFromSession();
    this.listeners.clear();
  }

  getState(): PiUiState {
    return cloneState(this.state);
  }

  subscribe(listener: (state: PiUiState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendMessage(text: string, options: SendMessageOptions = {}): Promise<void> {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    if (this.state.isRunning) {
      if (!options.whileRunning) {
        throw new Error(
          "Cannot send a message while the agent is running without choosing steer or followUp.",
        );
      }

      if (options.whileRunning === "steer") {
        await this.session.steer(trimmed);
      } else {
        await this.session.followUp(trimmed);
      }

      return;
    }

    const optimisticMessageId = this.appendUserMessage(trimmed);

    try {
      await this.session.prompt(trimmed);
    } catch (error) {
      this.state.messages = this.state.messages.filter(
        (message) => message.id !== optimisticMessageId,
      );
      this.emitState();
      throw error;
    }
  }

  async approveLiveMutation(text: string, options: SendMessageOptions = {}): Promise<void> {
    const trimmed = text.trim();
    const prompt = trimmed.toUpperCase().startsWith("APPROVE:") ? trimmed : `APPROVE: ${trimmed}`;
    await this.sendMessage(prompt, options);
  }

  async cancelRun(): Promise<void> {
    await this.session.abort();
  }

  applyEvent(event: AgentSessionEvent): void {
    this.state.sessionId = this.session.sessionId ?? this.state.sessionId;

    switch (event.type) {
      case "agent_start":
        this.state.isRunning = true;
        this.state.phase = "running";
        delete this.state.lastError;
        break;
      case "agent_end":
        this.reconcileMessagesFromAgent(event.messages);
        this.state.isRunning = false;
        this.state.phase = "idle";
        delete this.state.retry;
        delete this.state.compaction;
        break;
      case "turn_start":
        break;
      case "turn_end":
        this.handleTurnEnd(event.message, event.toolResults);
        break;
      case "queue_update":
        this.state.queue = {
          steering: [...event.steering],
          followUp: [...event.followUp],
        };
        break;
      case "message_start":
        if (getMessageRole(event.message) === "assistant") {
          this.ensureAssistantDraft(event.message);
        }
        break;
      case "message_update":
        this.handleAssistantMessageEvent(event.message, event.assistantMessageEvent);
        break;
      case "message_end":
        break;
      case "tool_execution_start":
        this.updateToolExecution(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
        });
        this.updateToolPart(event.toolCallId, (part) => {
          part.toolName = event.toolName;
          part.args = event.args;
          part.status = "running";
        });
        break;
      case "tool_execution_update":
        this.updateToolExecution(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
          status: "running",
        });
        this.updateToolPart(event.toolCallId, (part) => {
          part.toolName = event.toolName;
          part.args = event.args;
          part.status = "running";
        });
        break;
      case "tool_execution_end":
        this.updateToolExecution(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
          status: event.isError ? "error" : "complete",
        });
        this.updateToolPart(event.toolCallId, (part) => {
          part.toolName = event.toolName;
          part.result = event.result;
          part.isError = event.isError;
          part.status = event.isError ? "incomplete" : "complete";
        });
        break;
      case "auto_retry_start":
        this.phaseBeforeRetry = this.state.phase === "compacting" ? "running" : this.state.phase;
        this.state.phase = "retrying";
        this.state.retry = {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        };
        this.state.lastError = event.errorMessage;
        break;
      case "auto_retry_end":
        delete this.state.retry;
        if (event.success) {
          this.state.phase = this.phaseBeforeRetry === "idle" ? "running" : this.phaseBeforeRetry;
        } else {
          this.state.phase = "error";
          if (event.finalError) {
            this.state.lastError = event.finalError;
          }
          this.state.isRunning = false;
        }
        break;
      case "compaction_start":
        this.phaseBeforeCompaction = this.state.isRunning ? this.state.phase : "idle";
        this.state.phase = "compacting";
        this.state.compaction = { reason: event.reason, active: true };
        break;
      case "compaction_end":
        delete this.state.compaction;
        this.state.phase = this.state.isRunning
          ? this.phaseBeforeCompaction === "idle"
            ? "running"
            : this.phaseBeforeCompaction
          : "idle";
        if (event.errorMessage) {
          this.state.lastError = event.errorMessage;
        }
        break;
      default:
        break;
    }

    this.emitState();
  }

  private emitState(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private createMessageId(key: string): string {
    const existing = this.messageIds.get(key);
    if (existing) {
      return existing;
    }

    const id = `msg-${++this.nextMessageId}`;
    this.messageIds.set(key, id);
    return id;
  }

  private appendUserMessage(text: string): string {
    const id = this.createMessageId(`optimistic-user:${Date.now()}:${this.nextMessageId + 1}`);
    this.state.messages = [
      ...this.state.messages,
      {
        id,
        role: "user",
        content: [{ type: "text", text }],
        createdAt: new Date(),
      },
    ];
    this.emitState();
    return id;
  }

  private getMessageKey(role: string, timestamp: number): string {
    return `${role}:${timestamp}`;
  }

  private reconcileMessagesFromAgent(messages: readonly unknown[]): void {
    const toolResultsById = new Map<string, { result: unknown; isError: boolean }>();

    for (const message of messages) {
      if (!isToolResultMessage(message)) {
        continue;
      }

      const toolExecution = this.state.toolExecutions[message.toolCallId];
      toolResultsById.set(message.toolCallId, {
        result: toolExecution?.result ?? deriveToolResultPayload(message),
        isError: message.isError ?? toolExecution?.isError ?? false,
      });
    }

    const nextMessages: ThreadMessage[] = [];

    for (const message of messages) {
      const role = getMessageRole(message);
      const timestamp = getMessageTimestamp(message);

      if (role === "user") {
        nextMessages.push({
          id: this.createMessageId(this.getMessageKey(role, timestamp)),
          role: "user",
          content: normalizeUserContent(message),
          createdAt: toDate(timestamp),
        });
        continue;
      }

      if (role !== "assistant") {
        continue;
      }

      const content = getMessageContent(message).flatMap((contentPart): MessagePart[] => {
        if (isTextContentPart(contentPart)) {
          return [{ type: "text", text: contentPart.text }];
        }

        if (isThinkingContentPart(contentPart)) {
          return [{ type: "reasoning", text: contentPart.thinking }];
        }

        if (isToolCallContentPart(contentPart)) {
          const execution = this.state.toolExecutions[contentPart.id];
          const toolResult = toolResultsById.get(contentPart.id);
          const toolIsError = execution?.isError ?? toolResult?.isError;

          return [
            {
              type: "tool-call",
              toolCallId: contentPart.id,
              toolName: contentPart.name,
              args: execution?.args ?? contentPart.arguments,
              argsText: JSON.stringify(contentPart.arguments ?? {}),
              result: execution?.result ?? toolResult?.result,
              ...(toolIsError !== undefined ? { isError: toolIsError } : {}),
              status:
                execution?.status === "error"
                  ? "incomplete"
                  : execution?.status === "complete"
                    ? "complete"
                    : "complete",
            },
          ];
        }

        return [];
      });

      nextMessages.push({
        id: this.createMessageId(this.getMessageKey(role, timestamp)),
        role: "assistant",
        content,
        status: this.getAssistantFinalStatus(getAssistantStopReason(message)),
        createdAt: toDate(timestamp),
      });
    }

    this.state.messages = nextMessages;
    this.rebuildToolPartLocations();
  }

  private getAssistantFinalStatus(stopReason: StopReason | undefined): ThreadMessageStatus {
    switch (stopReason) {
      case "length":
      case "error":
      case "aborted":
        return "incomplete";
      default:
        return "complete";
    }
  }

  private rebuildToolPartLocations(): void {
    this.toolPartLocations.clear();

    for (const message of this.state.messages) {
      if (message.role !== "assistant") {
        continue;
      }

      message.content.forEach((part, contentIndex) => {
        if (part.type === "tool-call") {
          this.toolPartLocations.set(part.toolCallId, {
            messageId: message.id,
            contentIndex,
          });
        }
      });
    }
  }

  private ensureAssistantDraft(message: unknown): ThreadAssistantMessage {
    const timestamp = getMessageTimestamp(message);
    const id = this.createMessageId(this.getMessageKey("assistant", timestamp));
    const existing = this.state.messages.find(
      (candidate): candidate is ThreadAssistantMessage =>
        candidate.id === id && candidate.role === "assistant",
    );

    if (existing) {
      existing.status = "running";
      return existing;
    }

    const draft: ThreadAssistantMessage = {
      id,
      role: "assistant",
      content: [],
      status: "running",
      createdAt: toDate(timestamp),
    };

    this.state.messages = [...this.state.messages, draft];
    return draft;
  }

  private getAssistantDraft(message: unknown): ThreadAssistantMessage {
    const draft = this.ensureAssistantDraft(message);
    const current = this.state.messages.find(
      (candidate): candidate is ThreadAssistantMessage =>
        candidate.id === draft.id && candidate.role === "assistant",
    );

    if (!current) {
      throw new Error(`Assistant draft ${draft.id} is missing from bridge state.`);
    }

    return current;
  }

  private ensureMessagePart<TPart extends MessagePart>(
    message: ThreadAssistantMessage,
    contentIndex: number,
    expectedType: TPart["type"],
    createPart: () => TPart,
  ): TPart {
    const existing = message.content[contentIndex];

    if (!existing || existing.type !== expectedType) {
      const nextPart = createPart();
      if (contentIndex >= message.content.length) {
        message.content.push(nextPart);
      } else {
        message.content.splice(contentIndex, 0, nextPart);
      }
    }

    return message.content[contentIndex] as TPart;
  }

  private handleAssistantMessageEvent(message: unknown, event: AssistantMessageEvent): void {
    const draft = this.getAssistantDraft(message);

    switch (event.type) {
      case "start":
        break;
      case "text_start":
        this.ensureMessagePart(draft, event.contentIndex, "text", () => ({
          type: "text",
          text: "",
        }));
        break;
      case "text_delta": {
        const textPart = this.ensureMessagePart(draft, event.contentIndex, "text", () => ({
          type: "text",
          text: "",
        }));
        textPart.text += event.delta;
        break;
      }
      case "text_end":
        this.ensureMessagePart(draft, event.contentIndex, "text", () => ({
          type: "text",
          text: event.content,
        })).text = event.content;
        break;
      case "thinking_start":
        this.ensureMessagePart(draft, event.contentIndex, "reasoning", () => ({
          type: "reasoning",
          text: "",
        }));
        break;
      case "thinking_delta": {
        const reasoningPart = this.ensureMessagePart(
          draft,
          event.contentIndex,
          "reasoning",
          () => ({
            type: "reasoning",
            text: "",
          }),
        );
        reasoningPart.text += event.delta;
        break;
      }
      case "thinking_end":
        this.ensureMessagePart(draft, event.contentIndex, "reasoning", () => ({
          type: "reasoning",
          text: event.content,
        })).text = event.content;
        break;
      case "toolcall_start": {
        const partialTool = this.getToolCallFromPartial(event);
        const toolPart = this.ensureMessagePart(draft, event.contentIndex, "tool-call", () => ({
          type: "tool-call",
          toolCallId: partialTool?.id ?? `pending-tool-call-${event.contentIndex}`,
          toolName: partialTool?.name ?? "tool",
          args: partialTool?.arguments,
          argsText: "",
          status: "running",
        }));
        this.toolPartLocations.set(toolPart.toolCallId, {
          messageId: draft.id,
          contentIndex: event.contentIndex,
        });
        break;
      }
      case "toolcall_delta": {
        const partialTool = this.getToolCallFromPartial(event);
        const toolPart = this.ensureMessagePart(draft, event.contentIndex, "tool-call", () => ({
          type: "tool-call",
          toolCallId: partialTool?.id ?? `pending-tool-call-${event.contentIndex}`,
          toolName: partialTool?.name ?? "tool",
          args: partialTool?.arguments,
          argsText: "",
          status: "running",
        }));
        toolPart.argsText += event.delta;
        if (partialTool?.id) {
          toolPart.toolCallId = partialTool.id;
        }
        if (partialTool?.name) {
          toolPart.toolName = partialTool.name;
        }
        if (partialTool && "arguments" in partialTool) {
          toolPart.args = partialTool.arguments;
        }
        this.toolPartLocations.set(toolPart.toolCallId, {
          messageId: draft.id,
          contentIndex: event.contentIndex,
        });
        break;
      }
      case "toolcall_end": {
        const toolPart = this.ensureMessagePart(draft, event.contentIndex, "tool-call", () => ({
          type: "tool-call",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          args: event.toolCall.arguments,
          argsText: "",
          status: "running",
        }));
        toolPart.toolCallId = event.toolCall.id;
        toolPart.toolName = event.toolCall.name;
        toolPart.args = event.toolCall.arguments;
        if (!toolPart.argsText) {
          toolPart.argsText = JSON.stringify(event.toolCall.arguments ?? {});
        }
        this.toolPartLocations.set(toolPart.toolCallId, {
          messageId: draft.id,
          contentIndex: event.contentIndex,
        });
        this.updateToolExecution(event.toolCall.id, {
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          args: event.toolCall.arguments,
          status: "pending",
        });
        break;
      }
      case "done":
        if (event.reason === "stop") {
          draft.status = "complete";
        } else if (event.reason === "length") {
          draft.status = "incomplete";
        }
        break;
      case "error":
        draft.status = "incomplete";
        if (event.reason === "error") {
          this.state.phase = "error";
          this.state.isRunning = false;
        }
        {
          const errorMessage = getAssistantErrorMessage(event.error);
          if (errorMessage) {
            this.state.lastError = errorMessage;
          }
        }
        break;
      default:
        break;
    }
  }

  private getToolCallFromPartial(
    event: Extract<
      AssistantMessageEvent,
      { type: "toolcall_start" | "toolcall_delta" | "toolcall_end" }
    >,
  ): { id?: string; name?: string; arguments?: unknown } | undefined {
    if (!("partial" in event) || !isRecord(event.partial)) {
      return undefined;
    }

    const content = getMessageContent(event.partial)[event.contentIndex];
    if (!isToolCallContentPart(content)) {
      return undefined;
    }

    return {
      id: content.id,
      name: content.name,
      arguments: content.arguments,
    };
  }

  private updateToolExecution(
    toolCallId: string,
    update: Partial<PiToolExecutionState> & Pick<PiToolExecutionState, "toolCallId" | "toolName">,
  ): void {
    const current = this.state.toolExecutions[toolCallId] ?? {
      toolCallId,
      toolName: update.toolName,
      args: update.args,
      status: "pending" as const,
    };

    this.state.toolExecutions = {
      ...this.state.toolExecutions,
      [toolCallId]: {
        ...current,
        ...update,
      },
    };
  }

  private updateToolPart(toolCallId: string, update: (part: ThreadToolCallPart) => void): void {
    const location = this.toolPartLocations.get(toolCallId);

    if (!location) {
      return;
    }

    const message = this.state.messages.find(
      (candidate): candidate is ThreadAssistantMessage =>
        candidate.id === location.messageId && candidate.role === "assistant",
    );

    if (!message) {
      return;
    }

    const part = message.content[location.contentIndex];
    if (!part || part.type !== "tool-call") {
      return;
    }

    update(part);
  }

  private handleTurnEnd(message: unknown, toolResults: readonly unknown[]): void {
    for (const toolResult of toolResults) {
      if (!isToolResultMessage(toolResult)) {
        continue;
      }

      const existing = this.state.toolExecutions[toolResult.toolCallId];
      const result = existing?.result ?? deriveToolResultPayload(toolResult);
      const status = toolResult.isError ? "error" : "complete";

      this.updateToolExecution(toolResult.toolCallId, {
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        args: existing?.args,
        result,
        isError: toolResult.isError ?? false,
        status,
      });
      this.updateToolPart(toolResult.toolCallId, (part) => {
        part.result = result;
        part.isError = toolResult.isError ?? false;
        part.status = toolResult.isError ? "incomplete" : "complete";
      });
    }

    const timestamp = getMessageTimestamp(message);
    const assistantId = this.messageIds.get(this.getMessageKey("assistant", timestamp));
    const assistantMessage = this.state.messages.find(
      (candidate): candidate is ThreadAssistantMessage =>
        candidate.id === assistantId && candidate.role === "assistant",
    );

    if (assistantMessage && assistantMessage.status === "running") {
      assistantMessage.status = "complete";
    }
  }
}

export function createPiUiBridge(options: PiUiBridgeOptions): PiUiBridge {
  return new PiUiBridge(options);
}
