import { randomUUID } from "node:crypto";

import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { NotFoundError } from "@niven/shared";
import {
  createWealthChatThread,
  getWealthHarnessPaths,
  type PiUiState,
  type WealthChatThread,
} from "@niven/wealth-chat-bridge";
import type { SandboxService } from "@niven/wealth-sandbox";

export interface WealthChatRegistry {
  createThread(): Promise<WealthChatThread>;
  disposeThread(threadId: string): boolean;
  dispose(): void;
  getThread(threadId: string): WealthChatThread;
}

export interface CreateWealthChatRegistryOptions {
  readonly authStorage: AuthStorage;
  readonly repoRoot: string;
  readonly service: SandboxService;
  readonly threadTtlMs?: number;
}

const DEFAULT_THREAD_TTL_MS = 6 * 60 * 60 * 1000;

export class InMemoryWealthChatRegistry implements WealthChatRegistry {
  private readonly authStorage: AuthStorage;
  private readonly paths: ReturnType<typeof getWealthHarnessPaths>;
  private readonly service: SandboxService;
  private readonly threadTtlMs: number;
  private readonly threadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly threads = new Map<string, WealthChatThread>();

  constructor(options: CreateWealthChatRegistryOptions) {
    this.authStorage = options.authStorage;
    this.paths = getWealthHarnessPaths(options.repoRoot);
    this.service = options.service;
    this.threadTtlMs = options.threadTtlMs ?? DEFAULT_THREAD_TTL_MS;
  }

  async createThread(): Promise<WealthChatThread> {
    const threadId = randomUUID();
    const thread = await createWealthChatThread({
      agentDir: this.paths.agentDir,
      authStorage: this.authStorage,
      cwd: this.paths.sessionCwd,
      memoryPath: this.paths.memoryPath,
      service: this.service,
      soulPath: this.paths.soulPath,
      threadId,
    });

    const resolvedThreadId = thread.getState().threadId;
    this.threads.set(resolvedThreadId, thread);
    this.scheduleThreadDisposal(resolvedThreadId);
    return thread;
  }

  getThread(threadId: string): WealthChatThread {
    const thread = this.threads.get(threadId);

    if (!thread) {
      throw new NotFoundError(`Chat thread ${threadId} was not found.`);
    }

    this.scheduleThreadDisposal(threadId);
    return thread;
  }

  disposeThread(threadId: string): boolean {
    const thread = this.threads.get(threadId);
    this.clearThreadDisposal(threadId);

    if (!thread) {
      return false;
    }

    this.threads.delete(threadId);
    thread.dispose();
    return true;
  }

  dispose(): void {
    for (const threadId of Array.from(this.threads.keys())) {
      this.disposeThread(threadId);
    }
  }

  private clearThreadDisposal(threadId: string): void {
    const timeout = this.threadTimeouts.get(threadId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.threadTimeouts.delete(threadId);
  }

  private scheduleThreadDisposal(threadId: string): void {
    if (this.threadTtlMs <= 0) {
      return;
    }

    this.clearThreadDisposal(threadId);
    this.threadTimeouts.set(
      threadId,
      setTimeout(() => {
        this.disposeThread(threadId);
      }, this.threadTtlMs),
    );
  }
}

export function getThreadStateEnvelope(thread: WealthChatThread): { state: PiUiState } {
  return { state: thread.getState() };
}
