import {
  type AuthStorage,
  SessionManager,
  type SessionManager as SessionManagerType,
} from "@mariozechner/pi-coding-agent";

import { createWealthHarnessSettingsManager } from "./harnessSettings.js";
import { hasWealthMemory } from "./memory.js";
import {
  createPiUiBridge,
  type PiToolExecutionState,
  type PiUiBridgeSession,
  type PiUiState,
  type SendMessageOptions,
  type ThreadMessage,
} from "./piUiBridge.js";
import type { WealthToolService } from "./wealthService.js";
import {
  type CreateWealthAgentSessionOptions,
  createWealthAgentSession,
  WEALTH_MEMORY_ONBOARDING_KICKOFF_PROMPT,
} from "./wealthSession.js";

type WhileRunningMode = NonNullable<SendMessageOptions["whileRunning"]>;

interface DisposablePiUiBridgeSession extends PiUiBridgeSession {
  dispose(): void;
}

type SessionManagerFactory = (cwd: string) => SessionManagerType;
type SessionFactory = (
  options: CreateWealthAgentSessionOptions,
) => Promise<{ session: DisposablePiUiBridgeSession }>;

export interface CreateWealthChatThreadOptions {
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly autoStartOnboarding?: boolean;
  readonly cwd: string;
  readonly createSession?: SessionFactory;
  readonly hasMemory?: (memoryPath: string) => boolean;
  readonly memoryPath: string;
  readonly onboardingKickoffPrompt?: string;
  readonly service: WealthToolService;
  readonly sessionManagerFactory?: SessionManagerFactory;
  readonly soulPath?: string;
  readonly threadId: string;
  readonly whileRunningDefault?: WhileRunningMode;
}

export interface WealthChatThread {
  cancel(): Promise<void>;
  dispose(): void;
  followUp(text: string): Promise<void>;
  getState(): PiUiState;
  prompt(text: string): Promise<void>;
  sendMessage(text: string, options?: SendMessageOptions): Promise<void>;
  steer(text: string): Promise<void>;
  subscribe(listener: (state: PiUiState) => void): () => void;
}

