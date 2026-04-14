import type { InvestmentsHoldingsGetResponse, InvestmentsTransactionsGetResponse } from "plaid";

import { createPlaidApiClient, executePlaidOperation, type PlaidApiLike } from "./client.js";

export interface HoldingsSnapshot {
  readonly accounts: InvestmentsHoldingsGetResponse["accounts"];
  readonly holdings: InvestmentsHoldingsGetResponse["holdings"];
  readonly item: InvestmentsHoldingsGetResponse["item"];
  readonly requestId: string;
  readonly securities: InvestmentsHoldingsGetResponse["securities"];
}

export interface InvestmentTransactionsInput {
  readonly accessToken: string;
  readonly accountIds?: readonly string[];
  readonly endDate: string;
  readonly startDate: string;
}

export async function getHoldings(
  accessToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<HoldingsSnapshot> {
  const response = await executePlaidOperation("investments holdings get", async () => {
    return client.investmentsHoldingsGet({
      access_token: accessToken,
    });
  });

  return {
    accounts: response.data.accounts,
    holdings: response.data.holdings,
    item: response.data.item,
    requestId: response.data.request_id,
    securities: response.data.securities,
  };
}

export async function getInvestmentTransactions(
  input: InvestmentTransactionsInput,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<InvestmentsTransactionsGetResponse> {
  const transactions = [];
  let offset = 0;
  let totalTransactions = 0;
  let latestResponse: InvestmentsTransactionsGetResponse | undefined;

  do {
    const response = await executePlaidOperation("investments transactions get", async () => {
      return client.investmentsTransactionsGet({
        access_token: input.accessToken,
        end_date: input.endDate,
        options: {
          count: 100,
          offset,
          ...(input.accountIds ? { account_ids: [...input.accountIds] } : {}),
        },
        start_date: input.startDate,
      });
    });

    latestResponse = response.data;
    transactions.push(...response.data.investment_transactions);
    totalTransactions = response.data.total_investment_transactions;
    offset += response.data.investment_transactions.length;
  } while (offset < totalTransactions);

  if (!latestResponse) {
    throw new Error("Investments transactions response was unexpectedly empty.");
  }

  return {
    ...latestResponse,
    investment_transactions: transactions,
  };
}
