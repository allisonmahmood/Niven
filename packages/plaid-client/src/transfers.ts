import type {
  ReasonCode,
  TransferAuthorizationCreateRequest,
  TransferAuthorizationCreateResponse,
  TransferBalanceGetResponse,
  TransferBalanceType,
  TransferCancelResponse,
  TransferCapabilitiesGetResponse,
  TransferConfigurationGetResponse,
  TransferCreateRequest,
  TransferCreateResponse,
  TransferGetResponse,
  TransferListResponse,
  TransferRecurringCancelResponse,
  TransferRecurringCreateRequest,
  TransferRecurringCreateResponse,
  TransferRecurringListResponse,
} from "plaid";

import { createPlaidApiClient, executePlaidOperation, type PlaidApiLike } from "./client.js";

export interface TransferListInput {
  readonly count?: number;
  readonly endDate?: string;
  readonly fundingAccountId?: string;
  readonly offset?: number;
  readonly startDate?: string;
}

export interface RecurringTransferListInput {
  readonly count?: number;
  readonly endTime?: string;
  readonly fundingAccountId?: string;
  readonly offset?: number;
  readonly startTime?: string;
}

export async function authorizeTransfer(
  request: TransferAuthorizationCreateRequest,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferAuthorizationCreateResponse> {
  const response = await executePlaidOperation("transfer authorization create", async () => {
    return client.transferAuthorizationCreate(request);
  });

  return response.data;
}

export async function createTransfer(
  request: TransferCreateRequest,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferCreateResponse> {
  const response = await executePlaidOperation("transfer create", async () => {
    return client.transferCreate(request);
  });

  return response.data;
}

export async function cancelTransfer(
  transferId: string,
  reasonCode: ReasonCode | undefined,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferCancelResponse> {
  const response = await executePlaidOperation("transfer cancel", async () => {
    return client.transferCancel({
      transfer_id: transferId,
      ...(reasonCode ? { reason_code: reasonCode } : {}),
    });
  });

  return response.data;
}

export async function getTransfer(
  identifier: {
    readonly authorizationId?: string;
    readonly transferId?: string;
  },
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferGetResponse> {
  const response = await executePlaidOperation("transfer get", async () => {
    return client.transferGet({
      ...(identifier.authorizationId ? { authorization_id: identifier.authorizationId } : {}),
      ...(identifier.transferId ? { transfer_id: identifier.transferId } : {}),
    });
  });

  return response.data;
}

export async function listTransfers(
  input: TransferListInput = {},
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferListResponse> {
  const response = await executePlaidOperation("transfer list", async () => {
    return client.transferList({
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.endDate ? { end_date: input.endDate } : {}),
      ...(input.fundingAccountId ? { funding_account_id: input.fundingAccountId } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.startDate ? { start_date: input.startDate } : {}),
    });
  });

  return response.data;
}

export async function getTransferConfiguration(
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferConfigurationGetResponse> {
  const response = await executePlaidOperation("transfer configuration get", async () => {
    return client.transferConfigurationGet({});
  });

  return response.data;
}

export async function getTransferBalance(
  type: TransferBalanceType | undefined,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferBalanceGetResponse> {
  const response = await executePlaidOperation("transfer balance get", async () => {
    return client.transferBalanceGet(type ? { type } : {});
  });

  return response.data;
}

export async function getTransferCapabilities(
  accessToken: string,
  accountId: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferCapabilitiesGetResponse> {
  const response = await executePlaidOperation("transfer capabilities get", async () => {
    return client.transferCapabilitiesGet({
      access_token: accessToken,
      account_id: accountId,
    });
  });

  return response.data;
}

export async function createRecurringTransfer(
  request: TransferRecurringCreateRequest,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferRecurringCreateResponse> {
  const response = await executePlaidOperation("recurring transfer create", async () => {
    return client.transferRecurringCreate(request);
  });

  return response.data;
}

export async function cancelRecurringTransfer(
  recurringTransferId: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferRecurringCancelResponse> {
  const response = await executePlaidOperation("recurring transfer cancel", async () => {
    return client.transferRecurringCancel({
      recurring_transfer_id: recurringTransferId,
    });
  });

  return response.data;
}

export async function listRecurringTransfers(
  input: RecurringTransferListInput = {},
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<TransferRecurringListResponse> {
  const response = await executePlaidOperation("recurring transfer list", async () => {
    return client.transferRecurringList({
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.endTime ? { end_time: input.endTime } : {}),
      ...(input.fundingAccountId ? { funding_account_id: input.fundingAccountId } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.startTime ? { start_time: input.startTime } : {}),
    });
  });

  return response.data;
}
