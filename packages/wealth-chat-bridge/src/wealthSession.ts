import { readFileSync } from "node:fs";
import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
  type AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  type ResourceLoader,
  type SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import {
  getWealthHarnessModelSettingsFromEnv,
  resolveWealthHarnessModel,
} from "./harnessSettings.js";
import { defaultWealthMemoryPath, loadWealthMemory } from "./memory.js";
import { DEFAULT_WEALTH_SOUL_FALLBACK } from "./soul.js";
import type { WealthToolService } from "./wealthService.js";

type HarnessSettings = NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>;
type ThinkingLevel = NonNullable<HarnessSettings["defaultThinkingLevel"]>;

import { createWealthTools } from "./wealthTools.js";

export { DEFAULT_WEALTH_SOUL_FALLBACK } from "./soul.js";
export const WEALTH_MEMORY_ONBOARDING_PROMPT = `No durable user memory exists yet.

You must begin with onboarding before normal wealth-management assistance.

Onboarding goals:
- learn the user's financial goals and priorities
- learn their risk tolerance and planning horizon
- learn their preferences, constraints, and relevant life plans
- learn how they want advice and tradeoffs communicated

Onboarding rules:
- Ask at most 3 concise questions at a time.
- Once you have enough durable context, write MEMORY.md with update_memory.
- MEMORY.md should store stable user context only.
- Never store secrets, auth data, account numbers, exact balances, or raw transaction history in MEMORY.md unless the user explicitly asks for a standing memory of that exact detail.
- If the user asks for normal sandbox help before onboarding is finished, briefly explain that setup comes first and continue gathering the missing context.`;

export const WEALTH_MEMORY_ONBOARDING_KICKOFF_PROMPT = `No MEMORY.md exists yet. Start onboarding now. Ask concise questions about the user's financial goals, preferences, risk tolerance, constraints, and plans. Once you have enough durable context, write MEMORY.md with update_memory.`;

export const WEALTH_POLICY_PROMPT = `You are restricted to the local wealth sandbox.

You may only use the wealth tools that are provided to you. You do not have access to files, shell commands, code editing, web browsing, Plaid, or any other tools.

Your domain is limited to:
- accounts and balances
- imported transaction history from the one-time Plaid sample snapshot
- investment holdings and security lookup
- internal cash transfers between transfer-eligible sandbox accounts
- market buy and sell orders inside supported sandbox investment accounts
- proactive updates to SOUL.md through the dedicated update_soul tool for future-session behavior guidance only
- proactive updates to MEMORY.md through the dedicated update_memory tool for durable user memory across future sessions

The Plaid sample snapshot is imported outside this agent. Treat every sandbox account, holding, transfer, and order in the local sandbox as belonging to the current user.

Restrictions:
- Never claim that you can inspect or modify local files.
- Never claim that you have general-purpose file access. The only allowed SOUL.md and MEMORY.md write paths are the dedicated update_soul and update_memory tools.
- Never ask for or reveal environment variables, secrets, or Plaid credentials.
- Never mention hidden tools or suggest using tools that are not available.
- Never suggest importing or resetting the sandbox from inside the agent.
- Never store user-specific facts, financial data, or thread-specific memory in SOUL.md.
- Store durable user-specific context in MEMORY.md, not SOUL.md.

Mutation policy:
- Reads never require approval.
- Default to preview mode for money-moving or portfolio-changing actions.
- Only use executionMode="execute" when the latest user message explicitly starts with "APPROVE:".
- When the latest user message starts with "APPROVE:", treat it as an execution turn for the described mutation. Do not ask for another approval message and do not fall back to preview unless the user explicitly asked for a preview.
- Never claim a live mutation succeeded unless the tool result reports mode "live".
- If approval is missing, explain that the user must send a new message starting with "APPROVE:".
- If the sandbox has not been seeded yet, explain that the operator must run "pnpm sandbox:reset-from-plaid" outside the agent.

Behavioral requirements:
- Keep responses concise, factual, and specific to sandbox wealth management.
- Use update_soul proactively when durable feedback or repeated correction indicates your future behavior should change.
- Use update_memory proactively when durable user context is learned, corrected, or finalized during onboarding.
- Treat SOUL.md as behavior guidance only, and MEMORY.md as user memory.
- If the soul or stylistic guidance conflicts with anything in this policy, this policy wins.`;

export function defaultWealthSoulPath(repoRoot: string): string {
  return path.join(repoRoot, "apps", "harness-cli", "SOUL.md");
}

export function loadWealthSoul(soulPath?: string): string {
  if (!soulPath) {
    return DEFAULT_WEALTH_SOUL_FALLBACK;
  }

  try {
    const soul = readFileSync(soulPath, "utf8").trim();

    if (soul.length > 0) {
      return soul;
    }
  } catch {
    // Fall back to the built-in soul so the harness stays usable even if the file moves.
  }

  return DEFAULT_WEALTH_SOUL_FALLBACK;
}

