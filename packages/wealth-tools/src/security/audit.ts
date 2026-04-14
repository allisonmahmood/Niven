import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { JsonObject } from "@niven/shared";

import { redactSensitiveData } from "./redaction.js";

export interface AuditEntry {
  readonly action: string;
  readonly error?: JsonObject;
  readonly idempotencyKey?: string;
  readonly metadata?: JsonObject;
  readonly resourceId?: string;
  readonly result?: JsonObject;
  readonly status: "blocked" | "dry_run" | "failed" | "idempotent_replay" | "succeeded";
  readonly timestamp?: string;
}

export class AuditLogger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async record(entry: AuditEntry): Promise<void> {
    const payload = {
      ...entry,
      id: randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };

    const line = `${JSON.stringify(redactSensitiveData(payload))}\n`;

    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, line, "utf8");
    });

    await this.queue;
  }
}
