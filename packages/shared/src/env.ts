import { NivenError } from "./errors.js";
import type { EnvMap } from "./types.js";

export function readOptionalEnv(name: string, env: EnvMap = process.env): string | undefined {
  return env[name];
}

export function readRequiredEnv(name: string, env: EnvMap = process.env): string {
  const value = readOptionalEnv(name, env);

  if (!value) {
    throw new NivenError(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function readBooleanEnv(
  name: string,
  env: EnvMap = process.env,
  defaultValue = false,
): boolean {
  const value = readOptionalEnv(name, env);

  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new NivenError(`Invalid boolean environment variable: ${name}`);
}

export function readCsvEnv(name: string, env: EnvMap = process.env): readonly string[] {
  const value = readOptionalEnv(name, env);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
