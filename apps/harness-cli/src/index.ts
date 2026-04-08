import { mkdirSync } from "node:fs";
import path from "node:path";
import { stderr as errorOutput, stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import {
  AuthStorage,
  createAgentSession,
  getAgentDir,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

import { createHarnessCli, openBrowser } from "./harness.js";

const agentDir = getAgentDir();
const authPath = path.join(agentDir, "auth.json");
const authStorage = AuthStorage.create(authPath);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const app = createHarnessCli({
  agentDir,
  authPath,
  repoRoot,
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
  createSession(options) {
    return createAgentSession({
      cwd: options.cwd,
      authStorage,
      sessionManager: options.sessionManager as SessionManager,
      tools: options.tools,
    });
  },
  createInMemorySessionManager: SessionManager.inMemory,
});

process.exitCode = await app.main(process.argv);
