import path from "node:path";

import { type EnvMap, readBooleanEnv, readOptionalEnv } from "@niven/shared";

import type { SandboxRuntimeConfig } from "./types.js";

export function readSandboxRuntimeConfig(env: EnvMap = process.env): SandboxRuntimeConfig {
  const dataDirectory =
    readOptionalEnv("NIVEN_SANDBOX_DATA_DIR", env) ??
    readOptionalEnv("NIVEN_DATA_DIR", env) ??
    path.resolve(process.cwd(), ".niven");

  return {
    auditPath:
      readOptionalEnv("NIVEN_SANDBOX_AUDIT_PATH", env) ??
      path.join(dataDirectory, "wealth-sandbox-audit.log"),
    dataDirectory,
    requireMutationApproval: readBooleanEnv("NIVEN_REQUIRE_MUTATION_APPROVAL", env, false),
    statePath:
      readOptionalEnv("NIVEN_SANDBOX_STATE_PATH", env) ??
      path.join(dataDirectory, "wealth-sandbox-state.json"),
  };
}
