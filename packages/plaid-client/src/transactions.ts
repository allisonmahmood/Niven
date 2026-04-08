import { NotImplementedYetError } from "@niven/shared";

export interface TransactionSyncResult {
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
}

export async function syncTransactionsPlaceholder(itemId: string): Promise<TransactionSyncResult> {
  void itemId;
  throw new NotImplementedYetError("Plaid transaction sync");
}
