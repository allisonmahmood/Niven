import { ValidationError } from "@niven/shared";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { TypeSystem } from "@sinclair/typebox/system";
import { Value } from "@sinclair/typebox/value";

const nonEmptyString = Type.String({ minLength: 1 });
const dateString = Type.String({ format: "date" });
const isoDateTimeString = Type.String({ format: "date-time" });
const amountString = Type.String({ pattern: "^[-]?\\d+\\.\\d{2}$" });

registerDateFormat();

export const approvalSchema = Type.Object(
  {
    approvalCode: Type.Optional(nonEmptyString),
    approved: Type.Boolean(),
    approvedBy: Type.Optional(nonEmptyString),
    rationale: Type.Optional(nonEmptyString),
  },
  { additionalProperties: false },
);

export type ApprovalInput = Static<typeof approvalSchema>;

export const mutationControlSchema = Type.Object(
  {
    approval: Type.Optional(approvalSchema),
    dryRun: Type.Optional(Type.Boolean()),
    idempotencyKey: Type.String({ maxLength: 50, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type MutationControlInput = Static<typeof mutationControlSchema>;

export const sandboxLinkSchema = Type.Object(
  {
    control: mutationControlSchema,
    initialProducts: Type.Array(nonEmptyString, { minItems: 1 }),
    institutionId: nonEmptyString,
    password: Type.Optional(nonEmptyString),
    transactions: Type.Optional(
      Type.Object(
        {
          daysRequested: Type.Optional(Type.Integer({ minimum: 1 })),
          endDate: Type.Optional(dateString),
          startDate: Type.Optional(dateString),
        },
        { additionalProperties: false },
      ),
    ),
    username: Type.Optional(nonEmptyString),
    webhook: Type.Optional(Type.String({ format: "uri" })),
  },
  { additionalProperties: false },
);

export type SandboxLinkInput = Static<typeof sandboxLinkSchema>;

export const transactionQuerySchema = Type.Object(
  {
    accountId: Type.Optional(nonEmptyString),
    endDate: Type.Optional(dateString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    pending: Type.Optional(Type.Boolean()),
    query: Type.Optional(nonEmptyString),
    refresh: Type.Optional(Type.Boolean()),
    startDate: Type.Optional(dateString),
  },
  { additionalProperties: false },
);

export type TransactionQueryInput = Static<typeof transactionQuerySchema>;

export const investmentTransactionQuerySchema = Type.Object(
  {
    accountIds: Type.Optional(Type.Array(nonEmptyString, { minItems: 1 })),
    endDate: dateString,
    startDate: dateString,
  },
  { additionalProperties: false },
);

export type InvestmentTransactionQueryInput = Static<typeof investmentTransactionQuerySchema>;

export const transferUserAddressSchema = Type.Object(
  {
    city: Type.Optional(nonEmptyString),
    country: Type.Optional(nonEmptyString),
    postalCode: Type.Optional(nonEmptyString),
    region: Type.Optional(nonEmptyString),
    street: Type.Optional(nonEmptyString),
  },
  { additionalProperties: false },
);

export const transferUserSchema = Type.Object(
  {
    address: Type.Optional(transferUserAddressSchema),
    emailAddress: Type.Optional(Type.String({ format: "email" })),
    legalName: nonEmptyString,
    phoneNumber: Type.Optional(nonEmptyString),
  },
  { additionalProperties: false },
);

export const transferDeviceSchema = Type.Object(
  {
    ipAddress: Type.Optional(nonEmptyString),
    userAgent: Type.Optional(nonEmptyString),
  },
  { additionalProperties: false },
);

export const transferAuthorizationSchema = Type.Object(
  {
    achClass: Type.Optional(
      Type.Union([
        Type.Literal("ccd"),
        Type.Literal("ppd"),
        Type.Literal("tel"),
        Type.Literal("web"),
      ]),
    ),
    amount: amountString,
    control: mutationControlSchema,
    device: Type.Optional(transferDeviceSchema),
    network: Type.Union([Type.Literal("ach"), Type.Literal("same-day-ach"), Type.Literal("rtp")]),
    requestGuarantee: Type.Optional(Type.Boolean()),
    type: Type.Union([Type.Literal("credit"), Type.Literal("debit")]),
    user: transferUserSchema,
    userPresent: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type TransferAuthorizationInput = Static<typeof transferAuthorizationSchema>;

export const transferCreateSchema = Type.Object(
  {
    amount: Type.Optional(amountString),
    authorizationId: nonEmptyString,
    control: mutationControlSchema,
    description: Type.String({ maxLength: 15, minLength: 1 }),
    metadata: Type.Optional(Type.Record(nonEmptyString, Type.String())),
  },
  { additionalProperties: false },
);

export type TransferCreateInput = Static<typeof transferCreateSchema>;

export const transferListSchema = Type.Object(
  {
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    endDate: Type.Optional(isoDateTimeString),
    fundingAccountId: Type.Optional(nonEmptyString),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    startDate: Type.Optional(isoDateTimeString),
  },
  { additionalProperties: false },
);

export type TransferListInput = Static<typeof transferListSchema>;

export const transferBalanceQuerySchema = Type.Object(
  {
    type: Type.Optional(
      Type.Union([Type.Literal("prefunded_ach_credits"), Type.Literal("prefunded_rtp_credits")]),
    ),
  },
  { additionalProperties: false },
);

export type TransferBalanceQueryInput = Static<typeof transferBalanceQuerySchema>;

export const cancelTransferSchema = Type.Object(
  {
    control: mutationControlSchema,
    reasonCode: Type.Optional(
      Type.Union([
        Type.Literal("AC03"),
        Type.Literal("AC14"),
        Type.Literal("AM06"),
        Type.Literal("AM09"),
        Type.Literal("BE05"),
        Type.Literal("CUST"),
        Type.Literal("DUPL"),
        Type.Literal("FOCR"),
        Type.Literal("FRAD"),
        Type.Literal("MS02"),
        Type.Literal("MS03"),
        Type.Literal("RR04"),
        Type.Literal("RUTA"),
        Type.Literal("TECH"),
        Type.Literal("UPAY"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export type CancelTransferInput = Static<typeof cancelTransferSchema>;

export const recurringTransferScheduleSchema = Type.Object(
  {
    intervalCount: Type.Integer({ minimum: 1 }),
    intervalExecutionDay: Type.Integer(),
    intervalUnit: Type.Union([Type.Literal("month"), Type.Literal("week")]),
    startDate: dateString,
  },
  { additionalProperties: false },
);

export const recurringTransferSchema = Type.Object(
  {
    achClass: Type.Optional(
      Type.Union([
        Type.Literal("ccd"),
        Type.Literal("ppd"),
        Type.Literal("tel"),
        Type.Literal("web"),
      ]),
    ),
    amount: amountString,
    control: mutationControlSchema,
    description: Type.String({ maxLength: 15, minLength: 1 }),
    device: Type.Optional(transferDeviceSchema),
    network: Type.Union([Type.Literal("ach"), Type.Literal("same-day-ach"), Type.Literal("rtp")]),
    schedule: recurringTransferScheduleSchema,
    testClockId: Type.Optional(nonEmptyString),
    type: Type.Union([Type.Literal("credit"), Type.Literal("debit")]),
    user: transferUserSchema,
    userPresent: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type RecurringTransferInput = Static<typeof recurringTransferSchema>;

export const recurringTransferListSchema = Type.Object(
  {
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    endTime: Type.Optional(isoDateTimeString),
    fundingAccountId: Type.Optional(nonEmptyString),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    startTime: Type.Optional(isoDateTimeString),
  },
  { additionalProperties: false },
);

export type RecurringTransferListInput = Static<typeof recurringTransferListSchema>;

export const sandboxTransactionsCreateSchema = Type.Object(
  {
    control: mutationControlSchema,
    transactions: Type.Array(
      Type.Object(
        {
          amount: Type.Number(),
          datePosted: dateString,
          dateTransacted: dateString,
          description: nonEmptyString,
          isoCurrencyCode: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

export type SandboxTransactionsCreateInput = Static<typeof sandboxTransactionsCreateSchema>;

export const sandboxWebhookSchema = Type.Object(
  {
    control: mutationControlSchema,
    webhookCode: nonEmptyString,
    webhookType: Type.Optional(nonEmptyString),
  },
  { additionalProperties: false },
);

export type SandboxWebhookInput = Static<typeof sandboxWebhookSchema>;

export function validateSchema<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) {
    const details = [...Value.Errors(schema, value)].map((error) => {
      return {
        message: error.message,
        path: error.path || "/",
        value: error.value,
      };
    });

    throw new ValidationError("Request validation failed.", details);
  }

  return value as Static<T>;
}

function registerDateFormat(): void {
  try {
    TypeSystem.Format("date", (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }

      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
    });
  } catch {
    // Ignore duplicate registrations when this module is re-evaluated in tests.
  }
}
