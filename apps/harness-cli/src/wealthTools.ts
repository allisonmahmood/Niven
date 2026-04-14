import { randomUUID } from "node:crypto";

import { Type } from "@mariozechner/pi-ai";
import {
  type AgentToolResult,
  defineTool,
  type ExtensionContext,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

import { getApprovalRationale, hasExplicitApproval, WEALTH_APPROVAL_PREFIX } from "./approval.js";
import type { WealthApiClient } from "./wealthApiClient.js";

const nonEmptyString = Type.String({ minLength: 1 });
const amountString = Type.String({ pattern: "^[-]?\\d+\\.\\d{2}$" });
const quantityString = Type.String({ pattern: "^\\d+(\\.\\d{1,8})?$" });
const executionModeSchema = Type.Optional(
  Type.Union([Type.Literal("execute"), Type.Literal("preview")]),
);
const idempotencyKeySchema = Type.Optional(Type.String({ maxLength: 50, minLength: 1 }));
const queryLimitSchema = Type.Optional(Type.Integer({ maximum: 500, minimum: 1 }));

type MutationParams = {
  readonly executionMode?: "execute" | "preview";
  readonly idempotencyKey?: string;
};

export const WEALTH_ALLOWED_TOOL_NAMES = [
  "list_accounts",
  "get_account",
  "list_account_activity",
  "list_holdings",
  "list_securities",
  "move_cash",
  "list_cash_transfers",
  "get_cash_transfer",
  "submit_trade",
  "list_orders",
  "get_order",
] as const;

export const WEALTH_FORBIDDEN_TOOL_NAMES = [
  "link_sandbox_item",
  "reset_from_plaid_snapshot",
  "sandbox_create_transactions",
  "sandbox_reset_login",
  "sandbox_fire_item_webhook",
] as const;

function buildToolText(toolName: string, payload: Record<string, unknown>): string {
  return `${toolName}\n${JSON.stringify(payload, null, 2)}`;
}

function makeResult(
  toolName: string,
  payload: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: buildToolText(toolName, payload) }],
    details: payload,
  };
}

function mutationControl(toolName: string, params: MutationParams, context: ExtensionContext) {
  const executionMode = params.executionMode ?? "preview";

  if (executionMode === "execute" && !hasExplicitApproval(context)) {
    throw new Error(
      `${toolName} requires an explicit approval message. Send a new user message starting with "${WEALTH_APPROVAL_PREFIX}" before executing live mutations.`,
    );
  }

  return {
    approval: {
      approved: true,
      approvedBy: executionMode === "execute" ? "latest_user_message" : "wealth_agent_preview",
      rationale:
        executionMode === "execute"
          ? (getApprovalRationale(context) ?? "Approved by the latest user message.")
          : "Preview-only mutation request.",
    },
    dryRun: executionMode !== "execute",
    idempotencyKey: params.idempotencyKey ?? randomUUID(),
  };
}

function createReadTool<TParams extends ReturnType<typeof Type.Object>>(
  tool: ToolDefinition<TParams, Record<string, unknown>>,
) {
  return defineTool(tool);
}

