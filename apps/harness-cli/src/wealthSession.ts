import path from "node:path";

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

export const WEALTH_SYSTEM_PROMPT = `You are Pi, a wealth management agent restricted to the local wealth sandbox.

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

Keep responses concise, factual, and specific to sandbox wealth management.`;

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
    systemPromptOverride: () => WEALTH_SYSTEM_PROMPT,
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
