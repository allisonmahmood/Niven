import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SOUL_EDITABLE_START = "<!-- SOUL-EDITABLE-START -->";
export const SOUL_EDITABLE_END = "<!-- SOUL-EDITABLE-END -->";
export const MAX_SOUL_RULES = 12;

export const DEFAULT_WEALTH_SOUL_FALLBACK = `# Niven

You are Niven.

Niven should feel calm, capable, and genuinely good to talk to. Be warm without being gushy. Skip corporate filler, flattery, and scripted enthusiasm. Help first.

## Presence
- Speak like a thoughtful operator, not a customer support macro.
- Be concise by default, but slow down and explain when money decisions or tradeoffs matter.
- Have taste. You can prefer one option over another and say why.
- Be candid when something is unclear or risky.

## How You Help
- Be resourceful before asking questions. Use the context and tools you already have before you ask the user to do more work.
- Give a clear recommendation when the tradeoffs are not close.
- In financial contexts, optimize for clarity, calm, and trust. Numbers, assumptions, and caveats should be obvious.
- If something needs approval or cannot be done, say so plainly and tell the user the next exact step.

## Boundaries
- Never bluff.
- Never use charm to hide uncertainty.
- Treat the user's financial information with care and discretion.

## Voice
- Natural, grounded, and slightly opinionated.
- No "Great question", "happy to help", or salesy reassurance.
- Prefer direct language over ceremony.

## Learned Behavior
- Use this section only for durable guidance about how you should behave in future sessions.
- Never store user-specific facts, financial data, or thread-specific memory here.
${SOUL_EDITABLE_START}
${SOUL_EDITABLE_END}`;

export type SoulUpdateOperation = "upsert_rule" | "remove_rule";

export interface SoulUpdateInput {
  readonly matchRule?: string;
  readonly operation: SoulUpdateOperation;
  readonly reason?: string;
  readonly rule: string;
}

export interface ParsedSoulDocument {
  readonly afterEditable: string;
  readonly beforeEditable: string;
  readonly rules: readonly string[];
}

export interface SoulUpdateResult {
  readonly addedRules: readonly string[];
  readonly afterText: string;
  readonly auditPath: string;
  readonly diffSummary: readonly string[];
  readonly removedRules: readonly string[];
  readonly ruleCount: number;
  readonly soulPath: string;
  readonly trimmedRules: readonly string[];
  readonly updated: boolean;
}

export interface SoulWriteResult {
  readonly auditPath: string;
  readonly content: string;
  readonly soulPath: string;
  readonly updated: boolean;
}

interface ValidatedSoulUpdateInput extends SoulUpdateInput {
  readonly matchRule?: string;
  readonly reason?: string;
  readonly rule: string;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function normalizeRule(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^[*-]\s+/, "")
    .replace(/\s+/g, " ");

  if (!trimmed) {
    throw new Error("Soul rules must not be empty.");
  }

  const sentenceCased = /^[a-z]/.test(trimmed)
    ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
    : trimmed;

  return /[.!?]$/.test(sentenceCased) ? sentenceCased : `${sentenceCased}.`;
}

function ruleKey(value: string): string {
  return normalizeRule(value)
    .toLowerCase()
    .replace(/[.!?]+$/, "");
}

function ensureSingleMarker(text: string, marker: string): number {
  const firstIndex = text.indexOf(marker);

  if (firstIndex === -1) {
    throw new Error(`SOUL.md is missing required marker ${marker}.`);
  }

  if (text.indexOf(marker, firstIndex + marker.length) !== -1) {
    throw new Error(`SOUL.md contains multiple ${marker} markers.`);
  }

  return firstIndex;
}

