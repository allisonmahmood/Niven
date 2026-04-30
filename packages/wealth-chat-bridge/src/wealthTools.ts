import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@mariozechner/pi-ai";
import {
  type AgentToolResult,
  defineTool,
  type ExtensionContext,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

import { getApprovalRationale, hasExplicitApproval, WEALTH_APPROVAL_PREFIX } from "./approval.js";
import { defaultMemoryAuditPath, defaultWealthMemoryPath, writeMemoryMarkdown } from "./memory.js";
import { DEFAULT_WEALTH_SOUL_FALLBACK, defaultSoulAuditPath, writeSoulMarkdown } from "./soul.js";
import { createVisualizationArtifact, VisualizationValidationError } from "./visualization.js";
import type { WealthToolService } from "./wealthService.js";

const nonEmptyString = Type.String({ minLength: 1 });
const amountString = Type.String({ pattern: "^[-]?\\d+\\.\\d{2}$" });
const quantityString = Type.String({ pattern: "^\\d+(\\.\\d{1,8})?$" });
const executionModeSchema = Type.Optional(
  Type.Union([Type.Literal("execute"), Type.Literal("preview")]),
);
const idempotencyKeySchema = Type.Optional(Type.String({ maxLength: 50, minLength: 1 }));
const queryLimitSchema = Type.Optional(Type.Integer({ maximum: 500, minimum: 1 }));
const visualizationChartTypeSchema = Type.Union([
  Type.Literal("area"),
  Type.Literal("bar"),
  Type.Literal("line"),
  Type.Literal("pie"),
  Type.Literal("scatter"),
]);
const visualizationValueFormatSchema = Type.Optional(
  Type.Union([Type.Literal("currency"), Type.Literal("number"), Type.Literal("percent")]),
);
const visualizationPrimitiveSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
const visualizationDataRowSchema = Type.Record(Type.String(), visualizationPrimitiveSchema);
const visualizationSeriesSchema = Type.Object(
  {
    color: Type.Optional(nonEmptyString),
    dataKey: nonEmptyString,
    name: nonEmptyString,
    smooth: Type.Optional(Type.Boolean()),
    stack: Type.Optional(nonEmptyString),
    type: Type.Optional(visualizationChartTypeSchema),
    yAxis: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")])),
  },
  { additionalProperties: false },
);
const visualizationSortSchema = Type.Object(
  {
    by: nonEmptyString,
    order: Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
  },
  { additionalProperties: false },
);
const visualizationSpecSchema = Type.Object(
  {
    chartType: visualizationChartTypeSchema,
    data: Type.Array(visualizationDataRowSchema, { maxItems: 200, minItems: 1 }),
    donut: Type.Optional(Type.Boolean()),
    labelKey: Type.Optional(nonEmptyString),
    legend: Type.Optional(Type.Boolean()),
    series: Type.Array(visualizationSeriesSchema, { maxItems: 12, minItems: 1 }),
    showDataZoom: Type.Optional(Type.Boolean()),
    sort: Type.Optional(visualizationSortSchema),
    valueFormat: visualizationValueFormatSchema,
    xAxisLabel: Type.Optional(nonEmptyString),
    xKey: Type.Optional(nonEmptyString),
    yAxisLabel: Type.Optional(nonEmptyString),
    yAxisLabelRight: Type.Optional(nonEmptyString),
  },
  { additionalProperties: false },
);
type MutationParams = {
  readonly executionMode?: "execute" | "preview";
  readonly idempotencyKey?: string;
};

export interface CreateWealthToolsOptions {
  readonly agentDir?: string;
  readonly memoryAuditPath?: string;
  readonly memoryPath?: string;
  readonly soulAuditPath?: string;
  readonly soulPath?: string;
}

export const WEALTH_ALLOWED_TOOL_NAMES = [
  "list_accounts",
  "get_account",
  "list_account_activity",
  "list_holdings",
  "list_securities",
  "create_visualization",
  "move_cash",
  "list_cash_transfers",
  "get_cash_transfer",
  "submit_trade",
  "list_orders",
  "get_order",
  "update_soul",
  "update_memory",
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

function buildToolErrorText(
  toolName: string,
  payload: {
    error: string;
    issues?: readonly string[];
    retryHint?: string;
  },
): string {
  const lines = [`${toolName} failed.`, payload.error];

  if (payload.issues && payload.issues.length > 0) {
    lines.push("Issues:");
    lines.push(...payload.issues.map((issue) => `- ${issue}`));
  }

  if (payload.retryHint) {
    lines.push(`Retry hint: ${payload.retryHint}`);
  }

  return lines.join("\n");
}

function makeErrorResult(
  toolName: string,
  payload: Record<string, unknown> & {
    error: string;
    issues?: readonly string[];
    retryHint?: string;
  },
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: buildToolErrorText(toolName, payload) }],
    details: payload,
    isError: true,
  } as AgentToolResult<Record<string, unknown>>;
}