function getUserMessageText(message: ThreadMessage): string {
  if (message.role !== "user") {
    return "";
  }

  return message.content
    .filter((part): part is Extract<ThreadMessage["content"][number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

class WealthChatThreadImpl implements WealthChatThread {
  private archivedMessages: ThreadMessage[] = [];
  private archivedToolExecutions: Record<string, PiToolExecutionState> = {};
  private bridge = createPiUiBridge({
    messageIdPrefix: "bootstrap-",
    session: {
      messages: [],
      async abort() {},
      async followUp() {},
      async prompt() {},
      sessionId: "bootstrap",
      async steer() {},
      subscribe() {
        return () => {};
      },
    },
    threadId: "bootstrap",
  });
  private disposed = false;
  private generation = 0;
  private hiddenPromptTexts = new Set<string>();
  private listeners = new Set<(state: PiUiState) => void>();
  private pendingRestartAfterOnboarding = false;
  private readonly autoStartOnboarding: boolean;
  private readonly createSession: SessionFactory;
  private readonly hasMemory: (memoryPath: string) => boolean;
  private readonly hiddenOnboardingPrompt: string;
  private readonly memoryPath: string;
  private readonly options: Omit<
    CreateWealthChatThreadOptions,
    | "autoStartOnboarding"
    | "createSession"
    | "hasMemory"
    | "memoryPath"
    | "onboardingKickoffPrompt"
    | "sessionManagerFactory"
    | "whileRunningDefault"
  >;
  private readonly sessionManagerFactory: SessionManagerFactory;
  private readonly threadId: string;
  private readonly whileRunningDefault: WhileRunningMode;
  private session: DisposablePiUiBridgeSession = {
    dispose() {},
    messages: [],
    async abort() {},
    async followUp() {},
    async prompt() {},
    sessionId: "bootstrap",
    async steer() {},
    subscribe() {
      return () => {};
    },
  };
  private startedWithoutMemory: boolean;
  private unsubscribeBridge: () => void = () => {};

  constructor(options: CreateWealthChatThreadOptions) {
    this.autoStartOnboarding = options.autoStartOnboarding ?? true;
    this.createSession =
      options.createSession ??
      (async (sessionOptions) => {
        return createWealthAgentSession({
          ...sessionOptions,
          settingsManager: createWealthHarnessSettingsManager(),
        }) as Promise<{ session: DisposablePiUiBridgeSession }>;
      });
    this.hasMemory = options.hasMemory ?? hasWealthMemory;
    this.hiddenOnboardingPrompt =
      options.onboardingKickoffPrompt ?? WEALTH_MEMORY_ONBOARDING_KICKOFF_PROMPT;
    this.memoryPath = options.memoryPath;
    this.options = {
      agentDir: options.agentDir,
      authStorage: options.authStorage,
      cwd: options.cwd,
      service: options.service,
      ...(options.soulPath ? { soulPath: options.soulPath } : {}),
      threadId: options.threadId,
    };
    this.sessionManagerFactory = options.sessionManagerFactory ?? SessionManager.inMemory;
    this.threadId = options.threadId;
    this.whileRunningDefault = options.whileRunningDefault ?? "steer";
    this.startedWithoutMemory = !this.hasMemory(this.memoryPath);
  }

  async initialize(): Promise<void> {
    await this.createLiveBridge();

    if (this.autoStartOnboarding && this.startedWithoutMemory) {
      await this.sendInternalPrompt(this.hiddenOnboardingPrompt);
    }
  }

  getState(): PiUiState {
    return this.buildState();
  }

  subscribe(listener: (state: PiUiState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendMessage(text: string, options: SendMessageOptions = {}): Promise<void> {
    await this.restartSessionIfNeeded();
    const currentState = this.bridge.getState();
    const whileRunning =
      currentState.isRunning && !options.whileRunning
        ? this.whileRunningDefault
        : options.whileRunning;

    await this.bridge.sendMessage(text, whileRunning ? { whileRunning } : {});
  }

  async prompt(text: string): Promise<void> {
    await this.restartSessionIfNeeded();
    await this.bridge.sendMessage(text);
  }

  async steer(text: string): Promise<void> {
    await this.bridge.sendMessage(text, { whileRunning: "steer" });
  }

  async followUp(text: string): Promise<void> {
    await this.bridge.sendMessage(text, { whileRunning: "followUp" });
  }

  async cancel(): Promise<void> {
    await this.bridge.cancelRun();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.unsubscribeBridge();
    this.bridge.dispose();
    this.session.dispose();
    this.listeners.clear();
  }

  private async createLiveBridge(): Promise<void> {
    const sessionManager = this.sessionManagerFactory(this.options.cwd);
    const { session } = await this.createSession({
      agentDir: this.options.agentDir,
      authStorage: this.options.authStorage,
      cwd: this.options.cwd,
      memoryPath: this.memoryPath,
      service: this.options.service,
      sessionManager,
      ...(this.options.soulPath ? { soulPath: this.options.soulPath } : {}),
    });

    this.session = session;
    this.bridge.dispose();
    this.bridge = createPiUiBridge({
      messageIdPrefix: `g${this.generation}-`,
      session,
      threadId: this.threadId,
    });
    this.unsubscribeBridge();
    this.unsubscribeBridge = this.bridge.subscribe((state) => {
      if (
        this.startedWithoutMemory &&
        !state.isRunning &&
        !this.pendingRestartAfterOnboarding &&
        this.hasMemory(this.memoryPath)
      ) {
        this.pendingRestartAfterOnboarding = true;
      }

      this.emitState();
    });
  }

  private async restartSessionIfNeeded(): Promise<void> {
    const currentState = this.bridge.getState();

    if (!this.pendingRestartAfterOnboarding || currentState.isRunning) {
      return;
    }

    this.archivedMessages = [
      ...this.archivedMessages,
      ...this.filterHiddenMessages(currentState.messages),
    ];
    this.archivedToolExecutions = {
      ...this.archivedToolExecutions,
      ...currentState.toolExecutions,
    };

    this.unsubscribeBridge();
    this.bridge.dispose();
    this.session.dispose();
    this.generation += 1;
    this.pendingRestartAfterOnboarding = false;
    this.startedWithoutMemory = false;
    await this.createLiveBridge();
    this.emitState();
  }

  private buildState(): PiUiState {
    const current = this.bridge.getState();

    return {
      ...current,
      messages: [...this.archivedMessages, ...this.filterHiddenMessages(current.messages)],
      threadId: this.threadId,
      toolExecutions: {
        ...this.archivedToolExecutions,
        ...current.toolExecutions,
      },
    };
  }

  private emitState(): void {
    const snapshot = this.buildState();

    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private filterHiddenMessages(messages: readonly ThreadMessage[]): ThreadMessage[] {
    return messages.filter((message) => {
      return message.role !== "user" || !this.hiddenPromptTexts.has(getUserMessageText(message));
    });
  }

  private async sendInternalPrompt(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    this.hiddenPromptTexts.add(trimmed);

    try {
      await this.bridge.sendMessage(trimmed);
    } catch (error) {
      this.hiddenPromptTexts.delete(trimmed);
      throw error;
    }
  }
}

export async function createWealthChatThread(
  options: CreateWealthChatThreadOptions,
): Promise<WealthChatThread> {
  const thread = new WealthChatThreadImpl(options);
  await thread.initialize();
  return thread;
}