function assertBehaviorRule(text: string, label: string): void {
  if (text.length > 220) {
    throw new Error(`${label} is too long to keep as durable soul guidance.`);
  }

  const episodicPatterns: Array<[RegExp, string]> = [
    [/\b\d{4}-\d{2}-\d{2}\b/, "contains a calendar date"],
    [/\$\s?\d/, "contains a money amount"],
    [/\b\d+\.\d{2}\b/, "contains an exact amount"],
    [/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/, "contains an email address"],
    [/https?:\/\//i, "contains a URL"],
  ];

  for (const [pattern, reason] of episodicPatterns) {
    if (pattern.test(text)) {
      throw new Error(`${label} ${reason} and looks like memory instead of behavior guidance.`);
    }
  }

  const capabilityPatterns: Array<[RegExp, string]> = [
    [/\bAPPROVE:\b/i, "changes approval behavior"],
    [/\b(?:policy|permission|permissions)\b/i, "changes policy instead of behavior"],
    [/\b(?:tool|tools|filesystem|file|files)\b/i, "changes tool or file access"],
    [
      /\b(?:web browsing|browse the web|internet|credentials|secret|secrets)\b/i,
      "changes capabilities",
    ],
  ];

  for (const [pattern, reason] of capabilityPatterns) {
    if (pattern.test(text)) {
      throw new Error(`${label} ${reason}.`);
    }
  }
}

function validateSoulUpdate(input: SoulUpdateInput): ValidatedSoulUpdateInput {
  const rule = normalizeRule(input.rule);
  const matchRule = input.matchRule ? normalizeRule(input.matchRule) : undefined;
  const reason = input.reason?.trim().replace(/\s+/g, " ");

  if (reason && reason.length > 280) {
    throw new Error("Soul update reasons must stay concise.");
  }

  assertBehaviorRule(rule, "Soul rule");

  if (matchRule) {
    assertBehaviorRule(matchRule, "Soul matchRule");
  }

  return {
    operation: input.operation,
    ...(reason ? { reason } : {}),
    ...(matchRule ? { matchRule } : {}),
    rule,
  };
}

function dedupeRules(rules: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rule of [...rules].reverse()) {
    const key = ruleKey(rule);

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(normalizeRule(rule));
    }
  }

  return deduped.reverse();
}

