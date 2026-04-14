import { randomUUID } from "node:crypto";

import {
  createPlaidApiClient,
  createSandboxItem,
  getAccountBalances,
  getHoldings,
  type PlaidApiLike,
  syncTransactions,
} from "@niven/plaid-client";
import { ValidationError } from "@niven/shared";

import { multiplyPriceByQuantity, parseMoney, parseQuantity, toStoredBigInt } from "./numbers.js";
import type {
  SandboxAccountCategory,
  SandboxAccountRecord,
  SandboxEventRecord,
  SandboxSnapshotMetadata,
  SandboxState,
} from "./types.js";

interface ImportPreset {
  readonly institutionId: string;
  readonly itemLabel: string;
  readonly password?: string;
  readonly products: readonly ("investments" | "transactions" | "transfer")[];
  readonly transactionsDaysRequested?: number;
  readonly username: string;
}

export const PLAID_SAMPLE_IMPORT_PRESETS: readonly ImportPreset[] = [
  {
    institutionId: "ins_109508",
    itemLabel: "plaid_sample_transactions",
    products: ["transactions"],
    transactionsDaysRequested: 30,
    username: "user_transactions_dynamic",
  },
  {
    institutionId: "ins_109508",
    itemLabel: "plaid_sample_investments_transfer",
    password: "pass_good",
    products: ["investments", "transfer"],
    username: "user_good",
  },
] as const;

const TRANSFERABLE_CASH_SUBTYPES = new Set([
  "cash management",
  "checking",
  "money market",
  "savings",
]);

function categorizeAccount(
  type: string,
  subtype: string | null,
): {
  readonly category: SandboxAccountCategory;
  readonly canTrade: boolean;
  readonly canTransfer: boolean;
} {
  const normalizedType = type.trim().toLowerCase();
  const normalizedSubtype = subtype?.trim().toLowerCase() ?? null;

  if (normalizedType === "investment") {
    return {
      category: "investment",
      canTrade: true,
      // The custom sandbox keeps a cash ledger for investment accounts, so
      // direct internal cash moves should be allowed even though this is
      // separate from Plaid's own transfer capability model.
      canTransfer: true,
    };
  }

  if (normalizedType === "depository") {
    if (normalizedSubtype && TRANSFERABLE_CASH_SUBTYPES.has(normalizedSubtype)) {
      return {
        category: "cash",
        canTrade: false,
        canTransfer: true,
      };
    }

    return {
      category: "restricted_cash",
      canTrade: false,
      canTransfer: false,
    };
  }

  if (normalizedType === "credit") {
    return {
      category: "credit",
      canTrade: false,
      canTransfer: false,
    };
  }

  if (normalizedType === "loan") {
    return {
      category: "loan",
      canTrade: false,
      canTransfer: false,
    };
  }

  return {
    category: "other",
    canTrade: false,
    canTransfer: false,
  };
}

function choosePriceMicros(input: {
  readonly closePrice?: number | null;
  readonly institutionPrice?: number | null;
  readonly institutionValue?: number | null;
  readonly quantity?: number | null;
}): bigint {
  if (input.institutionPrice !== null && input.institutionPrice !== undefined) {
    return parseMoney(input.institutionPrice);
  }

  if (input.closePrice !== null && input.closePrice !== undefined) {
    return parseMoney(input.closePrice);
  }

  if (
    input.institutionValue !== null &&
    input.institutionValue !== undefined &&
    input.quantity !== null &&
    input.quantity !== undefined &&
    input.quantity !== 0
  ) {
    return parseMoney(input.institutionValue / input.quantity);
  }

  return 0n;
}

function chooseCostBasisMicros(input: {
  readonly costBasis?: number | null;
  readonly institutionValue: number;
  readonly quantity: number;
}): bigint {
  const institutionValueMicros = parseMoney(input.institutionValue);

  if (input.costBasis === null || input.costBasis === undefined) {
    return institutionValueMicros;
  }

  const totalCandidate = parseMoney(input.costBasis);
  const unitCandidate = multiplyPriceByQuantity(
    parseMoney(input.costBasis),
    parseQuantity(input.quantity),
  );
  const totalDistance =
    totalCandidate > institutionValueMicros
      ? totalCandidate - institutionValueMicros
      : institutionValueMicros - totalCandidate;
  const unitDistance =
    unitCandidate > institutionValueMicros
      ? unitCandidate - institutionValueMicros
      : institutionValueMicros - unitCandidate;

  return totalDistance <= unitDistance ? totalCandidate : unitCandidate;
}

