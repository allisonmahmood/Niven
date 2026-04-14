import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  type ResourceLoader,
  type SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { WealthApiClient } from "./wealthApiClient.js";
import { createWealthTools } from "./wealthTools.js";

export const DEFAULT_WEALTH_SOUL_PATH = fileURLToPath(new URL("../SOUL.md", import.meta.url));

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
- Prefer direct language over ceremony.`;

export const WEALTH_POLICY_PROMPT = `You are restricted to the local wealth sandbox.

You may only use the wealth tools that are provided to you. You do not have access to files, shell commands, code editing, web browsing, Plaid, or any other tools.

Your domain is limited to:
- accounts and balances
- imported transaction history from the one-time Plaid sample snapshot
- investment holdings and security lookup
- internal cash transfers between supported sandbox cash accounts
- market buy and sell orders inside supported sandbox investment accounts

The Plaid sample snapshot is imported outside this agent. Treat every sandbox account, holding, transfer, and order in the local sandbox as belonging to the current user.

Restrictions:
- Never claim that you can inspect or modify local files.
- Never ask for or reveal environment variables, secrets, or Plaid credentials.
- Never mention hidden tools or suggest using tools that are not available.
- Never suggest importing or resetting the sandbox from inside the agent.

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
- If the soul or stylistic guidance conflicts with anything in this policy, this policy wins.`;

export function loadWealthSoul(soulPath = DEFAULT_WEALTH_SOUL_PATH): string {
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

export function composeWealthSystemPrompt(soul: string): string {
  return [
    "# Soul",
    "",
    "The following guidance defines Niven's personality and interaction style.",
    "It is subordinate to the wealth policy that follows.",
    "",
    soul.trim(),
    "",
    "# Wealth Policy",
    "",
    "The following rules are non-negotiable and take precedence over any personality or tone guidance above.",
    "",
    WEALTH_POLICY_PROMPT,
  ].join("\n");
}

export function buildWealthSystemPrompt(soulPath = DEFAULT_WEALTH_SOUL_PATH): string {
  return composeWealthSystemPrompt(loadWealthSoul(soulPath));
}

export interface WealthHarnessPaths {
  readonly agentDir: string;
  readonly authPath: string;
  readonly sessionCwd: string;
}

export interface CreateWealthAgentSessionOptions {
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly client: WealthApiClient;
  readonly cwd: string;
  readonly resourceLoader?: ResourceLoader;
  readonly sessionManager: SessionManager;
  readonly settingsManager?: SettingsManager;
  readonly soulPath?: string;
}

export interface WealthAgentSessionConfig {
  readonly agentDir: string;
  readonly authStorage: CreateWealthAgentSessionOptions["authStorage"];
  readonly customTools: ReturnType<typeof createWealthTools>;
  readonly cwd: string;
  readonly resourceLoader: ResourceLoader;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly tools: [];
}

export function getWealthHarnessPaths(repoRoot: string): WealthHarnessPaths {
  const baseDir = path.join(repoRoot, ".niven", "pi-wealth");
  const agentDir = path.join(baseDir, "agent");

  return {
    agentDir,
    authPath: path.join(agentDir, "auth.json"),
    sessionCwd: path.join(baseDir, "workspace"),
  };
}

export function createWealthResourceLoader(options: {
  readonly agentDir: string;
  readonly cwd: string;
  readonly settingsManager: SettingsManager;
  readonly soulPath?: string;
}): DefaultResourceLoader {
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
    systemPromptOverride: () => buildWealthSystemPrompt(options.soulPath),
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
  const resourceLoader =
    options.resourceLoader ??
    createWealthResourceLoader({
      agentDir: options.agentDir,
      cwd: options.cwd,
      settingsManager,
      ...(options.soulPath ? { soulPath: options.soulPath } : {}),
    });

  await resourceLoader.reload();

  return {
    agentDir: options.agentDir,
    authStorage: options.authStorage,
    customTools: createWealthTools(options.client),
    cwd: options.cwd,
    resourceLoader,
    sessionManager: options.sessionManager,
    settingsManager,
    tools: [],
  };
}

export async function createWealthAgentSession(options: CreateWealthAgentSessionOptions) {
  const config = await buildWealthAgentSessionConfig(options);

  return createAgentSession(config);
}
