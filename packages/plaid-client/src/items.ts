import type { AccountsGetResponse, ItemGetResponse } from "plaid";

import { createPlaidApiClient, executePlaidOperation, type PlaidApiLike } from "./client.js";

export interface ExchangedPublicTokenResult {
  readonly itemId: string;
  readonly accessToken: string;
  readonly requestId: string;
}

export async function exchangePublicToken(
  publicToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<ExchangedPublicTokenResult> {
  const response = await executePlaidOperation("item public token exchange", async () => {
    return client.itemPublicTokenExchange({
      public_token: publicToken,
    });
  });

  return {
    itemId: response.data.item_id,
    accessToken: response.data.access_token,
    requestId: response.data.request_id,
  };
}

export async function getItem(
  accessToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<ItemGetResponse> {
  const response = await executePlaidOperation("item get", async () => {
    return client.itemGet({
      access_token: accessToken,
    });
  });

  return response.data;
}

export async function getAccounts(
  accessToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<AccountsGetResponse> {
  const response = await executePlaidOperation("accounts get", async () => {
    return client.accountsGet({
      access_token: accessToken,
    });
  });

  return response.data;
}

export async function getAccountBalances(
  accessToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<AccountsGetResponse> {
  const response = await executePlaidOperation("accounts balance get", async () => {
    return client.accountsBalanceGet({
      access_token: accessToken,
    });
  });

  return response.data;
}