function createEmptyState(importedAt: string): SandboxState {
  const snapshot: SandboxSnapshotMetadata = {
    importedAccountCount: 0,
    importedAt,
    importedHoldingCount: 0,
    importedSecurityCount: 0,
    importedTransactionCount: 0,
    source: "plaid_sandbox",
  };

  const event: SandboxEventRecord = {
    accountIds: [],
    createdAt: importedAt,
    entityId: "snapshot",
    eventId: randomUUID(),
    payload: {
      source: "plaid_sandbox",
    },
    type: "snapshot_imported",
  };

  return {
    version: 1,
    accounts: {},
    events: [event],
    idempotency: {},
    importedTransactions: {},
    orders: {},
    positions: {},
    securities: {},
    snapshot,
    transfers: {},
  };
}

export async function createSandboxStateFromPlaidSample(
  options: {
    readonly clock?: () => string;
    readonly plaidClient?: PlaidApiLike;
    readonly presets?: readonly ImportPreset[];
  } = {},
): Promise<SandboxState> {
  const now = options.clock ?? (() => new Date().toISOString());
  const importedAt = now();
  const state = createEmptyState(importedAt);
  const client = options.plaidClient ?? createPlaidApiClient();
  const presets = options.presets ?? PLAID_SAMPLE_IMPORT_PRESETS;

  for (const preset of presets) {
    const linkedItem = await createSandboxItem(
      {
        institutionId: preset.institutionId,
        initialProducts: [...preset.products] as never,
        ...(preset.password ? { password: preset.password } : {}),
        ...(preset.transactionsDaysRequested
          ? {
              transactions: {
                daysRequested: preset.transactionsDaysRequested,
              },
            }
          : {}),
        username: preset.username,
      },
      client,
    );

    const balances = await getAccountBalances(linkedItem.accessToken, client);

    for (const account of balances.accounts) {
      const permissions = categorizeAccount(account.type, account.subtype ?? null);
      const currentMicros =
        account.balances.current !== null && account.balances.current !== undefined
          ? parseMoney(account.balances.current)
          : 0n;
      const availableMicros =
        account.balances.available !== null && account.balances.available !== undefined
          ? parseMoney(account.balances.available)
          : currentMicros;

      const record: SandboxAccountRecord = {
        accountId: account.account_id,
        availableCashMicros:
          permissions.category === "cash" || permissions.category === "investment"
            ? toStoredBigInt(availableMicros)
            : null,
        cashBalanceMicros:
          permissions.category === "cash" || permissions.category === "investment"
            ? toStoredBigInt(currentMicros)
            : null,
        category: permissions.category,
        creditLimitMicros:
          account.balances.limit !== null && account.balances.limit !== undefined
            ? toStoredBigInt(parseMoney(account.balances.limit))
            : null,
        currencyCode: account.balances.iso_currency_code ?? "USD",
        holderCategory: account.holder_category ?? null,
        importedAt,
        mask: account.mask ?? null,
        name: account.name,
        officialName: account.official_name ?? null,
        permissions,
        plaidAccountId: account.account_id,
        sourceLabel: preset.itemLabel,
        staticAvailableBalanceMicros: toStoredBigInt(availableMicros),
        staticCurrentBalanceMicros: toStoredBigInt(currentMicros),
        subtype: account.subtype ?? null,
        type: account.type,
      };

      state.accounts[record.accountId] = record;
    }

    if (preset.products.includes("investments")) {
      const holdingsSnapshot = await getHoldings(linkedItem.accessToken, client);
      const securityById = new Map(
        holdingsSnapshot.securities.map((security) => [security.security_id, security] as const),
      );

      for (const holding of holdingsSnapshot.holdings) {
        const security = securityById.get(holding.security_id);

        if (!security) {
          throw new ValidationError(`Missing security for holding ${holding.security_id}.`);
        }

        if (security.type === "cash") {
          const account = state.accounts[holding.account_id];

          if (!account || account.cashBalanceMicros === null) {
            continue;
          }

          const valueMicros = parseMoney(holding.institution_value);
          account.cashBalanceMicros = toStoredBigInt(valueMicros);
          account.availableCashMicros = toStoredBigInt(valueMicros);
          continue;
        }

        const priceMicros = choosePriceMicros({
          closePrice: security.close_price ?? null,
          institutionPrice: holding.institution_price,
          institutionValue: holding.institution_value,
          quantity: holding.quantity,
        });

        state.securities[security.security_id] = {
          currencyCode: security.iso_currency_code ?? "USD",
          importedAt,
          isCashSecurity: false,
          name: security.name ?? security.security_id,
          plaidSecurityId: security.security_id,
          priceAsOf: holding.institution_price_as_of ?? security.close_price_as_of ?? null,
          priceMicros: priceMicros.toString(),
          securityId: security.security_id,
          subtype: security.subtype ?? null,
          symbol: security.ticker_symbol ?? null,
          type: security.type ?? null,
        };

        state.positions[`${holding.account_id}:${holding.security_id}`] = {
          accountId: holding.account_id,
          costBasisMicros: chooseCostBasisMicros({
            costBasis: holding.cost_basis ?? null,
            institutionValue: holding.institution_value,
            quantity: holding.quantity,
          }).toString(),
          createdAt: importedAt,
          positionId: `${holding.account_id}:${holding.security_id}`,
          quantityAtoms: parseQuantity(holding.quantity).toString(),
          securityId: holding.security_id,
          updatedAt: importedAt,
        };
      }

      for (const account of Object.values(state.accounts)) {
        if (account.category !== "investment" || account.cashBalanceMicros === null) {
          continue;
        }

        const holdingsValueMicros = Object.values(state.positions)
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
        const importedCurrentMicros = BigInt(account.staticCurrentBalanceMicros ?? "0");
        const currentCashMicros = BigInt(account.cashBalanceMicros);
        const delta = importedCurrentMicros - (currentCashMicros + holdingsValueMicros);

        if (delta !== 0n) {
          const adjusted = currentCashMicros + delta;
          account.cashBalanceMicros = adjusted.toString();
          account.availableCashMicros = adjusted.toString();
        }
      }
    }

    if (preset.products.includes("transactions")) {
      const transactions = await syncTransactions(linkedItem.accessToken, null, client);

      for (const transaction of transactions.added) {
        state.importedTransactions[transaction.transaction_id] = {
          accountId: transaction.account_id,
          amountMicros: parseMoney(transaction.amount).toString(),
          date: transaction.date,
          importedAt,
          merchantName: transaction.merchant_name ?? null,
          name: transaction.name,
          pending: transaction.pending,
          plaidTransactionId: transaction.transaction_id,
          sourceLabel: preset.itemLabel,
          transactionId: transaction.transaction_id,
        };
      }
    }
  }

  state.snapshot = {
    importedAccountCount: Object.keys(state.accounts).length,
    importedAt,
    importedHoldingCount: Object.keys(state.positions).length,
    importedSecurityCount: Object.keys(state.securities).length,
    importedTransactionCount: Object.keys(state.importedTransactions).length,
    source: "plaid_sandbox",
  };

  const initialEvent = state.events[0];

  if (!initialEvent) {
    throw new ValidationError("Missing initial sandbox import event.");
  }

  state.events[0] = {
    accountIds: Object.keys(state.accounts),
    createdAt: initialEvent.createdAt,
    entityId: initialEvent.entityId,
    eventId: initialEvent.eventId,
    payload: {
      accountCount: state.snapshot.importedAccountCount,
      holdingCount: state.snapshot.importedHoldingCount,
      securityCount: state.snapshot.importedSecurityCount,
      source: "plaid_sandbox",
      transactionCount: state.snapshot.importedTransactionCount,
    },
    type: initialEvent.type,
  };

  return state;
}