function renderRules(rules: readonly string[]): string {
  return rules.map((rule) => `- ${rule}`).join("\n");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function parseSoulDocument(text: string): ParsedSoulDocument {
  const normalized = normalizeLineEndings(text);
  const startIndex = ensureSingleMarker(normalized, SOUL_EDITABLE_START);
  const endIndex = ensureSingleMarker(normalized, SOUL_EDITABLE_END);

  if (endIndex <= startIndex) {
    throw new Error("SOUL.md editable block markers are out of order.");
  }

  const beforeEditable = normalized.slice(0, startIndex + SOUL_EDITABLE_START.length);
  const editableBody = normalized.slice(startIndex + SOUL_EDITABLE_START.length, endIndex);
  const afterEditable = normalized.slice(endIndex);
  const rules: string[] = [];

  for (const line of editableBody.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (!trimmed.startsWith("- ")) {
      throw new Error("SOUL editable block may only contain bullet rules.");
    }

    rules.push(normalizeRule(trimmed.slice(2)));
  }

  return {
    afterEditable,
    beforeEditable,
    rules,
  };
}

export function renderSoulDocument(parsed: ParsedSoulDocument, rules: readonly string[]): string {
  const body = renderRules(rules);
  const renderedBody = body ? `\n${body}\n` : "\n";

  return `${parsed.beforeEditable}${renderedBody}${parsed.afterEditable}`;
}

export function applySoulUpdate(parsed: ParsedSoulDocument, input: SoulUpdateInput) {
  const update = validateSoulUpdate(input);
  const nextRules = [...parsed.rules];
  const removedRules: string[] = [];
  const addedRules: string[] = [];

  if (update.operation === "remove_rule") {
    const targetKey = ruleKey(update.matchRule ?? update.rule);
    const matchIndex = nextRules.findIndex((rule) => ruleKey(rule) === targetKey);

    if (matchIndex !== -1) {
      const [removedRule] = nextRules.splice(matchIndex, 1);

      if (removedRule) {
        removedRules.push(removedRule);
      }
    }
  } else {
    const replacementIndex = update.matchRule
      ? nextRules.findIndex((rule) => ruleKey(rule) === ruleKey(update.matchRule ?? ""))
      : nextRules.findIndex((rule) => ruleKey(rule) === ruleKey(update.rule));

    if (replacementIndex === -1) {
      nextRules.push(update.rule);
      addedRules.push(update.rule);
    } else if (nextRules[replacementIndex] !== update.rule) {
      const [removedRule] = nextRules.splice(replacementIndex, 1, update.rule);

      if (removedRule) {
        removedRules.push(removedRule);
      }

      addedRules.push(update.rule);
    }
  }

  const dedupedRules = dedupeRules(nextRules);
  const trimmedRules =
    dedupedRules.length > MAX_SOUL_RULES ? dedupedRules.slice(0, -MAX_SOUL_RULES) : [];
  const finalRules =
    dedupedRules.length > MAX_SOUL_RULES ? dedupedRules.slice(-MAX_SOUL_RULES) : dedupedRules;
  const beforeText = renderSoulDocument(parsed, parsed.rules);
  const afterText = renderSoulDocument(parsed, finalRules);
  const updated = beforeText !== afterText;
  const diffSummary: string[] = [];

  for (const rule of addedRules) {
    diffSummary.push(`Added rule: ${rule}`);
  }

  for (const rule of removedRules) {
    diffSummary.push(`Removed rule: ${rule}`);
  }

  for (const rule of trimmedRules) {
    diffSummary.push(`Trimmed oldest rule: ${rule}`);
  }

  if (!updated) {
    diffSummary.push("No change.");
  }

  return {
    addedRules,
    afterText,
    beforeText,
    diffSummary,
    removedRules,
    rules: finalRules,
    trimmedRules,
    updated,
    validatedUpdate: update,
  };
}

export function defaultSoulAuditPath(soulPath: string): string {
  return path.join(path.dirname(soulPath), ".soul-updates.jsonl");
}

export async function readSoulDocument(
  soulPath: string,
  fallbackDocument = DEFAULT_WEALTH_SOUL_FALLBACK,
): Promise<string> {
  try {
    return normalizeLineEndings(await readFile(soulPath, "utf8"));
  } catch {
    return fallbackDocument;
  }
}

export async function writeSoulFileAtomic(soulPath: string, text: string): Promise<void> {
  const directory = path.dirname(soulPath);
  const tempPath = path.join(directory, `.${path.basename(soulPath)}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, soulPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function appendSoulAuditEntry(auditPath: string, payload: Record<string, unknown>) {
  await mkdir(path.dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function writeSoulMarkdown(options: {
  readonly auditPath?: string;
  readonly content: string;
  readonly fallbackDocument?: string;
  readonly reason?: string;
  readonly soulPath: string;
}): Promise<SoulWriteResult> {
  const currentText = await readSoulDocument(options.soulPath, options.fallbackDocument);
  const nextContent = normalizeLineEndings(options.content).trim();

  if (!nextContent) {
    throw new Error("SOUL.md content must not be empty.");
  }

  const nextText = `${nextContent}\n`;
  const auditPath = options.auditPath ?? defaultSoulAuditPath(options.soulPath);
  const updated = currentText.trim() !== nextContent;

  if (updated) {
    await writeSoulFileAtomic(options.soulPath, nextText);
  }

  await appendSoulAuditEntry(auditPath, {
    afterHash: hashText(nextText),
    beforeHash: hashText(currentText),
    mode: "overwrite",
    ...(options.reason ? { reason: options.reason.trim() } : {}),
    soulPath: options.soulPath,
    timestamp: new Date().toISOString(),
    updated,
  });

  return {
    auditPath,
    content: nextText,
    soulPath: options.soulPath,
    updated,
  };
}

export async function updateSoulFile(options: {
  readonly auditPath?: string;
  readonly fallbackDocument?: string;
  readonly soulPath: string;
  readonly update: SoulUpdateInput;
}): Promise<SoulUpdateResult> {
  const currentText = await readSoulDocument(options.soulPath, options.fallbackDocument);
  const parsed = parseSoulDocument(currentText);
  const applied = applySoulUpdate(parsed, options.update);
  const auditPath = options.auditPath ?? defaultSoulAuditPath(options.soulPath);

  if (applied.updated) {
    await writeSoulFileAtomic(options.soulPath, applied.afterText);
  }

  await appendSoulAuditEntry(auditPath, {
    addedRules: applied.addedRules,
    afterHash: hashText(applied.afterText),
    beforeHash: hashText(applied.beforeText),
    diffSummary: applied.diffSummary,
    operation: applied.validatedUpdate.operation,
    ...(applied.validatedUpdate.reason ? { reason: applied.validatedUpdate.reason } : {}),
    removedRules: applied.removedRules,
    rule: applied.validatedUpdate.rule,
    soulPath: options.soulPath,
    timestamp: new Date().toISOString(),
    trimmedRules: applied.trimmedRules,
    updated: applied.updated,
  });

  return {
    addedRules: applied.addedRules,
    afterText: applied.afterText,
    auditPath,
    diffSummary: applied.diffSummary,
    removedRules: applied.removedRules,
    ruleCount: applied.rules.length,
    soulPath: options.soulPath,
    trimmedRules: applied.trimmedRules,
    updated: applied.updated,
  };
}
