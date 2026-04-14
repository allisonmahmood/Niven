import { randomUUID } from "node:crypto";

import {
  ApprovalRequiredError,
  ConflictError,
  isRecord,
  NotFoundError,
  ValidationError,
} from "@niven/shared";

import { SandboxAuditLogger } from "./audit.js";
import { readSandboxRuntimeConfig } from "./config.js";
import {
  formatMoney,
  formatPrice,
  formatQuantity,
  multiplyPriceByQuantity,
  parseMoney,
  parseQuantity,
} from "./numbers.js";
import { LocalSandboxStore } from "./store.js";
import type {
  MutationControlInput,
  SandboxAccountRecord,
  SandboxOrderRecord,
  SandboxRuntimeConfig,
  SandboxSecurityRecord,
  SandboxState,
  SandboxTransferRecord,
} from "./types.js";

export interface SandboxService {
  depositCash(input: unknown): Promise<Record<string, unknown>>;
  getConfig(): Promise<Record<string, unknown>>;
  getAccount(accountId: string): Promise<Record<string, unknown>>;
  getOrder(orderId: string): Promise<Record<string, unknown>>;
  getTransfer(transferId: string): Promise<Record<string, unknown>>;
  listAccountActivity(accountId: string, input: unknown): Promise<Record<string, unknown>>;
  listAccounts(): Promise<Record<string, unknown>>;
  listHoldings(input: unknown): Promise<Record<string, unknown>>;
  listOrders(input: unknown): Promise<Record<string, unknown>>;
  listSecurities(input: unknown): Promise<Record<string, unknown>>;
  listTransfers(input: unknown): Promise<Record<string, unknown>>;
  submitTrade(input: unknown): Promise<Record<string, unknown>>;
  transferCash(input: unknown): Promise<Record<string, unknown>>;
}

export interface CreateSandboxServiceOptions {
  readonly auditLogger?: SandboxAuditLogger;
  readonly clock?: () => string;
  readonly runtimeConfig?: SandboxRuntimeConfig;
  readonly store?: LocalSandboxStore;
}

