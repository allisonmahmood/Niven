import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SandboxState } from "./types.js";

function createDefaultState(): SandboxState {
  return {
    version: 1,
    accounts: {},
    events: [],
    idempotency: {},
    importedTransactions: {},
    orders: {},
    positions: {},
    securities: {},
    snapshot: null,
    transfers: {},
  };
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export class LocalSandboxStore {
  private state: SandboxState | null = null;
  private stateMtimeMs: number | null = null;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async readState(): Promise<SandboxState> {
    await this.writeQueue;
    return cloneValue(await this.readStateInternal());
  }

  async replaceState(nextState: SandboxState): Promise<void> {
    await this.mutate(async () => cloneValue(nextState));
  }

  async mutate<T>(
    fn: (state: SandboxState) => Promise<T | SandboxState> | T | SandboxState,
  ): Promise<T> {
    const run = async () => {
      const state = await this.readStateInternal();
      const result = await fn(state);

      if (result && typeof result === "object" && "version" in result) {
        await this.persistState(result as SandboxState);
        return result as T;
      }

      await this.persistState(state);
      return result as T;
    };

    const next = this.writeQueue.then(run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private async readStateInternal(): Promise<SandboxState> {
    const currentMtimeMs = await this.readFileMtimeMs();

    if (
      this.state &&
      ((this.stateMtimeMs === null && currentMtimeMs === null) ||
        (this.stateMtimeMs !== null &&
          currentMtimeMs !== null &&
          this.stateMtimeMs === currentMtimeMs))
    ) {
      return this.state;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = raw.trim().length > 0 ? (JSON.parse(raw) as SandboxState) : createDefaultState();
      this.stateMtimeMs = await this.readFileMtimeMs();
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";

      if (!missing) {
        throw error;
      }

      this.state = createDefaultState();
      await this.persistState(this.state);
    }

    return this.state;
  }

  private async persistState(state: SandboxState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    this.state = state;
    this.stateMtimeMs = await this.readFileMtimeMs();
  }

  private async readFileMtimeMs(): Promise<number | null> {
    try {
      return (await stat(this.filePath)).mtimeMs;
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";

      if (missing) {
        return null;
      }

      throw error;
    }
  }
}
