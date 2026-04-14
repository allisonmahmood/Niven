import type {
  CustomSandboxTransaction,
  Products,
  SandboxItemFireWebhookRequestWebhookCodeEnum,
  SandboxItemFireWebhookResponse,
  SandboxItemResetLoginResponse,
  SandboxTransactionsCreateResponse,
  SandboxTransferFireWebhookResponse,
  WebhookType,
} from "plaid";
import { CountryCode } from "plaid";

import { createPlaidApiClient, executePlaidOperation, type PlaidApiLike } from "./client.js";
import { exchangePublicToken } from "./items.js";

export interface LinkedSandboxItem {
  readonly accessToken: string;
  readonly countryCodes: readonly CountryCode[];
  readonly initialProducts: readonly Products[];
  readonly itemId: string;
  readonly institutionId: string;
  readonly createdAt: string;
  readonly requestId: string;
}

export interface CreateSandboxItemInput {
  readonly countryCodes?: readonly CountryCode[];
  readonly institutionId: string;
  readonly initialProducts: readonly Products[];
  readonly password?: string;
  readonly transactions?: {
    readonly daysRequested?: number;
    readonly endDate?: string;
    readonly startDate?: string;
  };
  readonly username?: string;
  readonly webhook?: string;
}

export async function createSandboxItem(
  input: CreateSandboxItemInput,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<LinkedSandboxItem> {
  const publicTokenResponse = await executePlaidOperation(
    "sandbox public token create",
    async () => {
      return client.sandboxPublicTokenCreate({
        institution_id: input.institutionId,
        initial_products: [...input.initialProducts],
        options: {
          override_password: input.password ?? null,
          override_username: input.username ?? null,
          ...(input.webhook ? { webhook: input.webhook } : {}),
          ...(input.transactions
            ? {
                transactions: {
                  ...(input.transactions.daysRequested
                    ? { days_requested: input.transactions.daysRequested }
                    : {}),
                  ...(input.transactions.endDate ? { end_date: input.transactions.endDate } : {}),
                  ...(input.transactions.startDate
                    ? { start_date: input.transactions.startDate }
                    : {}),
                },
              }
            : {}),
        },
      });
    },
  );

  const exchangeResult = await exchangePublicToken(publicTokenResponse.data.public_token, client);

  return {
    accessToken: exchangeResult.accessToken,
    countryCodes: input.countryCodes ?? [CountryCode.Us],
    createdAt: new Date().toISOString(),
    initialProducts: [...input.initialProducts],
    institutionId: input.institutionId,
    itemId: exchangeResult.itemId,
    requestId: exchangeResult.requestId,
  };
}

export async function resetSandboxLogin(
  accessToken: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<SandboxItemResetLoginResponse> {
  const response = await executePlaidOperation("sandbox item reset login", async () => {
    return client.sandboxItemResetLogin({
      access_token: accessToken,
    });
  });

  return response.data;
}

export async function fireSandboxItemWebhook(
  accessToken: string,
  webhookCode: SandboxItemFireWebhookRequestWebhookCodeEnum,
  webhookType: WebhookType | undefined,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<SandboxItemFireWebhookResponse> {
  const response = await executePlaidOperation("sandbox item fire webhook", async () => {
    return client.sandboxItemFireWebhook({
      access_token: accessToken,
      webhook_code: webhookCode,
      ...(webhookType ? { webhook_type: webhookType } : {}),
    });
  });

  return response.data;
}

export async function createSandboxTransactions(
  accessToken: string,
  transactions: readonly CustomSandboxTransaction[],
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<SandboxTransactionsCreateResponse> {
  const response = await executePlaidOperation("sandbox transactions create", async () => {
    return client.sandboxTransactionsCreate({
      access_token: accessToken,
      transactions: [...transactions],
    });
  });

  return response.data;
}

export async function fireSandboxTransferWebhook(
  webhook: string,
  client: PlaidApiLike = createPlaidApiClient(),
): Promise<SandboxTransferFireWebhookResponse> {
  const response = await executePlaidOperation("sandbox transfer fire webhook", async () => {
    return client.sandboxTransferFireWebhook({
      webhook,
    });
  });

  return response.data;
}
