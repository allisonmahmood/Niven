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
  dispose(): void;
  getThread(threadId: string): WealthChatThread;
}

export interface CreateWealthChatRegistryOptions {
  readonly authStorage: AuthStorage;
  readonly repoRoot: string;
  readonly service: SandboxService;
}

export class InMemoryWealthChatRegistry implements WealthChatRegistry {
  private readonly authStorage: AuthStorage;
  private readonly paths: ReturnType<typeof getWealthHarnessPaths>;
  private readonly service: SandboxService;
  private readonly threads = new Map<string, WealthChatThread>();

  constructor(options: CreateWealthChatRegistryOptions) {
    this.authStorage = options.authStorage;
    this.paths = getWealthHarnessPaths(options.repoRoot);
    this.service = options.service;
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

    this.threads.set(thread.getState().threadId, thread);
    return thread;
  }

  getThread(threadId: string): WealthChatThread {
    const thread = this.threads.get(threadId);

    if (!thread) {
      throw new NotFoundError(`Chat thread ${threadId} was not found.`);
    }

    return thread;
  }

  dispose(): void {
    for (const thread of this.threads.values()) {
      thread.dispose();
    }

    this.threads.clear();
  }
}

export function getThreadStateEnvelope(thread: WealthChatThread): { state: PiUiState } {
  return { state: thread.getState() };
}
