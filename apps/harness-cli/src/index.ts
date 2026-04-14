import { mkdirSync } from "node:fs";
import path from "node:path";
import { stderr as errorOutput, stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import { AuthStorage, SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";

import { createHarnessCli, openBrowser } from "./harness.js";
import { WealthApiClient } from "./wealthApiClient.js";
import { createWealthAgentSession, getWealthHarnessPaths } from "./wealthSession.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const { agentDir, authPath, sessionCwd } = getWealthHarnessPaths(repoRoot);
const authStorage = AuthStorage.create(authPath);
const wealthApiClient = new WealthApiClient({
  baseUrl: process.env.NIVEN_WEALTH_API_URL ?? "http://127.0.0.1:4321",
  ...(process.env.NIVEN_API_TOKEN ? { apiToken: process.env.NIVEN_API_TOKEN } : {}),
});

const app = createHarnessCli({
  agentDir,
  authPath,
  repoRoot,
  sessionCwd,
  stdin: input,
  stdout: output,
  stderr: errorOutput,
  mkdir(dir) {
    mkdirSync(dir, { recursive: true });
  },
  createPrompter() {
    return readline.createInterface({
      input,
      output: errorOutput,
    });
  },
  openBrowser,
  login: loginOpenAICodex,
  authStorage,
  async createSession(options) {
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionCwd, { recursive: true });

    return createWealthAgentSession({
      agentDir,
      client: wealthApiClient,
      cwd: options.cwd,
      authStorage,
      sessionManager: options.sessionManager as SessionManager,
      settingsManager: SettingsManager.inMemory(),
    });
  },
  createInMemorySessionManager: SessionManager.inMemory,
});

process.exitCode = await app.main(process.argv);
