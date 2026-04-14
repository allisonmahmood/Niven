import { type EnvMap, readOptionalEnv } from "@niven/shared";

export interface WealthApiEnv {
  readonly apiToken: string | undefined;
  readonly host: string;
  readonly port: number;
}

export function readWealthApiEnv(env: EnvMap = process.env): WealthApiEnv {
  const portValue = readOptionalEnv("NIVEN_API_PORT", env) ?? "4321";
  const port = Number.parseInt(portValue, 10);

  return {
    apiToken: readOptionalEnv("NIVEN_API_TOKEN", env),
    host: readOptionalEnv("NIVEN_API_HOST", env) ?? "127.0.0.1",
    port: Number.isFinite(port) ? port : 4321,
  };
}