function createVisualizationErrorPayload(error: unknown): {
  error: string;
  issues: readonly string[];
  retryHint: string;
  retryable: true;
} {
  if (error instanceof VisualizationValidationError) {
    return {
      error: "Visualization validation failed.",
      issues: error.issues,
      retryHint: "Correct the visualization spec and call create_visualization again.",
      retryable: true,
    };
  }

  if (error instanceof Error) {
    return {
      error: "Visualization creation failed.",
      issues: [error.message],
      retryHint:
        "Adjust the visualization request and call create_visualization again with a corrected spec.",
      retryable: true,
    };
  }

  return {
    error: "Visualization creation failed.",
    issues: [String(error)],
    retryHint:
      "Adjust the visualization request and call create_visualization again with a corrected spec.",
    retryable: true,
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

export function createWealthTools(
  service: WealthToolService,
  options: CreateWealthToolsOptions = {},
): ToolDefinition[] {
  const defaultAgentDir =
    options.agentDir ?? path.join(process.cwd(), ".niven", "pi-wealth", "agent");
  const memoryPath = options.memoryPath ?? defaultWealthMemoryPath(defaultAgentDir);
  const memoryAuditPath = options.memoryAuditPath ?? defaultMemoryAuditPath(memoryPath);
  const soulPath = options.soulPath ?? fileURLToPath(new URL("../SOUL.md", import.meta.url));
  const soulAuditPath = options.soulAuditPath ?? defaultSoulAuditPath(soulPath);

  return [
    createReadTool({
      name: "list_accounts",
      label: "List Accounts",
      description: "List all sandbox accounts and their current balances.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const data = await service.listAccounts();
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
        const data = await service.getAccount(params.accountId);
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
        const data = await service.listAccountActivity(params.accountId, {
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
        const data = await service.listHoldings({
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
        const data = await service.listSecurities({
          limit: params.limit,
          query: params.query,
        });
        return makeResult("list_securities", data);
      },
    }),
    createReadTool({
      name: "create_visualization",
      label: "Create Visualization",
      description:
        "Create a structured chart or graph for inline chat rendering after you have gathered the relevant sandbox data. Use this when the user asks for a visual comparison, composition, trend, or distribution.",
      parameters: Type.Object(
        {
          altText: nonEmptyString,
          spec: visualizationSpecSchema,
          summary: nonEmptyString,
          title: Type.Optional(nonEmptyString),
          warnings: Type.Optional(Type.Array(nonEmptyString, { maxItems: 8 })),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        try {
          const artifact = createVisualizationArtifact({
            altText: params.altText,
            spec: params.spec,
            summary: params.summary,
            ...(params.title ? { title: params.title } : {}),
            ...(params.warnings ? { warnings: params.warnings } : {}),
          });
          return makeResult("create_visualization", artifact as unknown as Record<string, unknown>);
        } catch (error) {
          return makeErrorResult("create_visualization", createVisualizationErrorPayload(error));
        }
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
        const data = await service.transferCash({
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
        const data = await service.listTransfers({
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
        const data = await service.getTransfer(params.transferId);
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
        const data = await service.submitTrade({
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
        const data = await service.listOrders({
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
        const data = await service.getOrder(params.orderId);
        return makeResult("get_order", data);
      },
    }),
    createReadTool({
      name: "update_soul",
      label: "Update Soul",
      description:
        "Rewrite SOUL.md for future sessions. Use this when your tone, persona, or behavioral guidance should change. Trust your judgment and write the updated SOUL.md content directly.",
      parameters: Type.Object(
        {
          content: Type.String({ minLength: 1 }),
          reason: Type.Optional(Type.String({ maxLength: 280, minLength: 1 })),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await writeSoulMarkdown({
          auditPath: soulAuditPath,
          content: params.content,
          fallbackDocument: DEFAULT_WEALTH_SOUL_FALLBACK,
          ...(params.reason ? { reason: params.reason } : {}),
          soulPath,
        });

        return makeResult("update_soul", {
          appliesOnNextSession: true,
          auditPath: data.auditPath,
          contentBytes: Buffer.byteLength(data.content, "utf8"),
          futureSessionsOnly: true,
          soulPath: data.soulPath,
          updated: data.updated,
        });
      },
    }),
    createReadTool({
      name: "update_memory",
      label: "Update Memory",
      description:
        "Rewrite MEMORY.md for future sessions. Use this for durable user-specific context such as goals, preferences, risk tolerance, constraints, and plans. Do not store secrets or raw ephemeral account data.",
      parameters: Type.Object(
        {
          content: Type.String({ minLength: 1 }),
          reason: Type.Optional(Type.String({ maxLength: 280, minLength: 1 })),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, params) {
        const data = await writeMemoryMarkdown({
          auditPath: memoryAuditPath,
          content: params.content,
          memoryPath,
          ...(params.reason ? { reason: params.reason } : {}),
        });

        return makeResult("update_memory", {
          appliesOnNextSession: true,
          auditPath: data.auditPath,
          contentBytes: Buffer.byteLength(data.content, "utf8"),
          futureSessionsOnly: true,
          memoryPath: data.memoryPath,
          updated: data.updated,
        });
      },
    }),
  ];
}
