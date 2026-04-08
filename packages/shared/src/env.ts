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
