import {
  type ACHClass,
  type AccountBase,
  authorizeTransfer,
  type CountryCode,
  type CustomSandboxTransaction,
  cancelRecurringTransfer,
  cancelTransfer,
  createPlaidApiClient,
  createRecurringTransfer,
  createSandboxItem,
  createSandboxTransactions,
  createTransfer,
  fireSandboxItemWebhook,
  getAccountBalances,
  getAccounts,
  getHoldings,
  getInvestmentTransactions,
  getItem,
  getTransfer,
  getTransferBalance,
  getTransferCapabilities,
  getTransferConfiguration,
  listRecurringTransfers,
  listTransfers,
  type PlaidApiLike,
  type Products,
  type ReasonCode,
  refreshTransactions,
  resetSandboxLogin,
  type SandboxItemFireWebhookRequestWebhookCodeEnum,
  syncTransactions,
  type TransferBalanceType,
  type TransferNetwork,
  type TransferRecurringNetwork,
  type TransferScheduleIntervalUnit,
  type TransferType,
  type WebhookType,
} from "@niven/plaid-client";
import type { JsonObject } from "@niven/shared";
import { ApprovalRequiredError, isRecord, type Result, ValidationError } from "@niven/shared";

import { readWealthRuntimeConfig, type WealthRuntimeConfig } from "../config.js";
import {
  cancelTransferSchema,
  investmentTransactionQuerySchema,
  mutationControlSchema,
  type RecurringTransferInput,
  recurringTransferListSchema,
  recurringTransferSchema,
  sandboxLinkSchema,
  sandboxTransactionsCreateSchema,
  sandboxWebhookSchema,
  type TransferAuthorizationInput,
  transactionQuerySchema,
  transferAuthorizationSchema,
  transferBalanceQuerySchema,
  transferCreateSchema,
  transferListSchema,
  validateSchema,
} from "../schemas/index.js";
import { AuditLogger } from "../security/audit.js";
import { type LinkedItemRecord, LocalWealthStore } from "../store/localStore.js";

export interface MutationDryRunResult {
  readonly approvalRequired: boolean;
  readonly approvalSatisfied: boolean;
  readonly idempotencyKey: string;
  readonly mode: "dry_run";
  readonly operation: string;
  readonly summary: JsonObject;
}

export type MutationResult<T extends Record<string, unknown>> =
  | MutationDryRunResult
  | (T & {
      readonly idempotencyKey: string;
      readonly mode: "live";
      readonly replayed?: boolean;
    });

