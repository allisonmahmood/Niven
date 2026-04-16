import {
  type AppendMessage,
  type MessageStatus,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type {
  PiUiState,
  ThreadAssistantMessage,
  ThreadMessage,
  ThreadToolCallPart,
} from "@niven/wealth-chat-bridge/pi-ui";

import { cancelThread, sendThreadMessage } from "./chatApi";
import { useChatStore } from "./chatStore";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const EMPTY_MESSAGES: readonly ThreadMessage[] = [];

function extractTextFromAppendMessage(message: AppendMessage): string {
  return message.content
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text];
      }

      return [];
    })
    .join("\n")
    .trim();
}

function toMessageStatus(status: ThreadAssistantMessage["status"]): MessageStatus {
  switch (status) {
    case "running":
      return { type: "running" };
    case "requires-action":
      return { reason: "tool-calls", type: "requires-action" };
    case "incomplete":
      return { reason: "other", type: "incomplete" };
    default:
      return { reason: "stop", type: "complete" };
  }
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

type AssistantToolCallContent = Extract<
  Exclude<ThreadMessageLike["content"], string>[number],
  { type: "tool-call" }
>;

function mapToolPart(part: ThreadToolCallPart): AssistantToolCallContent {
  return {
    args: normalizeToolArgs(part.args) as AssistantToolCallContent["args"],
    argsText: part.argsText,
    isError: part.isError,
    result: part.result,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    type: "tool-call",
  };
}

export function convertBridgeMessage(message: ThreadMessage): ThreadMessageLike {
  if (message.role === "user") {
    return {
      content: message.content
        .filter((part): part is Extract<ThreadMessage["content"][number], { type: "text" }> => {
          return part.type === "text";
        })
        .map((part) => ({ text: part.text, type: "text" })),
      createdAt: new Date(message.createdAt),
      id: message.id,
      role: "user",
    };
  }

  const content: Exclude<ThreadMessageLike["content"], string> = message.content.map((part) => {
    if (part.type === "text") {
      return { text: part.text, type: "text" as const };
    }

    if (part.type === "reasoning") {
      return { text: part.text, type: "reasoning" as const };
    }

    return mapToolPart(part);
  });

  return {
    content,
    createdAt: new Date(message.createdAt),
    id: message.id,
    role: "assistant",
    status: toMessageStatus(message.status),
  };
}

export function useWealthAssistantRuntime() {
  const state = useChatStore((store) => store.state);
  const setError = useChatStore((store) => store.setError);
  const setState = useChatStore((store) => store.setState);
  const threadId = state?.threadId;
  const messages = state?.messages ?? EMPTY_MESSAGES;
  const isLoading = state === null;
  const isRunning = state?.isRunning ?? false;

  return useExternalStoreRuntime<ThreadMessage>({
    convertMessage: convertBridgeMessage,
    isLoading,
    isRunning,
    messages,
    onCancel: async () => {
      if (!threadId) {
        return;
      }

      try {
        setState(await cancelThread(threadId));
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    },
    onNew: async (message) => {
      if (!threadId) {
        return;
      }

      const text = extractTextFromAppendMessage(message);
      if (!text) {
        return;
      }

      try {
        setState(
          await sendThreadMessage(threadId, {
            text,
            ...(isRunning ? { whileRunning: "steer" as const } : {}),
          }),
        );
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}

export function getRuntimeSnapshot(state: PiUiState | null): readonly ThreadMessage[] {
  return state?.messages ?? EMPTY_MESSAGES;
}
