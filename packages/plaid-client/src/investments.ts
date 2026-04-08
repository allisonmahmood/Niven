import { NotImplementedYetError } from "@niven/shared";

export interface HoldingsSnapshot {
  readonly itemId: string;
  readonly holdingsCount: number;
}

export async function getHoldingsPlaceholder(itemId: string): Promise<HoldingsSnapshot> {
  void itemId;
  throw new NotImplementedYetError("Plaid holdings retrieval");
}