export interface WealthService {
  authorizeTransfer(
    itemId: string,
    accountId: string,
    input: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  cancelRecurringTransfer(
    recurringTransferId: string,
    control: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  cancelTransfer(
    transferId: string,
    input: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  createRecurringTransfer(
    itemId: string,
    accountId: string,
    input: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  createSandboxTransactions(
    itemId: string,
    input: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  createTransfer(
    itemId: string,
    accountId: string,
    input: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  fireSandboxItemWebhook(
    itemId: string,
    input: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  getAccounts(itemId: string): Promise<Record<string, unknown>>;
  getBalances(itemId: string): Promise<Record<string, unknown>>;
  getConfig(): Record<string, unknown>;
  getHoldings(itemId: string): Promise<Record<string, unknown>>;
  getItem(itemId: string): Promise<Record<string, unknown>>;
  getTransactions(itemId: string, input: unknown): Promise<Record<string, unknown>>;
  getTransfer(identifier: {
    readonly authorizationId?: string;
    readonly transferId?: string;
  }): Promise<Record<string, unknown>>;
  getTransferBalance(input: unknown): Promise<Record<string, unknown>>;
  getTransferCapabilities(itemId: string, accountId: string): Promise<Record<string, unknown>>;
  getTransferConfiguration(): Promise<Record<string, unknown>>;
  getInvestmentTransactions(itemId: string, input: unknown): Promise<Record<string, unknown>>;
  linkSandboxItem(input: unknown): Promise<MutationResult<Record<string, unknown>>>;
  listItems(): Promise<Record<string, unknown>>;
  listRecurringTransfers(input: unknown): Promise<Record<string, unknown>>;
  listTransfers(input: unknown): Promise<Record<string, unknown>>;
  refreshTransactions(
    itemId: string,
    control: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  resetSandboxLogin(
    itemId: string,
    control: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
  syncTransactions(
    itemId: string,
    control: unknown,
  ): Promise<MutationResult<Record<string, unknown>>>;
}

export interface WealthServiceOptions {
  readonly auditLogger?: AuditLogger;
  readonly clock?: () => string;
  readonly plaidClient?: PlaidApiLike;
  readonly runtimeConfig?: WealthRuntimeConfig;
  readonly store?: LocalWealthStore;
}

function makeSafeItem(record: LinkedItemRecord): JsonObject {
  return {
    countryCodes: [...record.countryCodes],
    createdAt: record.createdAt,
    initialProducts: [...record.initialProducts],
    institutionId: record.institutionId,
    itemId: record.itemId,
    lastTransactionsRefreshAt: record.lastTransactionsRefreshAt,
    lastTransactionsSyncAt: record.lastTransactionsSyncAt,
    transactionsCursorPresent: record.transactionsCursor !== null,
  };
}

function makeUserSummary(records: readonly LinkedItemRecord[]): JsonObject {
  return {
    linkedItemCount: records.length,
  };
}

function optionalFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function createWealthService(options: WealthServiceOptions = {}): WealthService {
  const runtimeConfig = options.runtimeConfig ?? readWealthRuntimeConfig();
  const store = options.store ?? new LocalWealthStore(runtimeConfig.storePath);
  const auditLogger = options.auditLogger ?? new AuditLogger(runtimeConfig.auditPath);
  const plaidClient = options.plaidClient ?? createPlaidApiClient();
  const now = options.clock ?? (() => new Date().toISOString());

  async function getItemRecord(itemId: string): Promise<LinkedItemRecord> {
    return store.getItem(itemId);
  }

  async function getAccountForItem(itemId: string, accountId: string): Promise<AccountBase> {
    const item = await getItemRecord(itemId);
    const response = await getAccounts(item.accessToken, plaidClient);
    const account = response.accounts.find((entry) => entry.account_id === accountId);

    if (!account) {
      throw new ValidationError(`Account ${accountId} does not belong to linked item ${itemId}.`);
    }

    return account;
  }

  async function runMutation<T extends Record<string, unknown>>(params: {
    readonly action: () => Promise<T>;
    readonly control: unknown;
    readonly metadata?: JsonObject;
    readonly operation: string;
    readonly resourceId?: string;
    readonly scope: string;
    readonly summary: JsonObject;
  }): Promise<MutationResult<T>> {
    const control = validateSchema(mutationControlSchema, params.control);
    const cached = await store.getIdempotentResult<MutationResult<T>>(
      params.operation,
      params.scope,
      control.idempotencyKey,
    );

    if (cached) {
      const replayed = isRecord(cached)
        ? ({ ...cached, replayed: true } as MutationResult<T>)
        : cached;

      await auditLogger.record({
        action: params.operation,
        idempotencyKey: control.idempotencyKey,
        result: {
          replayed: true,
        },
        status: "idempotent_replay",
        timestamp: now(),
        ...optionalFields({
          metadata: params.metadata,
          resourceId: params.resourceId,
        }),
      });

      return replayed;
    }

    const approvalSatisfied =
      !runtimeConfig.requireMutationApproval || control.approval?.approved === true;

    if (!approvalSatisfied) {
      await auditLogger.record({
        action: params.operation,
        idempotencyKey: control.idempotencyKey,
        result: params.summary,
        status: "blocked",
        timestamp: now(),
        ...optionalFields({
          metadata: params.metadata,
          resourceId: params.resourceId,
        }),
      });

      throw new ApprovalRequiredError(undefined, {
        operation: params.operation,
      });
    }

    if (control.dryRun) {
      const dryRunResult: MutationDryRunResult = {
        approvalRequired: runtimeConfig.requireMutationApproval,
        approvalSatisfied,
        idempotencyKey: control.idempotencyKey,
        mode: "dry_run",
        operation: params.operation,
        summary: params.summary,
      };

      await auditLogger.record({
        action: params.operation,
        idempotencyKey: control.idempotencyKey,
        result: params.summary,
        status: "dry_run",
        timestamp: now(),
        ...optionalFields({
          metadata: params.metadata,
          resourceId: params.resourceId,
        }),
      });

      return dryRunResult;
    }

    try {
      const result = {
        ...(await params.action()),
        idempotencyKey: control.idempotencyKey,
        mode: "live" as const,
      };

      await store.saveIdempotentResult(
        params.operation,
        params.scope,
        control.idempotencyKey,
        result,
        now(),
      );

      await auditLogger.record({
        action: params.operation,
        idempotencyKey: control.idempotencyKey,
        result: params.summary,
        status: "succeeded",
        timestamp: now(),
        ...optionalFields({
          metadata: params.metadata,
          resourceId: params.resourceId,
        }),
      });

      return result;
    } catch (error) {
      await auditLogger.record({
        action: params.operation,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
        idempotencyKey: control.idempotencyKey,
        result: params.summary,
        status: "failed",
        timestamp: now(),
        ...optionalFields({
          metadata: params.metadata,
          resourceId: params.resourceId,
        }),
      });
      throw error;
    }
  }

  return {
    async linkSandboxItem(input: unknown) {
      const parsed = validateSchema(sandboxLinkSchema, input);

      return runMutation({
        action: async () => {
          const sandboxTransactions = parsed.transactions
            ? {
                ...(parsed.transactions.daysRequested !== undefined
                  ? { daysRequested: parsed.transactions.daysRequested }
                  : {}),
                ...(parsed.transactions.endDate ? { endDate: parsed.transactions.endDate } : {}),
                ...(parsed.transactions.startDate
                  ? { startDate: parsed.transactions.startDate }
                  : {}),
              }
            : undefined;

          const linkedItem = await createSandboxItem(
            {
              countryCodes: ["US" as CountryCode],
              initialProducts: parsed.initialProducts as Products[],
              institutionId: parsed.institutionId,
              ...optionalFields({
                password: parsed.password,
                ...(sandboxTransactions ? { transactions: sandboxTransactions } : {}),
                username: parsed.username,
                webhook: parsed.webhook,
              }),
            },
            plaidClient,
          );

          const record: LinkedItemRecord = {
            accessToken: linkedItem.accessToken,
            countryCodes: linkedItem.countryCodes as string[],
            createdAt: linkedItem.createdAt,
            initialProducts: linkedItem.initialProducts as string[],
            institutionId: linkedItem.institutionId,
            itemId: linkedItem.itemId,
            lastTransactionsRefreshAt: null,
            lastTransactionsSyncAt: null,
            transactionsCursor: null,
          };

          await store.saveItem(record);

          return {
            item: makeSafeItem(record),
            summary: {
              institutionId: record.institutionId,
              linkedAt: record.createdAt,
              productCount: record.initialProducts.length,
            },
          };
        },
        control: parsed.control,
        metadata: {
          institutionId: parsed.institutionId,
          products: parsed.initialProducts,
        },
        operation: "sandbox_link_item",
        resourceId: parsed.institutionId,
        scope: parsed.institutionId,
        summary: {
          institutionId: parsed.institutionId,
          productCount: parsed.initialProducts.length,
        },
      });
    },

    async listItems() {
      const items = await store.listItems();

      return {
        items: items.map((entry) => makeSafeItem(entry)),
        summary: {
          ...makeUserSummary(items),
          requireMutationApproval: runtimeConfig.requireMutationApproval,
        },
      };
    },

    async getItem(itemId: string) {
      const record = await getItemRecord(itemId);
      const item = await getItem(record.accessToken, plaidClient);

      return {
        item: item.item,
        linkedItem: makeSafeItem(record),
        status: item.status,
        summary: {
          billedProducts: item.item.billed_products,
          institutionId: record.institutionId,
        },
      };
    },

    async getAccounts(itemId: string) {
      const record = await getItemRecord(itemId);
      const accounts = await getAccounts(record.accessToken, plaidClient);

      return {
        accounts: accounts.accounts,
        item: makeSafeItem(record),
        summary: summarizeAccounts(accounts.accounts),
      };
    },

    async getBalances(itemId: string) {
      const record = await getItemRecord(itemId);
      const balances = await getAccountBalances(record.accessToken, plaidClient);

      return {
        accounts: balances.accounts,
        item: makeSafeItem(record),
        summary: summarizeBalances(balances.accounts),
      };
    },

    async syncTransactions(itemId: string, control: unknown) {
      const record = await getItemRecord(itemId);

      return runMutation({
        action: async () => {
          const result = await syncTransactions(
            record.accessToken,
            record.transactionsCursor,
            plaidClient,
          );
          const timestamp = now();

          await store.saveTransactions(
            itemId,
            result.nextCursor,
            result.added,
            result.modified,
            result.removed,
            timestamp,
          );

          return {
            item: makeSafeItem(await store.getItem(itemId)),
            requestId: result.requestId,
            summary: {
              added: result.added.length,
              modified: result.modified.length,
              removed: result.removed.length,
            },
          };
        },
        control,
        metadata: {
          itemId,
        },
        operation: "transactions_sync",
        resourceId: itemId,
        scope: itemId,
        summary: {
          itemId,
        },
      });
    },

    async refreshTransactions(itemId: string, control: unknown) {
      const record = await getItemRecord(itemId);

      return runMutation({
        action: async () => {
          const result = await refreshTransactions(record.accessToken, plaidClient);
          const refreshedAt = now();
          await store.markTransactionsRefreshed(itemId, refreshedAt);

          return {
            item: makeSafeItem(await store.getItem(itemId)),
            requestId: result.requestId,
            summary: {
              refreshedAt,
            },
          };
        },
        control,
        metadata: {
          itemId,
        },
        operation: "transactions_refresh",
        resourceId: itemId,
        scope: itemId,
        summary: {
          itemId,
        },
      });
    },

    async getTransactions(itemId: string, input: unknown) {
      const parsed = validateSchema(transactionQuerySchema, input);

      if (parsed.refresh) {
        if (runtimeConfig.requireMutationApproval) {
          throw new ValidationError(
            "Transaction refresh on a read route is disabled when approvals are required. Use POST /transactions/sync instead.",
          );
        }

        await this.syncTransactions(itemId, {
          approval: {
            approved: true,
          },
          dryRun: false,
          idempotencyKey: `auto-sync-${Date.now()}`,
        });
      }

      const record = await getItemRecord(itemId);
      const transactions = await store.listTransactions(
        itemId,
        optionalFields({
          accountId: parsed.accountId,
          endDate: parsed.endDate,
          limit: parsed.limit,
          pending: parsed.pending,
          query: parsed.query,
          startDate: parsed.startDate,
        }),
      );

      return {
        item: makeSafeItem(record),
        summary: summarizeTransactions(transactions),
        transactions,
      };
    },

    async createSandboxTransactions(itemId: string, input: unknown) {
      const parsed = validateSchema(sandboxTransactionsCreateSchema, input);
      const record = await getItemRecord(itemId);

      return runMutation({
        action: async () => {
          const result = await createSandboxTransactions(
            record.accessToken,
            parsed.transactions.map((transaction) => {
              return {
                amount: transaction.amount,
                date_posted: transaction.datePosted,
                date_transacted: transaction.dateTransacted,
                description: transaction.description,
                ...(transaction.isoCurrencyCode
                  ? { iso_currency_code: transaction.isoCurrencyCode }
                  : {}),
              } satisfies CustomSandboxTransaction;
            }),
            plaidClient,
          );

          return {
            item: makeSafeItem(record),
            requestId: result.request_id,
            summary: {
              createdTransactions: parsed.transactions.length,
            },
          };
        },
        control: parsed.control,
        metadata: {
          itemId,
          transactionCount: parsed.transactions.length,
        },
        operation: "sandbox_create_transactions",
        resourceId: itemId,
        scope: itemId,
        summary: {
          itemId,
          transactionCount: parsed.transactions.length,
        },
      });
    },

    async getHoldings(itemId: string) {
      const record = await getItemRecord(itemId);
      const holdings = await getHoldings(record.accessToken, plaidClient);

      return {
        accounts: holdings.accounts,
        holdings: holdings.holdings,
        item: makeSafeItem(record),
        securities: holdings.securities,
        summary: summarizeHoldings(holdings.holdings),
      };
    },

    async getInvestmentTransactions(itemId: string, input: unknown) {
      const parsed = validateSchema(investmentTransactionQuerySchema, input);
      const record = await getItemRecord(itemId);
      const investmentTransactions = await getInvestmentTransactions(
        {
          accessToken: record.accessToken,
          endDate: parsed.endDate,
          startDate: parsed.startDate,
          ...optionalFields({
            accountIds: parsed.accountIds,
          }),
        },
        plaidClient,
      );

      return {
        accounts: investmentTransactions.accounts,
        item: makeSafeItem(record),
        securities: investmentTransactions.securities,
        summary: summarizeInvestmentTransactions(investmentTransactions.investment_transactions),
        transactions: investmentTransactions.investment_transactions,
      };
    },

    async resetSandboxLogin(itemId: string, control: unknown) {
      const record = await getItemRecord(itemId);

      return runMutation({
        action: async () => {
          const result = await resetSandboxLogin(record.accessToken, plaidClient);

          return {
            item: makeSafeItem(record),
            requestId: result.request_id,
            summary: {
              resetLogin: result.reset_login,
            },
          };
        },
        control,
        metadata: {
          itemId,
        },
        operation: "sandbox_reset_login",
        resourceId: itemId,
        scope: itemId,
        summary: {
          itemId,
        },
      });
    },

    async fireSandboxItemWebhook(itemId: string, input: unknown) {
      const parsed = validateSchema(sandboxWebhookSchema, input);
      const record = await getItemRecord(itemId);

      return runMutation({
        action: async () => {
          const result = await fireSandboxItemWebhook(
            record.accessToken,
            parsed.webhookCode as SandboxItemFireWebhookRequestWebhookCodeEnum,
            parsed.webhookType as WebhookType | undefined,
            plaidClient,
          );

          return {
            item: makeSafeItem(record),
            requestId: result.request_id,
            summary: {
              webhookCode: parsed.webhookCode,
              webhookFired: result.webhook_fired,
            },
          };
        },
        control: parsed.control,
        metadata: {
          itemId,
          webhookCode: parsed.webhookCode,
        },
        operation: "sandbox_fire_item_webhook",
        resourceId: itemId,
        scope: itemId,
        summary: {
          itemId,
          webhookCode: parsed.webhookCode,
        },
      });
    },

    async getTransferConfiguration() {
      const configuration = await getTransferConfiguration(plaidClient);

      return {
        configuration,
        summary: {
          currency: configuration.iso_currency_code,
          maxDailyCreditAmount: configuration.max_daily_credit_amount,
          maxDailyDebitAmount: configuration.max_daily_debit_amount,
        },
      };
    },

    async getTransferBalance(input: unknown) {
      const parsed = validateSchema(transferBalanceQuerySchema, input);
      const balance = await getTransferBalance(
        parsed.type as TransferBalanceType | undefined,
        plaidClient,
      );

      return {
        balance: balance.balance,
        summary: {
          available: balance.balance.available,
          current: balance.balance.current ?? null,
          type: balance.balance.type,
        },
      };
    },

    async getTransferCapabilities(itemId: string, accountId: string) {
      const record = await getItemRecord(itemId);
      await getAccountForItem(itemId, accountId);
      const capabilities = await getTransferCapabilities(
        record.accessToken,
        accountId,
        plaidClient,
      );

      return {
        capabilities: capabilities.institution_supported_networks,
        item: makeSafeItem(record),
      };
    },

    async authorizeTransfer(itemId: string, accountId: string, input: unknown) {
      const parsed = validateSchema(transferAuthorizationSchema, input);
      const record = await getItemRecord(itemId);
      await getAccountForItem(itemId, accountId);

      return runMutation({
        action: async () => {
          const result = await authorizeTransfer(
            {
              access_token: record.accessToken,
              account_id: accountId,
              amount: parsed.amount,
              network: parsed.network as TransferNetwork,
              type: parsed.type as TransferType,
              user: toTransferUser(parsed.user),
              ...(parsed.achClass ? { ach_class: parsed.achClass as ACHClass } : {}),
              ...(parsed.device ? { device: toTransferDevice(parsed.device) } : {}),
              ...(parsed.requestGuarantee !== undefined
                ? { request_guarantee: parsed.requestGuarantee }
                : {}),
              ...(parsed.userPresent !== undefined ? { user_present: parsed.userPresent } : {}),
            },
            plaidClient,
          );

          return {
            authorization: result.authorization,
            item: makeSafeItem(record),
            summary: {
              amount: parsed.amount,
              decision: result.authorization.decision,
              network: parsed.network,
              type: parsed.type,
            },
          };
        },
        control: parsed.control,
        metadata: {
          accountId,
          itemId,
        },
        operation: "transfer_authorize",
        resourceId: itemId,
        scope: `${itemId}:${accountId}`,
        summary: {
          accountId,
          amount: parsed.amount,
          itemId,
        },
      });
    },

    async createTransfer(itemId: string, accountId: string, input: unknown) {
      const parsed = validateSchema(transferCreateSchema, input);
      const record = await getItemRecord(itemId);
      await getAccountForItem(itemId, accountId);

      return runMutation({
        action: async () => {
          const result = await createTransfer(
            {
              access_token: record.accessToken,
              account_id: accountId,
              authorization_id: parsed.authorizationId,
              description: parsed.description,
              ...optionalFields({
                amount: parsed.amount,
                metadata: parsed.metadata,
              }),
            },
            plaidClient,
          );

          return {
            item: makeSafeItem(record),
            summary: {
              amount: parsed.amount ?? null,
              authorizationId: parsed.authorizationId,
              description: parsed.description,
              transferId: result.transfer.id,
            },
            transfer: result.transfer,
          };
        },
        control: parsed.control,
        metadata: {
          accountId,
          authorizationId: parsed.authorizationId,
          itemId,
        },
        operation: "transfer_create",
        resourceId: itemId,
        scope: `${itemId}:${accountId}`,
        summary: {
          accountId,
          authorizationId: parsed.authorizationId,
          itemId,
        },
      });
    },

    async cancelTransfer(transferId: string, input: unknown) {
      const parsed = validateSchema(cancelTransferSchema, input);

      return runMutation({
        action: async () => {
          const result = await cancelTransfer(
            transferId,
            parsed.reasonCode as ReasonCode | undefined,
            plaidClient,
          );

          return {
            requestId: result.request_id,
            summary: {
              transferId,
            },
          };
        },
        control: parsed.control,
        metadata: {
          transferId,
        },
        operation: "transfer_cancel",
        resourceId: transferId,
        scope: transferId,
        summary: {
          transferId,
        },
      });
    },

    async getTransfer(identifier) {
      const transfer = await getTransfer(identifier, plaidClient);

      return {
        summary: {
          amount: transfer.transfer.amount,
          status: transfer.transfer.status,
          transferId: transfer.transfer.id,
        },
        transfer: transfer.transfer,
      };
    },

    async listTransfers(input: unknown) {
      const parsed = validateSchema(transferListSchema, input);
      const transfers = await listTransfers(
        optionalFields({
          count: parsed.count,
          endDate: parsed.endDate,
          fundingAccountId: parsed.fundingAccountId,
          offset: parsed.offset,
          startDate: parsed.startDate,
        }),
        plaidClient,
      );

      return {
        summary: {
          transferCount: transfers.transfers.length,
        },
        transfers: transfers.transfers,
      };
    },

    async createRecurringTransfer(itemId: string, accountId: string, input: unknown) {
      const parsed = validateSchema(recurringTransferSchema, input);
      const record = await getItemRecord(itemId);
      await getAccountForItem(itemId, accountId);

      return runMutation({
        action: async () => {
          const recurringDevice = parsed.device
            ? toRequiredTransferDevice(parsed.device)
            : undefined;

          if (parsed.device && !recurringDevice) {
            throw new ValidationError(
              "Recurring transfer device details require both ipAddress and userAgent.",
            );
          }

          const result = await createRecurringTransfer(
            {
              access_token: record.accessToken,
              account_id: accountId,
              amount: parsed.amount,
              description: parsed.description,
              idempotency_key: parsed.control.idempotencyKey,
              network: parsed.network as TransferRecurringNetwork,
              schedule: {
                interval_count: parsed.schedule.intervalCount,
                interval_execution_day: parsed.schedule.intervalExecutionDay,
                interval_unit: parsed.schedule.intervalUnit as TransferScheduleIntervalUnit,
                start_date: parsed.schedule.startDate,
              },
              type: parsed.type as TransferType,
              user: toTransferUser(parsed.user),
              ...(parsed.achClass ? { ach_class: parsed.achClass as ACHClass } : {}),
              ...(recurringDevice ? { device: recurringDevice } : {}),
              ...(parsed.testClockId ? { test_clock_id: parsed.testClockId } : {}),
              ...(parsed.userPresent !== undefined ? { user_present: parsed.userPresent } : {}),
            },
            plaidClient,
          );

          return {
            item: makeSafeItem(record),
            recurringTransfer: result.recurring_transfer ?? null,
            summary: {
              amount: parsed.amount,
              decision: result.decision,
              recurringTransferId: result.recurring_transfer?.recurring_transfer_id ?? null,
            },
          };
        },
        control: parsed.control,
        metadata: {
          accountId,
          itemId,
        },
        operation: "transfer_recurring_create",
        resourceId: itemId,
        scope: `${itemId}:${accountId}`,
        summary: {
          accountId,
          itemId,
        },
      });
    },

    async cancelRecurringTransfer(recurringTransferId: string, control: unknown) {
      return runMutation({
        action: async () => {
          const result = await cancelRecurringTransfer(recurringTransferId, plaidClient);

          return {
            requestId: result.request_id,
            summary: {
              recurringTransferId,
            },
          };
        },
        control,
        metadata: {
          recurringTransferId,
        },
        operation: "transfer_recurring_cancel",
        resourceId: recurringTransferId,
        scope: recurringTransferId,
        summary: {
          recurringTransferId,
        },
      });
    },

    async listRecurringTransfers(input: unknown) {
      const parsed = validateSchema(recurringTransferListSchema, input);
      const recurringTransfers = await listRecurringTransfers(
        optionalFields({
          count: parsed.count,
          endTime: parsed.endTime,
          fundingAccountId: parsed.fundingAccountId,
          offset: parsed.offset,
          startTime: parsed.startTime,
        }),
        plaidClient,
      );

      return {
        recurringTransfers: recurringTransfers.recurring_transfers,
        summary: {
          recurringTransferCount: recurringTransfers.recurring_transfers.length,
        },
      };
    },

    getConfig() {
      return {
        sandboxOnly: true,
        summary: {
          requireMutationApproval: runtimeConfig.requireMutationApproval,
        },
        supportedMutations: [
          "sandbox_link_item",
          "transactions_sync",
          "transactions_refresh",
          "sandbox_create_transactions",
          "sandbox_reset_login",
          "sandbox_fire_item_webhook",
          "transfer_authorize",
          "transfer_create",
          "transfer_cancel",
          "transfer_recurring_create",
          "transfer_recurring_cancel",
        ],
      };
    },
  };
}

function toTransferUser(
  input: TransferAuthorizationInput["user"] | RecurringTransferInput["user"],
) {
  const address = input.address
    ? optionalFields({
        ...(input.address.city ? { city: input.address.city } : {}),
        ...(input.address.country ? { country: input.address.country } : {}),
        ...(input.address.postalCode ? { postal_code: input.address.postalCode } : {}),
        ...(input.address.region ? { region: input.address.region } : {}),
        ...(input.address.street ? { street: input.address.street } : {}),
      })
    : undefined;

  return {
    legal_name: input.legalName,
    ...optionalFields({
      ...(address ? { address } : {}),
      email_address: input.emailAddress,
      phone_number: input.phoneNumber,
    }),
  };
}

function toTransferDevice(
  input: NonNullable<TransferAuthorizationInput["device"] | RecurringTransferInput["device"]>,
) {
  return {
    ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
    ...(input.userAgent ? { user_agent: input.userAgent } : {}),
  };
}

function toRequiredTransferDevice(
  input: NonNullable<RecurringTransferInput["device"]>,
): { readonly ip_address: string; readonly user_agent: string } | undefined {
  if (!input.ipAddress || !input.userAgent) {
    return undefined;
  }

  return {
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
  };
}

function summarizeAccounts(accounts: readonly AccountBase[]): JsonObject {
  const byType: Record<string, number> = {};

  for (const account of accounts) {
    byType[account.type] = (byType[account.type] ?? 0) + 1;
  }

  return {
    accountCount: accounts.length,
    byType,
  };
}

function summarizeBalances(accounts: readonly AccountBase[]): JsonObject {
  let totalCurrent = 0;
  let totalAvailable = 0;

  for (const account of accounts) {
    totalCurrent += account.balances.current ?? 0;
    totalAvailable += account.balances.available ?? 0;
  }

  return {
    accountCount: accounts.length,
    totalAvailable,
    totalCurrent,
  };
}

function summarizeTransactions(
  transactions: readonly {
    readonly amount: number;
    readonly date: string;
    readonly pending: boolean;
  }[],
): JsonObject {
  let inflows = 0;
  let outflows = 0;
  let pendingCount = 0;
  let earliestDate: string | null = null;
  let latestDate: string | null = null;

  for (const transaction of transactions) {
    if (transaction.amount < 0) {
      inflows += Math.abs(transaction.amount);
    } else {
      outflows += transaction.amount;
    }

    if (transaction.pending) {
      pendingCount += 1;
    }

    earliestDate =
      earliestDate === null || transaction.date < (earliestDate as string)
        ? transaction.date
        : earliestDate;
    latestDate =
      latestDate === null || transaction.date > (latestDate as string)
        ? transaction.date
        : latestDate;
  }

  return {
    earliestDate,
    inflows,
    latestDate,
    net: inflows - outflows,
    outflows,
    pendingCount,
    transactionCount: transactions.length,
  };
}

function summarizeHoldings(
  holdings: readonly {
    readonly institution_value?: number | null;
  }[],
): JsonObject {
  const totalMarketValue = holdings.reduce((sum, holding) => {
    return sum + (holding.institution_value ?? 0);
  }, 0);

  return {
    holdingsCount: holdings.length,
    totalMarketValue,
  };
}

function summarizeInvestmentTransactions(
  transactions: readonly {
    readonly amount: number;
    readonly date: string;
  }[],
): JsonObject {
  const summary = summarizeTransactions(
    transactions.map((transaction) => {
      return {
        amount: transaction.amount,
        date: transaction.date,
        pending: false,
      };
    }),
  );

  return {
    ...summary,
    investmentTransactionCount: transactions.length,
  };
}

export function getWealthServiceStatus(service: WealthService): Result<Record<string, unknown>> {
  return {
    ok: true,
    value: service.getConfig(),
  };
}
