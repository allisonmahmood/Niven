import type { LinkedSandboxItem } from "@niven/plaid-client";
import type { Result } from "@niven/shared";

export interface WealthToolsStatus {
  readonly ready: false;
  readonly linkedItems: readonly Pick<LinkedSandboxItem, "itemId" | "institutionId">[];
}

export function getWealthToolsStatus(): Result<WealthToolsStatus> {
  return {
    ok: true,
    value: {
      ready: false,
      linkedItems: [],
    },
  };
}
