import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface MemoryWriteResult {
  readonly auditPath: string;
  readonly content: string;
  readonly memoryPath: string;
  readonly updated: boolean;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function defaultWealthMemoryPath(agentDir: string): string {
  return path.join(agentDir, "MEMORY.md");
}

export function defaultMemoryAuditPath(memoryPath: string): string {
  return path.join(path.dirname(memoryPath), ".memory-updates.jsonl");
}

export function loadWealthMemory(memoryPath?: string): string | undefined {
  if (!memoryPath) {
    return undefined;
  }

  try {
    const memory = readFileSync(memoryPath, "utf8").trim();
    return memory.length > 0 ? memory : undefined;
  } catch {
    return undefined;
  }
}

export function hasWealthMemory(memoryPath: string): boolean {
  return loadWealthMemory(memoryPath) !== undefined;
}

async function readMemoryDocument(memoryPath: string): Promise<string> {
  try {
    return normalizeLineEndings(await readFile(memoryPath, "utf8"));
  } catch {
    return "";
  }
}

async function writeMemoryFileAtomic(memoryPath: string, text: string): Promise<void> {
  const directory = path.dirname(memoryPath);
  const tempPath = path.join(directory, `.${path.basename(memoryPath)}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, memoryPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function appendMemoryAuditEntry(auditPath: string, payload: Record<string, unknown>) {
  await mkdir(path.dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function writeMemoryMarkdown(options: {
  readonly auditPath?: string;
  readonly content: string;
  readonly memoryPath: string;
  readonly reason?: string;
}): Promise<MemoryWriteResult> {
  const currentText = await readMemoryDocument(options.memoryPath);
  const nextContent = normalizeLineEndings(options.content).trim();

  if (!nextContent) {
    throw new Error("MEMORY.md content must not be empty.");
  }

  const nextText = `${nextContent}\n`;
  const auditPath = options.auditPath ?? defaultMemoryAuditPath(options.memoryPath);
  const updated = currentText.trim() !== nextContent;

  if (updated) {
    await writeMemoryFileAtomic(options.memoryPath, nextText);
  }

  await appendMemoryAuditEntry(auditPath, {
    afterHash: hashText(nextText),
    beforeHash: hashText(currentText),
    memoryPath: options.memoryPath,
    mode: "overwrite",
    ...(options.reason ? { reason: options.reason.trim() } : {}),
    timestamp: new Date().toISOString(),
    updated,
  });

  return {
    auditPath,
    content: nextText,
    memoryPath: options.memoryPath,
    updated,
  };
}