function idempotencyStorageKey(operation: string, scope: string, idempotencyKey: string): string {
  return `${operation}:${scope}:${idempotencyKey}`;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function readObject(input: unknown, message: string): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ValidationError(message);
  }

  return input;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Invalid ${key}.`);
  }

  return value.trim();
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);

  if (!value) {
    throw new ValidationError(`${key} is required.`);
  }

  return value;
}

function readOptionalInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`Invalid ${key}.`);
  }

  return value;
}

function readMutationControl(record: Record<string, unknown>): MutationControlInput {
  const rawControl = readObject(record.control, "control is required.");
  const idempotencyKey = readRequiredString(rawControl, "idempotencyKey");
  const approval = rawControl.approval;

  let parsedApproval: MutationControlInput["approval"];
  if (approval !== undefined) {
    const approvalRecord = readObject(approval, "approval must be an object.");
    parsedApproval = {
      ...(typeof approvalRecord.approved === "boolean"
        ? { approved: approvalRecord.approved }
        : {}),
      ...(typeof approvalRecord.approvedBy === "string"
        ? { approvedBy: approvalRecord.approvedBy }
        : {}),
      ...(typeof approvalRecord.rationale === "string"
        ? { rationale: approvalRecord.rationale }
        : {}),
    };
  }

  return {
    ...(parsedApproval ? { approval: parsedApproval } : {}),
    ...(typeof rawControl.dryRun === "boolean" ? { dryRun: rawControl.dryRun } : {}),
    idempotencyKey,
  };
}

function readRequiredDate(record: Record<string, unknown>, key: string): string {
  const value = readRequiredString(record, key);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Invalid ${key}.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`Invalid ${key}.`);
  }

  return value;
}

function readLimit(input: unknown): number | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const limit = readOptionalInteger(input, "limit");
  return limit === undefined ? undefined : Math.max(1, limit);
}

function readCurrentBalanceMicros(
  state: SandboxState,
  account: SandboxAccountRecord,
): bigint | null {
  if (account.cashBalanceMicros !== null) {
    const cashBalance = BigInt(account.cashBalanceMicros);

    if (account.category !== "investment") {
      return cashBalance;
    }

    const positionsValue = Object.values(state.positions)
      .filter((position) => position.accountId === account.accountId)
      .reduce((total, position) => {
        const security = state.securities[position.securityId];

        if (!security) {
          return total;
        }

        return (
          total +
          multiplyPriceByQuantity(BigInt(security.priceMicros), BigInt(position.quantityAtoms))
        );
      }, 0n);

    return cashBalance + positionsValue;
  }

  if (account.staticCurrentBalanceMicros !== null) {
    return BigInt(account.staticCurrentBalanceMicros);
  }

  return null;
}

function readAvailableBalanceMicros(account: SandboxAccountRecord): bigint | null {
  if (account.availableCashMicros !== null) {
    return BigInt(account.availableCashMicros);
  }

  if (account.staticAvailableBalanceMicros !== null) {
    return BigInt(account.staticAvailableBalanceMicros);
  }

  return null;
}

function getAccountOrThrow(state: SandboxState, accountId: string): SandboxAccountRecord {
  const account = state.accounts[accountId];

  if (!account) {
    throw new NotFoundError(`Sandbox account ${accountId} was not found.`);
  }

  return account;
}

function getSecurityOrThrow(state: SandboxState, securityId: string): SandboxSecurityRecord {
  const security = state.securities[securityId];

  if (!security) {
    throw new NotFoundError(`Sandbox security ${securityId} was not found.`);
  }

  return security;
}

function getPosition(state: SandboxState, accountId: string, securityId: string) {
  return state.positions[`${accountId}:${securityId}`];
}

function toPublicAccount(state: SandboxState, account: SandboxAccountRecord) {
  const currentBalance = readCurrentBalanceMicros(state, account);
  const availableBalance = readAvailableBalanceMicros(account);

  return {
    accountId: account.accountId,
    availableBalance: availableBalance === null ? null : formatMoney(availableBalance),
    cashBalance:
      account.cashBalanceMicros === null ? null : formatMoney(BigInt(account.cashBalanceMicros)),
    category: account.category,
    creditLimit:
      account.creditLimitMicros === null ? null : formatMoney(BigInt(account.creditLimitMicros)),
    currentBalance: currentBalance === null ? null : formatMoney(currentBalance),
    currencyCode: account.currencyCode,
    holderCategory: account.holderCategory,
    mask: account.mask,
    name: account.name,
    officialName: account.officialName,
    permissions: account.permissions,
    sourceLabel: account.sourceLabel,
    subtype: account.subtype,
    type: account.type,
  };
}

function toPublicSecurity(security: SandboxSecurityRecord, state: SandboxState) {
  const heldPositionCount = Object.values(state.positions).filter((position) => {
    return position.securityId === security.securityId;
  }).length;

  return {
    heldPositionCount,
    name: security.name,
    priceAsOf: security.priceAsOf,
    securityId: security.securityId,
    symbol: security.symbol,
    type: security.type,
    marketPrice: formatPrice(BigInt(security.priceMicros)),
    subtype: security.subtype,
  };
}

function toPublicHolding(state: SandboxState, position: SandboxState["positions"][string]) {
  const account = getAccountOrThrow(state, position.accountId);
  const security = getSecurityOrThrow(state, position.securityId);
  const quantityAtoms = BigInt(position.quantityAtoms);
  const priceMicros = BigInt(security.priceMicros);
  const marketValueMicros = multiplyPriceByQuantity(priceMicros, quantityAtoms);
  const costBasisMicros = BigInt(position.costBasisMicros);

  return {
    accountId: account.accountId,
    accountName: account.name,
    costBasis: formatMoney(costBasisMicros),
    marketPrice: formatPrice(priceMicros),
    marketValue: formatMoney(marketValueMicros),
    quantity: formatQuantity(quantityAtoms),
    securityId: security.securityId,
    symbol: security.symbol,
    name: security.name,
    type: security.type,
    subtype: security.subtype,
    unrealizedGainLoss: formatMoney(marketValueMicros - costBasisMicros),
  };
}

function ensureTransferableAccount(account: SandboxAccountRecord): void {
  if (!account.permissions.canTransfer || account.cashBalanceMicros === null) {
    throw new ConflictError(`Account ${account.name} does not support internal cash transfers.`);
  }
}

function ensureDepositableCashAccount(account: SandboxAccountRecord): void {
  if (
    account.category !== "cash" ||
    account.cashBalanceMicros === null ||
    account.availableCashMicros === null
  ) {
    throw new ConflictError(`Account ${account.name} does not support cash deposits.`);
  }
}

function ensureTradableAccount(account: SandboxAccountRecord): void {
  if (!account.permissions.canTrade || account.cashBalanceMicros === null) {
    throw new ConflictError(`Account ${account.name} does not support trading.`);
  }
}

function assertStateConsistency(state: SandboxState): void {
  for (const account of Object.values(state.accounts)) {
    if (account.cashBalanceMicros !== null && BigInt(account.cashBalanceMicros) < 0n) {
      throw new Error(`Account ${account.accountId} has a negative cash balance.`);
    }

    if (account.availableCashMicros !== null && BigInt(account.availableCashMicros) < 0n) {
      throw new Error(`Account ${account.accountId} has a negative available cash balance.`);
    }
  }

  for (const position of Object.values(state.positions)) {
    if (!state.accounts[position.accountId]) {
      throw new Error(`Position ${position.positionId} references a missing account.`);
    }

    if (!state.securities[position.securityId]) {
      throw new Error(`Position ${position.positionId} references a missing security.`);
    }

    if (BigInt(position.quantityAtoms) <= 0n) {
      throw new Error(`Position ${position.positionId} has a non-positive quantity.`);
    }

    if (BigInt(position.costBasisMicros) < 0n) {
      throw new Error(`Position ${position.positionId} has a negative cost basis.`);
    }
  }
}

export function createSandboxService(options: CreateSandboxServiceOptions = {}): SandboxService {
  const runtimeConfig = options.runtimeConfig ?? readSandboxRuntimeConfig();
  const store = options.store ?? new LocalSandboxStore(runtimeConfig.statePath);
  const auditLogger = options.auditLogger ?? new SandboxAuditLogger(runtimeConfig.auditPath);
  const now = options.clock ?? (() => new Date().toISOString());

  async function runMutation(params: {
    readonly buildPreview: (state: SandboxState) => Record<string, unknown>;
    readonly buildSuccessAuditResult: (
      response: Record<string, unknown>,
    ) => Record<string, unknown>;
    readonly execute: (
      state: SandboxState,
      approvalRationale: string | null,
      timestamp: string,
    ) => Record<string, unknown>;
    readonly input: MutationControlInput;
    readonly metadata: Record<string, unknown>;
    readonly operation: string;
    readonly scope: string;
  }): Promise<Record<string, unknown>> {
    const timestamp = now();
    const approvalSatisfied =
      !runtimeConfig.requireMutationApproval || params.input.approval?.approved === true;

    if (!approvalSatisfied) {
      await auditLogger.record({
        action: params.operation,
        idempotencyKey: params.input.idempotencyKey,
        metadata: params.metadata,
        result: {
          approvalRequired: true,
        },
        status: "blocked",
        timestamp,
      });
      throw new ApprovalRequiredError();
    }

    if (params.input.dryRun) {
      const preview = params.buildPreview(await store.readState());
      await auditLogger.record({
        action: params.operation,
        idempotencyKey: params.input.idempotencyKey,
        metadata: params.metadata,
        result: preview,
        status: "dry_run",
        timestamp,
      });

      return {
        ...preview,
        idempotencyKey: params.input.idempotencyKey,
        mode: "dry_run",
      };
    }

    const idempotencyKey = idempotencyStorageKey(
      params.operation,
      params.scope,
      params.input.idempotencyKey,
    );

    const response = await store.mutate(async (state) => {
      const cached = state.idempotency[idempotencyKey];

      if (cached) {
        return {
          ...(cached.response as Record<string, unknown>),
          replayed: true,
        };
      }

      const result = params.execute(state, params.input.approval?.rationale ?? null, timestamp);
      assertStateConsistency(state);
      const liveResponse = {
        ...result,
        idempotencyKey: params.input.idempotencyKey,
        mode: "live",
      };
      state.idempotency[idempotencyKey] = {
        createdAt: timestamp,
        operation: params.operation,
        response: liveResponse,
        scope: params.scope,
      };

      return liveResponse;
    });

    const replayed = isRecord(response) && (response as Record<string, unknown>).replayed === true;

    await auditLogger.record({
      action: params.operation,
      idempotencyKey: params.input.idempotencyKey,
      metadata: params.metadata,
      result: params.buildSuccessAuditResult(response),
      status: replayed ? "idempotent_replay" : "succeeded",
      timestamp,
    });

    return response;
  }

  return {
    async depositCash(input) {
      const record = readObject(input, "Deposit input must be an object.");
      const control = readMutationControl(record);
      const accountId = readRequiredString(record, "accountId");
      const amountMicros = parseMoney(readRequiredString(record, "amount"));
      const date = readRequiredDate(record, "date");
      const description = readOptionalString(record, "description") ?? "Payday";

      if (amountMicros <= 0n) {
        throw new ValidationError("amount must be greater than zero.");
      }

      return runMutation({
        buildPreview: (state) => {
          const account = getAccountOrThrow(state, accountId);
          ensureDepositableCashAccount(account);
          const currentBalance = BigInt(account.cashBalanceMicros ?? "0");
          const availableBalance = BigInt(
            account.availableCashMicros ?? account.cashBalanceMicros ?? "0",
          );

          return {
            preview: {
              account: toPublicAccount(state, account),
              amount: formatMoney(amountMicros),
              date,
              description,
              resultingAvailableBalance: formatMoney(availableBalance + amountMicros),
              resultingCurrentBalance: formatMoney(currentBalance + amountMicros),
            },
            summary: {
              accountId,
              amount: formatMoney(amountMicros),
              date,
            },
          };
        },
        buildSuccessAuditResult: (response) =>
          readObject(response.deposit, "deposit response missing."),
        execute: (state, _approvalRationale, timestamp) => {
          const account = getAccountOrThrow(state, accountId);
          ensureDepositableCashAccount(account);

          const currentBalance = BigInt(account.cashBalanceMicros ?? "0");
          const availableBalance = BigInt(
            account.availableCashMicros ?? account.cashBalanceMicros ?? "0",
          );
          account.cashBalanceMicros = (currentBalance + amountMicros).toString();
          account.availableCashMicros = (availableBalance + amountMicros).toString();

          const transactionId = randomUUID();
          state.importedTransactions[transactionId] = {
            accountId,
            amountMicros: (-amountMicros).toString(),
            date,
            importedAt: timestamp,
            merchantName: null,
            name: description,
            pending: false,
            plaidTransactionId: `local_cash_deposit_${transactionId}`,
            sourceLabel: "local_cash_deposit",
            transactionId,
          };

          return {
            deposit: {
              accountId,
              amount: formatMoney(amountMicros),
              createdAt: timestamp,
              date,
              description,
              transactionId,
            },
            summary: {
              accountId,
              amount: formatMoney(amountMicros),
              date,
              transactionId,
            },
          };
        },
        input: control,
        metadata: {
          accountId,
          amount: formatMoney(amountMicros),
          date,
        },
        operation: "cash_deposit",
        scope: accountId,
      });
    },

    async getConfig() {
      const state = await store.readState();

      return {
        approvalRequired: runtimeConfig.requireMutationApproval,
        mode: "wealth_sandbox",
        sandboxOnly: true,
        snapshot: state.snapshot,
        summary: {
          accountCount: Object.keys(state.accounts).length,
          orderCount: Object.keys(state.orders).length,
          securityCount: Object.keys(state.securities).length,
          transferCount: Object.keys(state.transfers).length,
        },
      };
    },

    async listAccounts() {
      const state = await store.readState();
      const accounts = Object.values(state.accounts)
        .map((account) => toPublicAccount(state, account))
        .sort((left, right) => left.name.localeCompare(right.name));

      return {
        accounts,
        summary: {
          accountCount: accounts.length,
          cashTransferEligibleCount: accounts.filter((account) => account.permissions.canTransfer)
            .length,
          tradeEligibleCount: accounts.filter((account) => account.permissions.canTrade).length,
        },
      };
    },

    async getAccount(accountId) {
      const state = await store.readState();
      const account = getAccountOrThrow(state, accountId);
      const holdings = Object.values(state.positions)
        .filter((position) => position.accountId === accountId)
        .map((position) => toPublicHolding(state, position));

      return {
        account: toPublicAccount(state, account),
        holdings,
        summary: {
          holdingCount: holdings.length,
        },
      };
    },

    async listAccountActivity(accountId, input) {
      const state = await store.readState();
      const account = getAccountOrThrow(state, accountId);
      const limit = readLimit(input) ?? 50;

      const importedTransactions = Object.values(state.importedTransactions)
        .filter((transaction) => transaction.accountId === accountId)
        .map((transaction) => {
          const isLocalCashDeposit = transaction.sourceLabel === "local_cash_deposit";
          const amountMicros = BigInt(transaction.amountMicros);

          return {
            activityId: transaction.transactionId,
            activityType: isLocalCashDeposit ? "cash_deposit_in" : "imported_transaction",
            amount: formatMoney(isLocalCashDeposit ? -amountMicros : amountMicros),
            date: transaction.date,
            description: transaction.name,
            merchantName: transaction.merchantName,
            sourceLabel: transaction.sourceLabel,
          };
        });
      const transfers = Object.values(state.transfers).flatMap((transfer) => {
        if (transfer.fromAccountId === accountId) {
          return [
            {
              activityId: transfer.transferId,
              activityType: "cash_transfer_out",
              amount: formatMoney(-BigInt(transfer.amountMicros)),
              date: transfer.createdAt,
              description: transfer.description,
            },
          ];
        }

        if (transfer.toAccountId === accountId) {
          return [
            {
              activityId: transfer.transferId,
              activityType: "cash_transfer_in",
              amount: formatMoney(BigInt(transfer.amountMicros)),
              date: transfer.createdAt,
              description: transfer.description,
            },
          ];
        }

        return [];
      });
      const orders = Object.values(state.orders)
        .filter((order) => order.accountId === accountId)
        .map((order) => {
          const security = getSecurityOrThrow(state, order.securityId);
          const amount = BigInt(order.grossAmountMicros);

          return {
            activityId: order.orderId,
            activityType: order.side === "buy" ? "trade_buy" : "trade_sell",
            amount: formatMoney(order.side === "buy" ? -amount : amount),
            date: order.createdAt,
            description: security.symbol ?? security.name,
            quantity: formatQuantity(BigInt(order.quantityAtoms)),
          };
        });

      const activities = [...importedTransactions, ...transfers, ...orders]
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, limit);

      return {
        account: toPublicAccount(state, account),
        activities,
        summary: {
          activityCount: activities.length,
        },
      };
    },

    async listHoldings(input) {
      const query = isRecord(input) ? input : {};
      const accountId = readOptionalString(query, "accountId");
      const limit = readLimit(query) ?? 100;
      const state = await store.readState();
      const holdings = Object.values(state.positions)
        .filter((position) => (accountId ? position.accountId === accountId : true))
        .map((position) => toPublicHolding(state, position))
        .sort(
          (left, right) =>
            Number.parseFloat(right.marketValue) - Number.parseFloat(left.marketValue),
        )
        .slice(0, limit);
      const totalMarketValueMicros = holdings.reduce(
        (total, holding) => total + parseMoney(holding.marketValue),
        0n,
      );

      return {
        holdings,
        summary: {
          holdingCount: holdings.length,
          totalMarketValue: formatMoney(totalMarketValueMicros),
        },
      };
    },

    async listSecurities(input) {
      const query = isRecord(input) ? input : {};
      const rawSearch = readOptionalString(query, "query");
      const normalizedSearch = rawSearch ? normalizeQuery(rawSearch) : null;
      const limit = readLimit(query) ?? 100;
      const state = await store.readState();
      const securities = Object.values(state.securities)
        .filter((security) => {
          if (!normalizedSearch) {
            return true;
          }

          return [security.name, security.symbol ?? "", security.type ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch);
        })
        .map((security) => toPublicSecurity(security, state))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit);

      return {
        securities,
        summary: {
          securityCount: securities.length,
        },
      };
    },

    async transferCash(input) {
      const record = readObject(input, "Transfer input must be an object.");
      const control = readMutationControl(record);
      const fromAccountId = readRequiredString(record, "fromAccountId");
      const toAccountId = readRequiredString(record, "toAccountId");
      const amountMicros = parseMoney(readRequiredString(record, "amount"));
      const description = readOptionalString(record, "description") ?? null;

      if (amountMicros <= 0n) {
        throw new ValidationError("amount must be greater than zero.");
      }

      if (fromAccountId === toAccountId) {
        throw new ValidationError("fromAccountId and toAccountId must differ.");
      }

      return runMutation({
        buildPreview: (state) => {
          const fromAccount = getAccountOrThrow(state, fromAccountId);
          const toAccount = getAccountOrThrow(state, toAccountId);
          ensureTransferableAccount(fromAccount);
          ensureTransferableAccount(toAccount);
          const fromAvailable = readAvailableBalanceMicros(fromAccount);

          if (fromAvailable === null || fromAvailable < amountMicros) {
            throw new ConflictError(
              `Account ${fromAccount.name} does not have enough available cash.`,
            );
          }

          return {
            preview: {
              amount: formatMoney(amountMicros),
              description,
              fromAccount: toPublicAccount(state, fromAccount),
              resultingFromAvailableBalance: formatMoney(fromAvailable - amountMicros),
              resultingFromCurrentBalance: formatMoney(
                (readCurrentBalanceMicros(state, fromAccount) ?? 0n) - amountMicros,
              ),
              resultingToAvailableBalance: formatMoney(
                (readAvailableBalanceMicros(toAccount) ?? 0n) + amountMicros,
              ),
              resultingToCurrentBalance: formatMoney(
                (readCurrentBalanceMicros(state, toAccount) ?? 0n) + amountMicros,
              ),
              toAccount: toPublicAccount(state, toAccount),
            },
            summary: {
              amount: formatMoney(amountMicros),
              fromAccountId,
              toAccountId,
            },
          };
        },
        buildSuccessAuditResult: (response) =>
          readObject(response.transfer, "transfer response missing."),
        execute: (state, approvalRationale, timestamp) => {
          const fromAccount = getAccountOrThrow(state, fromAccountId);
          const toAccount = getAccountOrThrow(state, toAccountId);
          ensureTransferableAccount(fromAccount);
          ensureTransferableAccount(toAccount);

          const fromCurrent = BigInt(fromAccount.cashBalanceMicros ?? "0");
          const fromAvailable = BigInt(
            fromAccount.availableCashMicros ?? fromAccount.cashBalanceMicros ?? "0",
          );

          if (fromAvailable < amountMicros) {
            throw new ConflictError(
              `Account ${fromAccount.name} does not have enough available cash.`,
            );
          }

          fromAccount.cashBalanceMicros = (fromCurrent - amountMicros).toString();
          fromAccount.availableCashMicros = (fromAvailable - amountMicros).toString();

          const toCurrent = BigInt(toAccount.cashBalanceMicros ?? "0");
          const toAvailable = BigInt(
            toAccount.availableCashMicros ?? toAccount.cashBalanceMicros ?? "0",
          );
          toAccount.cashBalanceMicros = (toCurrent + amountMicros).toString();
          toAccount.availableCashMicros = (toAvailable + amountMicros).toString();

          const transfer: SandboxTransferRecord = {
            amountMicros: amountMicros.toString(),
            approvalRationale,
            createdAt: timestamp,
            description,
            fromAccountId,
            idempotencyKey: control.idempotencyKey,
            toAccountId,
            transferId: randomUUID(),
          };
          state.transfers[transfer.transferId] = transfer;
          state.events.push({
            accountIds: [fromAccountId, toAccountId],
            createdAt: timestamp,
            entityId: transfer.transferId,
            eventId: randomUUID(),
            payload: {
              amount: formatMoney(amountMicros),
              fromAccountId,
              toAccountId,
            },
            type: "transfer_executed",
          });

          return {
            summary: {
              amount: formatMoney(amountMicros),
              fromAccountId,
              toAccountId,
              transferId: transfer.transferId,
            },
            transfer: {
              amount: formatMoney(amountMicros),
              createdAt: transfer.createdAt,
              description: transfer.description,
              fromAccountId,
              toAccountId,
              transferId: transfer.transferId,
            },
          };
        },
        input: control,
        metadata: {
          amount: formatMoney(amountMicros),
          fromAccountId,
          toAccountId,
        },
        operation: "internal_transfer",
        scope: `${fromAccountId}:${toAccountId}`,
      });
    },

    async listTransfers(input) {
      const limit = readLimit(input) ?? 100;
      const state = await store.readState();
      const transfers = Object.values(state.transfers)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map((transfer) => {
          return {
            amount: formatMoney(BigInt(transfer.amountMicros)),
            createdAt: transfer.createdAt,
            description: transfer.description,
            fromAccountId: transfer.fromAccountId,
            toAccountId: transfer.toAccountId,
            transferId: transfer.transferId,
          };
        });

      return {
        summary: {
          transferCount: transfers.length,
        },
        transfers,
      };
    },

    async getTransfer(transferId) {
      const state = await store.readState();
      const transfer = state.transfers[transferId];

      if (!transfer) {
        throw new NotFoundError(`Sandbox transfer ${transferId} was not found.`);
      }

      return {
        summary: {
          amount: formatMoney(BigInt(transfer.amountMicros)),
          transferId,
        },
        transfer: {
          amount: formatMoney(BigInt(transfer.amountMicros)),
          createdAt: transfer.createdAt,
          description: transfer.description,
          fromAccountId: transfer.fromAccountId,
          toAccountId: transfer.toAccountId,
          transferId: transfer.transferId,
        },
      };
    },

    async submitTrade(input) {
      const record = readObject(input, "Trade input must be an object.");
      const control = readMutationControl(record);
      const accountId = readRequiredString(record, "accountId");
      const securityId = readRequiredString(record, "securityId");
      const quantityAtoms = parseQuantity(readRequiredString(record, "quantity"));
      const side = readRequiredString(record, "side");

      if (quantityAtoms <= 0n) {
        throw new ValidationError("quantity must be greater than zero.");
      }

      if (side !== "buy" && side !== "sell") {
        throw new ValidationError("side must be buy or sell.");
      }

      return runMutation({
        buildPreview: (state) => {
          const account = getAccountOrThrow(state, accountId);
          const security = getSecurityOrThrow(state, securityId);
          ensureTradableAccount(account);
          const priceMicros = BigInt(security.priceMicros);

          if (priceMicros <= 0n) {
            throw new ConflictError(
              `Security ${security.name} does not have a usable market price.`,
            );
          }

          const grossAmountMicros = multiplyPriceByQuantity(priceMicros, quantityAtoms);

          if (side === "buy") {
            const availableCash = BigInt(
              account.availableCashMicros ?? account.cashBalanceMicros ?? "0",
            );

            if (availableCash < grossAmountMicros) {
              throw new ConflictError(
                `Account ${account.name} does not have enough cash to buy ${security.name}.`,
              );
            }
          } else {
            const position = getPosition(state, accountId, securityId);

            if (!position || BigInt(position.quantityAtoms) < quantityAtoms) {
              throw new ConflictError(
                `Account ${account.name} does not hold enough ${security.name} to sell.`,
              );
            }
          }

          const currentCash = BigInt(account.cashBalanceMicros ?? "0");
          const resultingCash =
            side === "buy" ? currentCash - grossAmountMicros : currentCash + grossAmountMicros;

          return {
            preview: {
              account: toPublicAccount(state, account),
              grossAmount: formatMoney(grossAmountMicros),
              marketPrice: formatPrice(priceMicros),
              quantity: formatQuantity(quantityAtoms),
              resultingCashBalance: formatMoney(resultingCash),
              security: toPublicSecurity(security, state),
              side,
            },
            summary: {
              accountId,
              grossAmount: formatMoney(grossAmountMicros),
              securityId,
              side,
            },
          };
        },
        buildSuccessAuditResult: (response) =>
          readObject(response.order, "order response missing."),
        execute: (state, approvalRationale, timestamp) => {
          const account = getAccountOrThrow(state, accountId);
          const security = getSecurityOrThrow(state, securityId);
          ensureTradableAccount(account);
          const priceMicros = BigInt(security.priceMicros);

          if (priceMicros <= 0n) {
            throw new ConflictError(
              `Security ${security.name} does not have a usable market price.`,
            );
          }

          const grossAmountMicros = multiplyPriceByQuantity(priceMicros, quantityAtoms);
          const currentCash = BigInt(account.cashBalanceMicros ?? "0");
          const availableCash = BigInt(
            account.availableCashMicros ?? account.cashBalanceMicros ?? "0",
          );
          const existingPosition = getPosition(state, accountId, securityId);

          if (side === "buy") {
            if (availableCash < grossAmountMicros) {
              throw new ConflictError(
                `Account ${account.name} does not have enough cash to buy ${security.name}.`,
              );
            }

            account.cashBalanceMicros = (currentCash - grossAmountMicros).toString();
            account.availableCashMicros = (availableCash - grossAmountMicros).toString();

            if (existingPosition) {
              existingPosition.quantityAtoms = (
                BigInt(existingPosition.quantityAtoms) + quantityAtoms
              ).toString();
              existingPosition.costBasisMicros = (
                BigInt(existingPosition.costBasisMicros) + grossAmountMicros
              ).toString();
              existingPosition.updatedAt = timestamp;
            } else {
              state.positions[`${accountId}:${securityId}`] = {
                accountId,
                costBasisMicros: grossAmountMicros.toString(),
                createdAt: timestamp,
                positionId: `${accountId}:${securityId}`,
                quantityAtoms: quantityAtoms.toString(),
                securityId,
                updatedAt: timestamp,
              };
            }
          } else {
            if (!existingPosition) {
              throw new ConflictError(`Account ${account.name} does not hold ${security.name}.`);
            }

            const existingQuantity = BigInt(existingPosition.quantityAtoms);

            if (existingQuantity < quantityAtoms) {
              throw new ConflictError(
                `Account ${account.name} does not hold enough ${security.name} to sell.`,
              );
            }

            const existingCostBasis = BigInt(existingPosition.costBasisMicros);
            const remainingQuantity = existingQuantity - quantityAtoms;
            const proportionalCostBasis =
              quantityAtoms === existingQuantity
                ? existingCostBasis
                : (existingCostBasis * quantityAtoms) / existingQuantity;

            account.cashBalanceMicros = (currentCash + grossAmountMicros).toString();
            account.availableCashMicros = (availableCash + grossAmountMicros).toString();

            if (remainingQuantity === 0n) {
              delete state.positions[existingPosition.positionId];
            } else {
              existingPosition.quantityAtoms = remainingQuantity.toString();
              existingPosition.costBasisMicros = (
                existingCostBasis - proportionalCostBasis
              ).toString();
              existingPosition.updatedAt = timestamp;
            }
          }

          const order: SandboxOrderRecord = {
            accountId,
            approvalRationale,
            createdAt: timestamp,
            grossAmountMicros: grossAmountMicros.toString(),
            idempotencyKey: control.idempotencyKey,
            orderId: randomUUID(),
            priceMicros: priceMicros.toString(),
            quantityAtoms: quantityAtoms.toString(),
            securityId,
            side,
          };
          state.orders[order.orderId] = order;
          state.events.push({
            accountIds: [accountId],
            createdAt: timestamp,
            entityId: order.orderId,
            eventId: randomUUID(),
            payload: {
              accountId,
              grossAmount: formatMoney(grossAmountMicros),
              securityId,
              side,
            },
            type: "order_executed",
          });

          return {
            order: {
              accountId,
              createdAt: order.createdAt,
              grossAmount: formatMoney(grossAmountMicros),
              marketPrice: formatPrice(priceMicros),
              orderId: order.orderId,
              quantity: formatQuantity(quantityAtoms),
              securityId,
              side,
            },
            summary: {
              accountId,
              grossAmount: formatMoney(grossAmountMicros),
              orderId: order.orderId,
              securityId,
              side,
            },
          };
        },
        input: control,
        metadata: {
          accountId,
          quantity: formatQuantity(quantityAtoms),
          securityId,
          side,
        },
        operation: "trade_submit",
        scope: `${accountId}:${securityId}:${side}`,
      });
    },

    async listOrders(input) {
      const query = isRecord(input) ? input : {};
      const accountId = readOptionalString(query, "accountId");
      const limit = readLimit(query) ?? 100;
      const state = await store.readState();
      const orders = Object.values(state.orders)
        .filter((order) => (accountId ? order.accountId === accountId : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map((order) => {
          return {
            accountId: order.accountId,
            createdAt: order.createdAt,
            grossAmount: formatMoney(BigInt(order.grossAmountMicros)),
            marketPrice: formatPrice(BigInt(order.priceMicros)),
            orderId: order.orderId,
            quantity: formatQuantity(BigInt(order.quantityAtoms)),
            securityId: order.securityId,
            side: order.side,
          };
        });

      return {
        orders,
        summary: {
          orderCount: orders.length,
        },
      };
    },

    async getOrder(orderId) {
      const state = await store.readState();
      const order = state.orders[orderId];

      if (!order) {
        throw new NotFoundError(`Sandbox order ${orderId} was not found.`);
      }

      return {
        order: {
          accountId: order.accountId,
          createdAt: order.createdAt,
          grossAmount: formatMoney(BigInt(order.grossAmountMicros)),
          marketPrice: formatPrice(BigInt(order.priceMicros)),
          orderId: order.orderId,
          quantity: formatQuantity(BigInt(order.quantityAtoms)),
          securityId: order.securityId,
          side: order.side,
        },
        summary: {
          grossAmount: formatMoney(BigInt(order.grossAmountMicros)),
          orderId,
          side: order.side,
        },
      };
    },
  };
}
