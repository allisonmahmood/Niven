import { ExternalServiceError, isRecord } from "@niven/shared";
import type {
  AccountsBalanceGetRequest,
  AccountsGetRequest,
  AccountsGetResponse,
  InvestmentsHoldingsGetRequest,
  InvestmentsHoldingsGetResponse,
  InvestmentsTransactionsGetRequest,
  InvestmentsTransactionsGetResponse,
  ItemGetRequest,
  ItemGetResponse,
  ItemPublicTokenExchangeRequest,
  ItemPublicTokenExchangeResponse,
  SandboxItemFireWebhookRequest,
  SandboxItemFireWebhookResponse,
  SandboxItemResetLoginRequest,
  SandboxItemResetLoginResponse,
  SandboxPublicTokenCreateRequest,
  SandboxPublicTokenCreateResponse,
  SandboxTransactionsCreateRequest,
  SandboxTransactionsCreateResponse,
  SandboxTransferFireWebhookRequest,
  SandboxTransferFireWebhookResponse,
  TransactionsRefreshRequest,
  TransactionsRefreshResponse,
  TransactionsSyncRequest,
  TransactionsSyncResponse,
  TransferAuthorizationCreateRequest,
  TransferAuthorizationCreateResponse,
  TransferBalanceGetRequest,
  TransferBalanceGetResponse,
  TransferCancelRequest,
  TransferCancelResponse,
  TransferCapabilitiesGetRequest,
  TransferCapabilitiesGetResponse,
  TransferConfigurationGetRequest,
  TransferConfigurationGetResponse,
  TransferCreateRequest,
  TransferCreateResponse,
  TransferGetRequest,
  TransferGetResponse,
  TransferListRequest,
  TransferListResponse,
  TransferRecurringCancelRequest,
  TransferRecurringCancelResponse,
  TransferRecurringCreateRequest,
  TransferRecurringCreateResponse,
  TransferRecurringListRequest,
  TransferRecurringListResponse,
} from "plaid";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

import { type PlaidClientEnv, readValidatedPlaidClientEnv } from "./env.js";

export interface PlaidApiLike {
  accountsBalanceGet(request: AccountsBalanceGetRequest): Promise<{ data: AccountsGetResponse }>;
  accountsGet(request: AccountsGetRequest): Promise<{ data: AccountsGetResponse }>;
  investmentsHoldingsGet(
    request: InvestmentsHoldingsGetRequest,
  ): Promise<{ data: InvestmentsHoldingsGetResponse }>;
  investmentsTransactionsGet(
    request: InvestmentsTransactionsGetRequest,
  ): Promise<{ data: InvestmentsTransactionsGetResponse }>;
  itemGet(request: ItemGetRequest): Promise<{ data: ItemGetResponse }>;
  itemPublicTokenExchange(
    request: ItemPublicTokenExchangeRequest,
  ): Promise<{ data: ItemPublicTokenExchangeResponse }>;
  sandboxItemFireWebhook(
    request: SandboxItemFireWebhookRequest,
  ): Promise<{ data: SandboxItemFireWebhookResponse }>;
  sandboxItemResetLogin(
    request: SandboxItemResetLoginRequest,
  ): Promise<{ data: SandboxItemResetLoginResponse }>;
  sandboxPublicTokenCreate(
    request: SandboxPublicTokenCreateRequest,
  ): Promise<{ data: SandboxPublicTokenCreateResponse }>;
  sandboxTransactionsCreate(
    request: SandboxTransactionsCreateRequest,
  ): Promise<{ data: SandboxTransactionsCreateResponse }>;
  sandboxTransferFireWebhook(
    request: SandboxTransferFireWebhookRequest,
  ): Promise<{ data: SandboxTransferFireWebhookResponse }>;
  transactionsRefresh(
    request: TransactionsRefreshRequest,
  ): Promise<{ data: TransactionsRefreshResponse }>;
  transactionsSync(request: TransactionsSyncRequest): Promise<{ data: TransactionsSyncResponse }>;
  transferAuthorizationCreate(
    request: TransferAuthorizationCreateRequest,
  ): Promise<{ data: TransferAuthorizationCreateResponse }>;
  transferBalanceGet(
    request: TransferBalanceGetRequest,
  ): Promise<{ data: TransferBalanceGetResponse }>;
  transferCancel(request: TransferCancelRequest): Promise<{ data: TransferCancelResponse }>;
  transferCapabilitiesGet(
    request: TransferCapabilitiesGetRequest,
  ): Promise<{ data: TransferCapabilitiesGetResponse }>;
  transferConfigurationGet(
    request: TransferConfigurationGetRequest,
  ): Promise<{ data: TransferConfigurationGetResponse }>;
  transferCreate(request: TransferCreateRequest): Promise<{ data: TransferCreateResponse }>;
  transferGet(request: TransferGetRequest): Promise<{ data: TransferGetResponse }>;
  transferList(request: TransferListRequest): Promise<{ data: TransferListResponse }>;
  transferRecurringCancel(
    request: TransferRecurringCancelRequest,
  ): Promise<{ data: TransferRecurringCancelResponse }>;
  transferRecurringCreate(
    request: TransferRecurringCreateRequest,
  ): Promise<{ data: TransferRecurringCreateResponse }>;
  transferRecurringList(
    request: TransferRecurringListRequest,
  ): Promise<{ data: TransferRecurringListResponse }>;
}

export function createPlaidApiClient(
  env: PlaidClientEnv = readValidatedPlaidClientEnv(),
): PlaidApi {
  const basePath = PlaidEnvironments[env.environment];

  if (!basePath) {
    throw new ExternalServiceError(`Unsupported Plaid environment: ${env.environment}`);
  }

  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": env.clientId,
          "PLAID-SECRET": env.secret,
        },
      },
    }),
  );
}

export async function executePlaidOperation<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw normalizePlaidError(operation, error);
  }
}

export function normalizePlaidError(operation: string, error: unknown): ExternalServiceError {
  if (
    isRecord(error) &&
    "response" in error &&
    isRecord(error.response) &&
    "data" in error.response
  ) {
    const responseData = error.response.data;

    if (isRecord(responseData)) {
      return new ExternalServiceError(`Plaid ${operation} failed.`, {
        errorCode: responseData.error_code,
        errorMessage: responseData.error_message,
        errorType: responseData.error_type,
        requestId: responseData.request_id,
      });
    }
  }

  return new ExternalServiceError(`Plaid ${operation} failed.`, {
    cause: error instanceof Error ? error.message : String(error),
  });
}
