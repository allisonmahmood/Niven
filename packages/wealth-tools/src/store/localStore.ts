import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RemovedTransaction, Transaction } from "@niven/plaid-client";
import { NotFoundError } from "@niven/shared";

export interface LinkedItemRecord {
  readonly accessToken: string;
  readonly countryCodes: readonly string[];
  readonly createdAt: string;
  readonly initialProducts: readonly string[];
  readonly institutionId: string;
  readonly itemId: string;
  readonly lastTransactionsRefreshAt: string | null;
  readonly lastTransactionsSyncAt: string | null;
  readonly transactionsCursor: string | null;
}

export interface TransactionQuery {
  readonly accountId?: string;
  readonly endDate?: string;
  readonly limit?: number;
  readonly pending?: boolean;
  readonly query?: string;
  readonly startDate?: string;
}

interface StoredTransactionRecord {
  readonly itemId: string;
  readonly transaction: Transaction;
  readonly updatedAt: string;
}

interface StoredIdempotencyRecord {
  readonly createdAt: string;
  readonly operation: string;
  readonly response: unknown;
  readonly scope: string;
}

interface WealthStoreDocument {
  readonly version: 1;
  idempotency: Record<string, StoredIdempotencyRecord>;
  items: Record<string, LinkedItemRecord>;
  transactions: Record<string, StoredTransactionRecord>;
}

function createDefaultState(): WealthStoreDocument {
  return {
    version: 1,
    idempotency: {},
    items: {},
    transactions: {},
  };
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function transactionStorageKey(itemId: string, transactionId: string): string {
  return `${itemId}:${transactionId}`;
}

function idempotencyStorageKey(operation: string, scope: string, idempotencyKey: string): string {
  return `${operation}:${scope}:${idempotencyKey}`;
}

export class LocalWealthStore {
  private state: WealthStoreDocument | null = null;
  private stateMtimeMs: number | null = null;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async listItems(): Promise<readonly LinkedItemRecord[]> {
    const state = await this.readState();
    return Object.values(state.items)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((entry) => cloneValue(entry));
  }

  async getItem(itemId: string): Promise<LinkedItemRecord> {
    const state = await this.readState();
    const item = state.items[itemId];

    if (!item) {
      throw new NotFoundError(`Linked item ${itemId} was not found.`);
    }

    return cloneValue(item);
  }

  async saveItem(item: LinkedItemRecord): Promise<void> {
    await this.mutate(async (state) => {
      state.items[item.itemId] = cloneValue(item);
    });
  }

  async saveTransactions(
    itemId: string,
    nextCursor: string,
    added: readonly Transaction[],
    modified: readonly Transaction[],
    removed: readonly RemovedTransaction[],
    updatedAt: string,
  ): Promise<void> {
    await this.mutate(async (state) => {
      const item = state.items[itemId];

      if (!item) {
        throw new NotFoundError(`Linked item ${itemId} was not found.`);
      }

      for (const transaction of [...added, ...modified]) {
        state.transactions[transactionStorageKey(itemId, transaction.transaction_id)] = {
          itemId,
          transaction: cloneValue(transaction),
          updatedAt,
        };
      }

      for (const transaction of removed) {
        delete state.transactions[transactionStorageKey(itemId, transaction.transaction_id)];
      }

      state.items[itemId] = {
        ...item,
        lastTransactionsSyncAt: updatedAt,
        transactionsCursor: nextCursor,
      };
    });
  }

  async markTransactionsRefreshed(itemId: string, refreshedAt: string): Promise<void> {
    await this.mutate(async (state) => {
      const item = state.items[itemId];

      if (!item) {
        throw new NotFoundError(`Linked item ${itemId} was not found.`);
      }

      state.items[itemId] = {
        ...item,
        lastTransactionsRefreshAt: refreshedAt,
      };
    });
  }

  async listTransactions(
    itemId: string,
    query: TransactionQuery = {},
  ): Promise<readonly Transaction[]> {
    const state = await this.readState();
    const records = Object.values(state.transactions)
      .filter((entry) => entry.itemId === itemId)
      .map((entry) => entry.transaction)
      .filter((transaction) => {
        if (query.accountId && transaction.account_id !== query.accountId) {
          return false;
        }

        if (query.pending !== undefined && transaction.pending !== query.pending) {
          return false;
        }

        if (query.startDate && transaction.date < query.startDate) {
          return false;
        }

        if (query.endDate && transaction.date > query.endDate) {
          return false;
        }

        if (query.query) {
          const haystack = [
            transaction.name,
            transaction.merchant_name,
            transaction.original_description,
          ]
            .filter((value): value is string => typeof value === "string")
            .join(" ")
            .toLowerCase();

          if (!haystack.includes(query.query.toLowerCase())) {
            return false;
          }
        }

        return true;
      })
      .sort((left, right) => {
        const byDate = right.date.localeCompare(left.date);
        return byDate !== 0 ? byDate : right.transaction_id.localeCompare(left.transaction_id);
      });

    const limited = query.limit ? records.slice(0, query.limit) : records;
    return limited.map((entry) => cloneValue(entry));
  }

  async getIdempotentResult<T>(
    operation: string,
    scope: string,
    idempotencyKey: string,
  ): Promise<T | undefined> {
    const state = await this.readState();
    const record = state.idempotency[idempotencyStorageKey(operation, scope, idempotencyKey)];
    return record ? cloneValue(record.response as T) : undefined;
  }

  async saveIdempotentResult(
    operation: string,
    scope: string,
    idempotencyKey: string,
    response: unknown,
    createdAt: string,
  ): Promise<void> {
    await this.mutate(async (state) => {
      state.idempotency[idempotencyStorageKey(operation, scope, idempotencyKey)] = {
        createdAt,
        operation,
        response: cloneValue(response),
        scope,
      };
    });
  }

  private async readState(): Promise<WealthStoreDocument> {
    await this.writeQueue;
    return cloneValue(await this.readStateInternal());
  }

  private async mutate<T>(fn: (state: WealthStoreDocument) => Promise<T> | T): Promise<T> {
    const run = async () => {
      const state = await this.readStateInternal();
      const result = await fn(state);
      await this.persistState(state);
      return result;
    };

    const next = this.writeQueue.then(run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private async readStateInternal(): Promise<WealthStoreDocument> {
    const currentMtimeMs = await this.readFileMtimeMs();

    if (
      this.state &&
      ((this.stateMtimeMs === null && currentMtimeMs === null) ||
        (this.stateMtimeMs !== null &&
          currentMtimeMs !== null &&
          this.stateMtimeMs === currentMtimeMs))
    ) {
      return this.state;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state =
        raw.trim().length > 0 ? (JSON.parse(raw) as WealthStoreDocument) : createDefaultState();
      this.stateMtimeMs = await this.readFileMtimeMs();
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";

      if (!missing) {
        throw error;
      }

      this.state = createDefaultState();
      await this.persistState(this.state);
    }

    return this.state;
  }

  private async persistState(state: WealthStoreDocument): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    this.state = state;
    this.stateMtimeMs = await this.readFileMtimeMs();
  }

  private async readFileMtimeMs(): Promise<number | null> {
    try {
      return (await stat(this.filePath)).mtimeMs;
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";

      if (missing) {
        return null;
      }

      throw error;
    }
  }
}