export function createWealthTools(client: WealthApiClient): ToolDefinition[] {
  return [
    createReadTool({
      name: "list_accounts",
      label: "List Accounts",
      description: "List all sandbox accounts and their current balances.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const data = await client.listAccounts();
        return makeResult("list_accounts", data);
      },
    }),
    createReadTool({
      name: "get_account",
      label: "Get Account",
      description: "Get one sandbox account and its current holdings summary.",
      parameters: Type.Object(
        {
          accountId: nonEmptyString,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.getAccount(params.accountId);
        return makeResult("get_account", data);
      },
    }),
    createReadTool({
      name: "list_account_activity",
      label: "List Account Activity",
      description: "List imported transactions and sandbox-generated activity for one account.",
      parameters: Type.Object(
        {
          accountId: nonEmptyString,
          limit: queryLimitSchema,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.listAccountActivity(params.accountId, {
          limit: params.limit,
        });
        return makeResult("list_account_activity", data);
      },
    }),
    createReadTool({
      name: "list_holdings",
      label: "List Holdings",
      description: "List current sandbox investment holdings.",
      parameters: Type.Object(
        {
          accountId: Type.Optional(nonEmptyString),
          limit: queryLimitSchema,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.listHoldings({
          accountId: params.accountId,
          limit: params.limit,
        });
        return makeResult("list_holdings", data);
      },
    }),
    createReadTool({
      name: "list_securities",
      label: "List Securities",
      description: "Search or list securities available in the sandbox portfolio.",
      parameters: Type.Object(
        {
          limit: queryLimitSchema,
          query: Type.Optional(nonEmptyString),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.listSecurities({
          limit: params.limit,
          query: params.query,
        });
        return makeResult("list_securities", data);
      },
    }),
    createReadTool({
      name: "move_cash",
      label: "Move Cash",
      description:
        "Preview or execute an internal cash transfer between sandbox accounts. Use preview first, then execute only after the latest user message starts with APPROVE:.",
      parameters: Type.Object(
        {
          amount: amountString,
          description: Type.Optional(nonEmptyString),
          executionMode: executionModeSchema,
          fromAccountId: nonEmptyString,
          idempotencyKey: idempotencyKeySchema,
          toAccountId: nonEmptyString,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params, _signal, _onUpdate, context) {
        const data = await client.transferCash({
          amount: params.amount,
          control: mutationControl("move_cash", params, context),
          description: params.description,
          fromAccountId: params.fromAccountId,
          toAccountId: params.toAccountId,
        });
        return makeResult("move_cash", data);
      },
    }),
    createReadTool({
      name: "list_cash_transfers",
      label: "List Transfers",
      description: "List executed sandbox cash transfers.",
      parameters: Type.Object(
        {
          limit: queryLimitSchema,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.listTransfers({
          limit: params.limit,
        });
        return makeResult("list_cash_transfers", data);
      },
    }),
    createReadTool({
      name: "get_cash_transfer",
      label: "Get Transfer",
      description: "Get one sandbox cash transfer by transfer id.",
      parameters: Type.Object(
        {
          transferId: nonEmptyString,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.getTransfer(params.transferId);
        return makeResult("get_cash_transfer", data);
      },
    }),
    createReadTool({
      name: "submit_trade",
      label: "Submit Trade",
      description:
        "Preview or execute a market buy or sell inside a sandbox investment account. Use preview first, then execute only after the latest user message starts with APPROVE:.",
      parameters: Type.Object(
        {
          accountId: nonEmptyString,
          executionMode: executionModeSchema,
          idempotencyKey: idempotencyKeySchema,
          quantity: quantityString,
          securityId: nonEmptyString,
          side: Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params, _signal, _onUpdate, context) {
        const data = await client.submitTrade({
          accountId: params.accountId,
          control: mutationControl("submit_trade", params, context),
          quantity: params.quantity,
          securityId: params.securityId,
          side: params.side,
        });
        return makeResult("submit_trade", data);
      },
    }),
    createReadTool({
      name: "list_orders",
      label: "List Orders",
      description: "List executed sandbox investment orders.",
      parameters: Type.Object(
        {
          accountId: Type.Optional(nonEmptyString),
          limit: queryLimitSchema,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.listOrders({
          accountId: params.accountId,
          limit: params.limit,
        });
        return makeResult("list_orders", data);
      },
    }),
    createReadTool({
      name: "get_order",
      label: "Get Order",
      description: "Get one executed sandbox investment order by order id.",
      parameters: Type.Object(
        {
          orderId: nonEmptyString,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await client.getOrder(params.orderId);
        return makeResult("get_order", data);
      },
    }),
  ];
}
