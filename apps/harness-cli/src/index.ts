import { mkdirSync } from "node:fs";
import path from "node:path";
import { stderr as errorOutput, stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import { AuthStorage, SessionManager } from "@mariozechner/pi-coding-agent";
import {
  createWealthAgentSession,
  createWealthHarnessSettingsManager,
  getWealthHarnessPaths,
  hasWealthMemory,
} from "@niven/wealth-chat-bridge";
import { createSandboxService } from "@niven/wealth-sandbox";

import { createHarnessCli, openBrowser } from "./harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const { agentDir, authPath, memoryPath, sessionCwd, soulPath } = getWealthHarnessPaths(repoRoot);
const authStorage = AuthStorage.create(authPath);
const wealthService = createSandboxService();

const app = createHarnessCli({
  agentDir,
  authPath,
  hasUserMemory() {
    return hasWealthMemory(memoryPath);
  },
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
      cwd: options.cwd,
      authStorage,
      memoryPath,
      service: wealthService,
      sessionManager: options.sessionManager as SessionManager,
      settingsManager: createWealthHarnessSettingsManager(),
      soulPath,
    });
  },
  createInMemorySessionManager: SessionManager.inMemory,
});

process.exitCode = await app.main(process.argv);
