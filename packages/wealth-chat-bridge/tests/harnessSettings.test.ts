import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  createWealthHarnessSettingsManager,
  getWealthHarnessModelSettingsFromEnv,
  resolveWealthHarnessModel,
} from "../src/harnessSettings.js";

function createCustomModelRegistry(): ModelRegistry {
  const modelRegistry = ModelRegistry.inMemory(AuthStorage.inMemory());

  modelRegistry.registerProvider("local-custom", {
    api: "openai-codex-responses",
    apiKey: "test",
    baseUrl: "http://localhost:11434/v1",
    models: [
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "niven-local",
        input: ["text"],
        maxTokens: 16384,
        name: "Niven Local",
        reasoning: false,
      },
    ],
  });

  return modelRegistry;
}

describe("wealth harness settings", () => {
  it("defaults to OpenAI Codex GPT-5.5 with medium thinking", () => {
    expect(getWealthHarnessModelSettingsFromEnv({})).toEqual({
      defaultModel: "gpt-5.5",
      defaultProvider: "openai-codex",
      defaultThinkingLevel: "medium",
    });
  });

  it("allows env overrides", () => {
    expect(
      getWealthHarnessModelSettingsFromEnv({
        NIVEN_HARNESS_MODEL: "gpt-5.4-mini",
        NIVEN_HARNESS_PROVIDER: "openai-codex",
        NIVEN_HARNESS_THINKING_LEVEL: "low",
      }),
    ).toEqual({
      defaultModel: "gpt-5.4-mini",
      defaultProvider: "openai-codex",
      defaultThinkingLevel: "low",
    });
  });

  it("rejects invalid thinking levels", () => {
    expect(() =>
      getWealthHarnessModelSettingsFromEnv({
        NIVEN_HARNESS_THINKING_LEVEL: "extremely",
      }),
    ).toThrow("Invalid NIVEN_HARNESS_THINKING_LEVEL");
  });

  it("rejects unknown providers", () => {
    expect(() =>
      resolveWealthHarnessModel(
        getWealthHarnessModelSettingsFromEnv({
          NIVEN_HARNESS_PROVIDER: "openai-codexx",
        }),
      ),
    ).toThrow('Invalid NIVEN_HARNESS_PROVIDER "openai-codexx"');
  });

  it("rejects unknown OpenAI Codex model ids instead of templating typos", () => {
    expect(() =>
      resolveWealthHarnessModel(
        getWealthHarnessModelSettingsFromEnv({
          NIVEN_HARNESS_MODEL: "gpt-5.5x",
        }),
      ),
    ).toThrow('Invalid NIVEN_HARNESS_MODEL "gpt-5.5x"');
  });

  it("resolves models from a custom registry before validating built-ins", () => {
    const model = resolveWealthHarnessModel(
      getWealthHarnessModelSettingsFromEnv({
        NIVEN_HARNESS_MODEL: "niven-local",
        NIVEN_HARNESS_PROVIDER: "local-custom",
      }),
      createCustomModelRegistry(),
    );

    expect(model.provider).toBe("local-custom");
    expect(model.id).toBe("niven-local");
  });

  it("resolves GPT-5.5 against the OpenAI Codex model template", () => {
    const model = resolveWealthHarnessModel(getWealthHarnessModelSettingsFromEnv({}));

    expect(model?.provider).toBe("openai-codex");
    expect(model?.id).toBe("gpt-5.5");
    expect(model?.reasoning).toBe(true);
  });

  it("creates an in-memory Pi settings manager from env", () => {
    const settingsManager = createWealthHarnessSettingsManager({});

    expect(settingsManager.getDefaultProvider()).toBe("openai-codex");
    expect(settingsManager.getDefaultModel()).toBe("gpt-5.5");
    expect(settingsManager.getDefaultThinkingLevel()).toBe("medium");
  });
});
