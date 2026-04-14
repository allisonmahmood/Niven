import type { RemovedTransaction, Transaction, TransactionsSyncResponse } from "plaid";

import { createPlaidApiClient, executePlaidOperation, type PlaidApiLike } from "./client.js";

export interface TransactionSyncResult {
  readonly added: readonly Transaction[];
  readonly hasMore: boolean;
  readonly modified: readonly Transaction[];
  readonly nextCursor: string;
  readonly removed: readonly RemovedTransaction[];
  readonly requestId: string;
}

export async function syncTransactions(
  accessToken: string,
  cursor: string | null,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransactionSyncResult> {
  let nextCursor = cursor ?? undefined;
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: RemovedTransaction[] = [];
  let hasMore = true;
  let latestResponse: TransactionsSyncResponse | undefined;

  while (hasMore) {
    const response = await executePlaidOperation("transactions sync", async () => {
      return client.transactionsSync(
        nextCursor
          ? {
              access_token: accessToken,
              cursor: nextCursor,
            }
          : {
              access_token: accessToken,
            },
      );
    });

    latestResponse = response.data;
    added.push(...response.data.added);
    modified.push(...response.data.modified);
    removed.push(...response.data.removed);
    hasMore = response.data.has_more;
    nextCursor = response.data.next_cursor;
  }

  if (!latestResponse || !nextCursor) {
    throw new Error("Transactions sync returned no cursor.");
  }

  return {
    added,
    hasMore: false,
    modified,
    nextCursor,
    removed,
    requestId: latestResponse.request_id,
  };
}

export async function refreshTransactions(
  accessToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<{ readonly requestId: string }> {
  const response = await executePlaidOperation("transactions refresh", async () => {
    return client.transactionsRefresh({
      access_token: accessToken,
    });
  });

  return {
    requestId: response.data.request_id,
  };
}
