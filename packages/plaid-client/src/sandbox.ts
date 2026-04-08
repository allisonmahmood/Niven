import { NotImplementedYetError } from "@niven/shared";

export interface LinkedSandboxItem {
  readonly itemId: string;
  readonly institutionId: string;
  readonly createdAt: string;
}

export async function createSandboxItemPlaceholder(): Promise<LinkedSandboxItem> {
  throw new NotImplementedYetError("Plaid sandbox item creation");
}
