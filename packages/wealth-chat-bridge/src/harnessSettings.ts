import { type Api, getModels, getProviders, type Model } from "@mariozechner/pi-ai";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

export const DEFAULT_WEALTH_HARNESS_PROVIDER = "openai-codex";
export const DEFAULT_WEALTH_HARNESS_MODEL = "gpt-5.5";
export const DEFAULT_WEALTH_HARNESS_THINKING_LEVEL = "medium";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

type HarnessSettings = NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>;
type ThinkingLevel = NonNullable<HarnessSettings["defaultThinkingLevel"]>;

export interface WealthHarnessEnv {
  readonly NIVEN_HARNESS_MODEL?: string | undefined;
  readonly NIVEN_HARNESS_PROVIDER?: string | undefined;
  readonly NIVEN_HARNESS_THINKING_LEVEL?: string | undefined;
}

export interface WealthHarnessModelSettings {
  readonly defaultModel: string;
  readonly defaultProvider: string;
  readonly defaultThinkingLevel: ThinkingLevel;
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function getWealthHarnessModelSettingsFromEnv(
  env: WealthHarnessEnv = process.env,
): WealthHarnessModelSettings {
  const defaultThinkingLevel =
    cleanEnvValue(env.NIVEN_HARNESS_THINKING_LEVEL) ?? DEFAULT_WEALTH_HARNESS_THINKING_LEVEL;

  if (!isThinkingLevel(defaultThinkingLevel)) {
    throw new Error(
      `Invalid NIVEN_HARNESS_THINKING_LEVEL "${defaultThinkingLevel}". Expected one of: ${THINKING_LEVELS.join(", ")}.`,
    );
  }

  return {
    defaultModel: cleanEnvValue(env.NIVEN_HARNESS_MODEL) ?? DEFAULT_WEALTH_HARNESS_MODEL,
    defaultProvider: cleanEnvValue(env.NIVEN_HARNESS_PROVIDER) ?? DEFAULT_WEALTH_HARNESS_PROVIDER,
    defaultThinkingLevel,
  };
}

export function createWealthHarnessSettingsManager(
  env: WealthHarnessEnv = process.env,
): SettingsManager {
  return SettingsManager.inMemory(getWealthHarnessModelSettingsFromEnv(env));
}

export function resolveWealthHarnessModel(
  settings: WealthHarnessModelSettings,
): Model<Api> | undefined {
  if (!getProviders().includes(settings.defaultProvider as never)) {
    return undefined;
  }

  const models = getModels(
    settings.defaultProvider as Parameters<typeof getModels>[0],
  ) as Model<Api>[];
  const registeredModel = models.find((model) => model.id === settings.defaultModel);

  if (registeredModel) {
    return registeredModel;
  }

  if (settings.defaultProvider !== DEFAULT_WEALTH_HARNESS_PROVIDER) {
    return undefined;
  }

  const templateModel = models.find((model) => model.id === "gpt-5.4");

  if (!templateModel) {
    return undefined;
  }

  return {
    ...templateModel,
    id: settings.defaultModel,
    name: settings.defaultModel.toUpperCase(),
  };
}
