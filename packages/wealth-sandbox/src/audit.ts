import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface SandboxAuditEntry {
  readonly action: string;
  readonly error?: Record<string, unknown>;
  readonly idempotencyKey?: string;
  readonly metadata?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly status: "blocked" | "dry_run" | "failed" | "idempotent_replay" | "succeeded";
  readonly timestamp?: string;
}

export class SandboxAuditLogger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async record(entry: SandboxAuditEntry): Promise<void> {
    const payload = {
      ...entry,
      id: randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };

    const line = `${JSON.stringify(payload)}\n`;

    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, line, "utf8");
    });

    await this.queue;
  }
}
