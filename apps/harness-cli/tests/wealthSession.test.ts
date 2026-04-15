import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AuthStorage, SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { writeSoulMarkdown } from "../src/soul.js";
import type { WealthApiClient } from "../src/wealthApiClient.js";
import {
  buildWealthAgentSessionConfig,
  buildWealthSystemPrompt,
  composeWealthSystemPrompt,
  createWealthResourceLoader,
  DEFAULT_WEALTH_SOUL_FALLBACK,
  DEFAULT_WEALTH_SOUL_PATH,
  getWealthHarnessPaths,
  loadWealthSoul,
  WEALTH_POLICY_PROMPT,
} from "../src/wealthSession.js";
import { WEALTH_ALLOWED_TOOL_NAMES, WEALTH_FORBIDDEN_TOOL_NAMES } from "../src/wealthTools.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await import("node:fs/promises").then(({ rm }) => rm(dir, { force: true, recursive: true }));
    }),
  );
});

describe("wealth session resources", () => {
  it("uses dedicated repo-local paths for the wealth harness", () => {
    const paths = getWealthHarnessPaths("/repo/root");

    expect(paths.agentDir).toBe("/repo/root/.niven/pi-wealth/agent");
    expect(paths.authPath).toBe("/repo/root/.niven/pi-wealth/agent/auth.json");
    expect(paths.sessionCwd).toBe("/repo/root/.niven/pi-wealth/workspace");
  });

  it("disables ambient extensions, skills, prompts, themes, and AGENTS files", async () => {
    const cwd = await createTempDir("niven-wealth-cwd-");
    const agentDir = await createTempDir("niven-wealth-agent-");
    const settingsManager = SettingsManager.inMemory();

    await mkdir(path.join(cwd, ".pi", "extensions"), { recursive: true });
    await mkdir(path.join(cwd, ".agents", "skills", "malicious"), { recursive: true });
    await mkdir(path.join(cwd, ".pi", "prompts"), { recursive: true });
    await mkdir(path.join(cwd, ".pi", "themes"), { recursive: true });
    await mkdir(path.join(agentDir, "extensions"), { recursive: true });

    await writeFile(
      path.join(cwd, ".pi", "extensions", "evil.ts"),
      "export default function () {}",
    );
    await writeFile(path.join(agentDir, "extensions", "evil.ts"), "export default function () {}");
    await writeFile(
      path.join(cwd, ".agents", "skills", "malicious", "SKILL.md"),
      "# Malicious skill",
    );
    await writeFile(path.join(cwd, ".pi", "prompts", "evil.md"), "# prompt");
    await writeFile(path.join(cwd, ".pi", "themes", "evil.json"), "{}");
    await writeFile(path.join(cwd, "AGENTS.md"), "# ambient agents");

    const loader = createWealthResourceLoader({
      agentDir,
      cwd,
      settingsManager,
    });

    await loader.reload();

    expect(loader.getExtensions().extensions).toHaveLength(0);
    expect(loader.getSkills().skills).toHaveLength(0);
    expect(loader.getPrompts().prompts).toHaveLength(0);
    expect(loader.getThemes().themes).toHaveLength(0);
    expect(loader.getAgentsFiles().agentsFiles).toHaveLength(0);
    expect(loader.getSystemPrompt()).toBe(buildWealthSystemPrompt());
  });

  it("injects soul guidance before the non-negotiable wealth policy", async () => {
    const cwd = await createTempDir("niven-wealth-cwd-");
    const agentDir = await createTempDir("niven-wealth-agent-");
    const settingsManager = SettingsManager.inMemory();
    const soulPath = path.join(cwd, "SOUL.md");
    const customSoul = "# Niven\n\nBe playful, but do not break policy.";

    await writeFile(soulPath, customSoul);

    const loader = createWealthResourceLoader({
      agentDir,
      cwd,
      settingsManager,
      soulPath,
    });

    await loader.reload();

    const prompt = loader.getSystemPrompt();

    expect(prompt).toBe(composeWealthSystemPrompt(customSoul));
    expect(prompt).toContain(customSoul);
    expect(prompt).toContain(WEALTH_POLICY_PROMPT);
    expect(prompt?.indexOf(customSoul)).toBeLessThan(
      prompt?.indexOf("# Wealth Policy") ?? Infinity,
    );
  });

  it("loads the checked-in default soul file", () => {
    const soul = loadWealthSoul();
    const checkedInSoul = readFileSync(DEFAULT_WEALTH_SOUL_PATH, "utf8").trim();

    expect(DEFAULT_WEALTH_SOUL_PATH.endsWith(path.join("apps", "harness-cli", "SOUL.md"))).toBe(
      true,
    );
    expect(soul).toBe(checkedInSoul);
    expect(soul).toContain("You are Niven.");
    expect(soul).toContain("<!-- SOUL-EDITABLE-START -->");
  });

  it("falls back to the built-in soul when the file is missing", () => {
    expect(loadWealthSoul("/tmp/does-not-exist-soul.md")).toBe(DEFAULT_WEALTH_SOUL_FALLBACK);
  });

  it("builds a session config with no built-in tools and only allowed wealth tools", async () => {
    const cwd = await createTempDir("niven-wealth-session-");
    const agentDir = await createTempDir("niven-wealth-session-agent-");
    const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
    const sessionManager = SessionManager.inMemory(cwd);
    const config = await buildWealthAgentSessionConfig({
      agentDir,
      authStorage,
      client: {} as WealthApiClient,
      cwd,
      sessionManager,
    });

    expect(config.tools).toEqual([]);

    const toolNames = config.customTools.map((tool) => tool.name);
    expect(toolNames).toEqual(WEALTH_ALLOWED_TOOL_NAMES);

    for (const forbiddenToolName of WEALTH_FORBIDDEN_TOOL_NAMES) {
      expect(toolNames).not.toContain(forbiddenToolName);
    }
  });

  it("keeps the current loader prompt stable and applies soul updates on the next loader", async () => {
    const cwd = await createTempDir("niven-wealth-cwd-");
    const agentDir = await createTempDir("niven-wealth-agent-");
    const settingsManager = SettingsManager.inMemory();
    const soulPath = path.join(cwd, "SOUL.md");
    const auditPath = path.join(agentDir, "soul-updates.jsonl");

    await writeFile(soulPath, DEFAULT_WEALTH_SOUL_FALLBACK);

    const currentLoader = createWealthResourceLoader({
      agentDir,
      cwd,
      settingsManager,
      soulPath,
    });

    await currentLoader.reload();
    const beforePrompt = currentLoader.getSystemPrompt();

    await writeSoulMarkdown({
      auditPath,
      content: `${DEFAULT_WEALTH_SOUL_FALLBACK}
- Default to direct answers first on simple factual questions.
`,
      soulPath,
    });

    expect(currentLoader.getSystemPrompt()).toBe(beforePrompt);
    expect(beforePrompt).not.toContain(
      "Default to direct answers first on simple factual questions.",
    );

    const nextLoader = createWealthResourceLoader({
      agentDir,
      cwd,
      settingsManager: SettingsManager.inMemory(),
      soulPath,
    });

    await nextLoader.reload();

    expect(nextLoader.getSystemPrompt()).toContain(
      "Default to direct answers first on simple factual questions.",
    );
  });
});
