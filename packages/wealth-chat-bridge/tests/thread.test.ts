import type { AuthStorage, SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { createWealthChatThread } from "../src/thread.js";
import type { WealthToolService } from "../src/wealthService.js";

function createAssistantMessage(text: string, timestamp: number) {
  return {
    content: [{ text, type: "text" }],
    role: "assistant",
    stopReason: "stop",
    timestamp,
  };
}

function createUserMessage(text: string, timestamp: number) {
  return {
    content: text,
    role: "user",
    timestamp,
  };
}

function createSessionFactory(options: { onKickoff?: () => void }) {
  let generation = 0;
  const createdSessions: Array<{
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    emit: (event: unknown) => void;
    followUp: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    steer: ReturnType<typeof vi.fn>;
  }> = [];

  const factory = vi.fn(async () => {
    const listeners = new Set<(event: unknown) => void>();
    const messages: unknown[] = [];
    const currentGeneration = generation++;
    const emit = (event: unknown) => {
      for (const listener of listeners) {
        listener(event);
      }
    };

    const session = {
      get messages() {
        return messages;
      },
      sessionId: `session-${currentGeneration + 1}`,
      subscribe(listener: (event: unknown) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      prompt: vi.fn(async (text: string) => {
        messages.push(createUserMessage(text, currentGeneration + 1));

        if (currentGeneration === 0) {
          options.onKickoff?.();
          messages.push(createAssistantMessage("What are your main financial priorities?", 100));
          emit({ messages: [...messages], type: "agent_end" });
          return;
        }

        emit({ type: "agent_start" });
      }),
      steer: vi.fn(async () => {}),
      followUp: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
      emit,
    };

    createdSessions.push(session);

    return {
      session,
    };
  });

  return { createdSessions, factory };
}

function createAuthStorage(): AuthStorage {
  return {
    get() {
      return { type: "oauth" };
    },
    set() {},
  } as AuthStorage;
}

function createService(): WealthToolService {
  return {
    getAccount: vi.fn(),
    getConfig: vi.fn(),
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
  };
}

function createSessionManager(): SessionManager {
  return {
    appendMessage: vi.fn(),
    getEntries: vi.fn(() => []),
    getLeafId: vi.fn(() => "leaf-1"),
  } as unknown as SessionManager;
}

describe("createWealthChatThread", () => {
  it("hides the synthetic onboarding kickoff and restarts on the next user turn", async () => {
    let hasMemory = false;
    const { createdSessions, factory } = createSessionFactory({
      onKickoff() {
        hasMemory = true;
      },
    });

    const thread = await createWealthChatThread({
      agentDir: "/tmp/agent",
      authStorage: createAuthStorage(),
      createSession: factory,
      cwd: "/tmp/workspace",
      hasMemory() {
        return hasMemory;
      },
      memoryPath: "/tmp/MEMORY.md",
      service: createService(),
      sessionManagerFactory: createSessionManager,
      threadId: "thread-onboarding",
    });

    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]?.prompt).toHaveBeenCalledWith(
      "No MEMORY.md exists yet. Start onboarding now. Ask concise questions about the user's financial goals, preferences, risk tolerance, constraints, and plans. Once you have enough durable context, write MEMORY.md with update_memory.",
    );
    expect(thread.getState().messages).toEqual([
      expect.objectContaining({
        content: [{ text: "What are your main financial priorities?", type: "text" }],
        role: "assistant",
      }),
    ]);

    await thread.sendMessage("I want to retire early.");

    expect(createdSessions).toHaveLength(2);
    expect(createdSessions[1]?.prompt).toHaveBeenCalledWith("I want to retire early.");
    expect(thread.getState().messages).toEqual([
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({
        content: [{ text: "I want to retire early.", type: "text" }],
        role: "user",
      }),
    ]);
  });

  it("defaults active-run sends to steer", async () => {
    const { createdSessions, factory } = createSessionFactory({});

    const thread = await createWealthChatThread({
      agentDir: "/tmp/agent",
      authStorage: createAuthStorage(),
      autoStartOnboarding: false,
      createSession: factory,
      cwd: "/tmp/workspace",
      hasMemory() {
        return true;
      },
      memoryPath: "/tmp/MEMORY.md",
      service: createService(),
      sessionManagerFactory: createSessionManager,
      threadId: "thread-steer",
    });

    const runningSession = createdSessions[0];
    if (!runningSession) {
      throw new Error("Expected a running session.");
    }

    runningSession.emit({ type: "agent_start" });
    await thread.sendMessage("Use the safer account.");

    expect(runningSession.steer).toHaveBeenCalledWith("Use the safer account.");
    expect(runningSession.followUp).not.toHaveBeenCalled();
  });
});
