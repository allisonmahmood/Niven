import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applySoulUpdate,
  DEFAULT_WEALTH_SOUL_FALLBACK,
  parseSoulDocument,
  SOUL_EDITABLE_END,
  SOUL_EDITABLE_START,
  updateSoulFile,
  writeSoulMarkdown,
} from "../src/soul.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    }),
  );
});

describe("soul helpers", () => {
  it("parses the editable SOUL block from the default document", () => {
    const parsed = parseSoulDocument(DEFAULT_WEALTH_SOUL_FALLBACK);

    expect(parsed.beforeEditable).toContain(SOUL_EDITABLE_START);
    expect(parsed.afterEditable).toContain(SOUL_EDITABLE_END);
    expect(parsed.rules).toEqual([]);
  });

  it("upserts a normalized rule and dedupes later duplicates", () => {
    const parsed = parseSoulDocument(`${DEFAULT_WEALTH_SOUL_FALLBACK}\n`);
    const firstUpdate = applySoulUpdate(parsed, {
      operation: "upsert_rule",
      reason: "User asked for shorter answers.",
      rule: "default to direct answers first on simple factual questions",
    });
    const secondUpdate = applySoulUpdate(parseSoulDocument(firstUpdate.afterText), {
      operation: "upsert_rule",
      reason: "Same signal repeated.",
      rule: "Default to direct answers first on simple factual questions.",
    });

    expect(firstUpdate.updated).toBe(true);
    expect(firstUpdate.rules).toEqual([
      "Default to direct answers first on simple factual questions.",
    ]);
    expect(secondUpdate.updated).toBe(false);
    expect(secondUpdate.diffSummary).toContain("No change.");
  });

  it("rejects episodic memory-like rules", () => {
    const parsed = parseSoulDocument(DEFAULT_WEALTH_SOUL_FALLBACK);

    expect(() =>
      applySoulUpdate(parsed, {
        operation: "upsert_rule",
        reason: "This should not be retained.",
        rule: "Remember that the user paid $125.00 on 2026-04-15.",
      }),
    ).toThrow("looks like memory");
  });

  it("writes updates atomically and appends an audit record", async () => {
    const tempDir = await createTempDir("niven-soul-");
    const soulPath = path.join(tempDir, "SOUL.md");
    const auditPath = path.join(tempDir, "soul-updates.jsonl");
    const result = await updateSoulFile({
      auditPath,
      soulPath,
      update: {
        operation: "upsert_rule",
        reason: "The user repeatedly asked for terser factual answers.",
        rule: "Default to direct answers first on simple factual questions.",
      },
    });

    expect(result.updated).toBe(true);
    expect(result.diffSummary).toContain(
      "Added rule: Default to direct answers first on simple factual questions.",
    );
    await expect(readFile(soulPath, "utf8")).resolves.toContain(
      "- Default to direct answers first on simple factual questions.",
    );

    const auditLog = await readFile(auditPath, "utf8");
    expect(auditLog).toContain('"reason":"The user repeatedly asked for terser factual answers."');
    expect(auditLog).toContain('"updated":true');
  });

  it("accepts minimal updates without a reason", async () => {
    const tempDir = await createTempDir("niven-soul-minimal-");
    const soulPath = path.join(tempDir, "SOUL.md");
    const result = await updateSoulFile({
      soulPath,
      update: {
        operation: "upsert_rule",
        rule: "Be much more conversational.",
      },
    });

    expect(result.updated).toBe(true);
    await expect(readFile(soulPath, "utf8")).resolves.toContain("- Be much more conversational.");
  });

  it("overwrites SOUL.md directly without semantic validation", async () => {
    const tempDir = await createTempDir("niven-soul-overwrite-");
    const soulPath = path.join(tempDir, "SOUL.md");
    const auditPath = path.join(tempDir, "soul-updates.jsonl");
    const content = `# Niven

You are Niven.

## Voice
- Be much more conversational.
- Keep answers short unless depth is useful.`;
    const result = await writeSoulMarkdown({
      auditPath,
      content,
      soulPath,
    });

    expect(result.updated).toBe(true);
    await expect(readFile(soulPath, "utf8")).resolves.toBe(`${content}\n`);
    await expect(readFile(auditPath, "utf8")).resolves.toContain('"mode":"overwrite"');
  });
});
