import type { Result } from "@niven/shared";

export interface MarkdownSummary {
  readonly title: string;
  readonly body: string;
}

export function createPlaceholderSummary(): Result<MarkdownSummary> {
  return {
    ok: true,
    value: {
      title: "Bootstrap summary",
      body: "Wealth tools are scaffolded but no business logic is implemented yet.",
    },
  };
}
