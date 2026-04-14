import type { Result } from "@niven/shared";

import { readWealthRuntimeConfig } from "../config.js";

export interface WealthToolsStatus {
  readonly ready: true;
  readonly requireMutationApproval: boolean;
  readonly sandboxOnly: true;
}

export function getWealthToolsStatus(): Result<WealthToolsStatus> {
  const runtime = readWealthRuntimeConfig();

  return {
    ok: true,
    value: {
      ready: true,
      requireMutationApproval: runtime.requireMutationApproval,
      sandboxOnly: true,
    },
  };
}