export function composeWealthSystemPrompt(soul: string, memory?: string): string {
  return [
    "# Soul",
    "",
    "The following guidance defines Niven's personality and interaction style.",
    "It is subordinate to the wealth policy that follows.",
    "",
    soul.trim(),
    "",
    "# Memory",
    "",
    memory
      ? "The following memory contains durable user-specific context for future sessions."
      : "No durable user memory has been saved yet.",
    memory
      ? "Use it to personalize guidance, but verify details that may have changed."
      : "Follow the onboarding instructions below before giving normal wealth-management assistance.",
    "",
    memory?.trim() ?? WEALTH_MEMORY_ONBOARDING_PROMPT,
    "",
    "# Wealth Policy",
    "",
    "The following rules are non-negotiable and take precedence over any personality or tone guidance above.",
    "",
    WEALTH_POLICY_PROMPT,
  ].join("\n");
}

export function buildWealthSystemPrompt(soulPath: string | undefined, memoryPath?: string): string {
  return composeWealthSystemPrompt(loadWealthSoul(soulPath), loadWealthMemory(memoryPath));
}

export interface WealthHarnessPaths {
  readonly agentDir: string;
  readonly authPath: string;
  readonly memoryPath: string;
  readonly sessionCwd: string;
  readonly soulPath: string;
}

export interface CreateWealthAgentSessionOptions {
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly cwd: string;
  readonly service: WealthToolService;
  readonly resourceLoader?: ResourceLoader;
  readonly sessionManager: SessionManager;
  readonly modelRegistry?: ModelRegistry;
  readonly settingsManager?: SettingsManager;
  readonly memoryPath?: string;
  readonly soulPath?: string;
}

export interface WealthAgentSessionConfig {
  readonly agentDir: string;
  readonly authStorage: CreateWealthAgentSessionOptions["authStorage"];
  readonly customTools: ReturnType<typeof createWealthTools>;
  readonly cwd: string;
  readonly resourceLoader: ResourceLoader;
  readonly sessionManager: SessionManager;
  readonly modelRegistry: ModelRegistry;
  readonly model?: Model<Api>;
  readonly settingsManager: SettingsManager;
  readonly thinkingLevel?: ThinkingLevel;
  readonly tools: [];
}

export function getWealthHarnessPaths(repoRoot: string): WealthHarnessPaths {
  const baseDir = path.join(repoRoot, ".niven", "pi-wealth");
  const agentDir = path.join(baseDir, "agent");

  return {
    agentDir,
    authPath: path.join(agentDir, "auth.json"),
    memoryPath: defaultWealthMemoryPath(agentDir),
    sessionCwd: path.join(baseDir, "workspace"),
    soulPath: defaultWealthSoulPath(repoRoot),
  };
}

export function createWealthResourceLoader(options: {
  readonly agentDir: string;
  readonly cwd: string;
  readonly memoryPath?: string;
  readonly settingsManager: SettingsManager;
  readonly soulPath?: string;
}): DefaultResourceLoader {
  const memoryPath = options.memoryPath ?? defaultWealthMemoryPath(options.agentDir);

  return new DefaultResourceLoader({
    agentDir: options.agentDir,
    agentsFilesOverride: () => ({
      agentsFiles: [],
    }),
    cwd: options.cwd,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    promptsOverride: () => ({
      diagnostics: [],
      prompts: [],
    }),
    settingsManager: options.settingsManager,
    skillsOverride: () => ({
      diagnostics: [],
      skills: [],
    }),
    systemPromptOverride: () => buildWealthSystemPrompt(options.soulPath, memoryPath),
    themesOverride: () => ({
      diagnostics: [],
      themes: [],
    }),
  });
}

export async function buildWealthAgentSessionConfig(
  options: CreateWealthAgentSessionOptions,
): Promise<WealthAgentSessionConfig> {
  const settingsManager = options.settingsManager ?? SettingsManager.inMemory();
  const modelRegistry =
    options.modelRegistry ??
    ModelRegistry.create(options.authStorage, path.join(options.agentDir, "models.json"));
  const resourceLoader =
    options.resourceLoader ??
    createWealthResourceLoader({
      agentDir: options.agentDir,
      cwd: options.cwd,
      ...(options.memoryPath ? { memoryPath: options.memoryPath } : {}),
      settingsManager,
      ...(options.soulPath ? { soulPath: options.soulPath } : {}),
    });

  await resourceLoader.reload();

  const modelSettings = getWealthHarnessModelSettingsFromEnv({
    NIVEN_HARNESS_MODEL: settingsManager.getDefaultModel(),
    NIVEN_HARNESS_PROVIDER: settingsManager.getDefaultProvider(),
    NIVEN_HARNESS_THINKING_LEVEL: settingsManager.getDefaultThinkingLevel(),
  });
  const model = resolveWealthHarnessModel(modelSettings, modelRegistry);

  return {
    agentDir: options.agentDir,
    authStorage: options.authStorage,
    customTools: createWealthTools(options.service, {
      agentDir: options.agentDir,
      memoryAuditPath: path.join(options.agentDir, ".memory-updates.jsonl"),
      ...(options.memoryPath ? { memoryPath: options.memoryPath } : {}),
      soulAuditPath: path.join(options.agentDir, "soul-updates.jsonl"),
      ...(options.soulPath ? { soulPath: options.soulPath } : {}),
    }),
    cwd: options.cwd,
    ...(model ? { model } : {}),
    modelRegistry,
    resourceLoader,
    sessionManager: options.sessionManager,
    settingsManager,
    thinkingLevel: modelSettings.defaultThinkingLevel,
    tools: [],
  };
}

export async function createWealthAgentSession(options: CreateWealthAgentSessionOptions) {
  const config = await buildWealthAgentSessionConfig(options);

  return createAgentSession(config);
}
