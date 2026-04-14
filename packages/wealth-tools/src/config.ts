import path from "node:path";

import { type EnvMap, readBooleanEnv, readOptionalEnv } from "@niven/shared";

export interface WealthRuntimeConfig {
  readonly auditPath: string;
  readonly dataDirectory: string;
  readonly requireMutationApproval: boolean;
  readonly storePath: string;
}

export function readWealthRuntimeConfig(env: EnvMap = process.env): WealthRuntimeConfig {
  const dataDirectory =
    readOptionalEnv("NIVEN_DATA_DIR", env) ?? path.resolve(process.cwd(), ".niven");

  return {
    auditPath: readOptionalEnv("NIVEN_AUDIT_PATH", env) ?? path.join(dataDirectory, "audit.log"),
    dataDirectory,
    requireMutationApproval: readBooleanEnv("NIVEN_REQUIRE_MUTATION_APPROVAL", env, false),
    storePath:
      readOptionalEnv("NIVEN_STORE_PATH", env) ?? path.join(dataDirectory, "wealth-store.json"),
  };
}
