import { isRecord, ValidationError } from "@niven/shared";
import type { SandboxService } from "@niven/wealth-sandbox";

const DEFAULT_DESCRIPTION = "Payday";
const DEFAULT_TARGET_ACCOUNT_NAME = "Plaid Checking";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface SandboxCashAccountSummary {
  readonly accountId: string;
  readonly mask?: string;
  readonly name: string;
  readonly subtype?: string | null;
  readonly type: string;
}

export interface SandboxPaydayInput {
  readonly accountId?: string;
  readonly amount: string;
  readonly date: string;
  readonly description: string;
  readonly idempotencyKey?: string;
}

export interface SandboxPaydayResult {
  readonly account: SandboxCashAccountSummary;
  readonly amount: string;
  readonly date: string;
  readonly deposit: Record<string, unknown>;
}

type SandboxPaydayService = Pick<SandboxService, "depositCash" | "listAccounts">;

export function getSandboxPaydayUsage(): string {
  return [
    "Usage:",
    "  pnpm sandbox:payday -- --amount <usd> [--account <accountId>] [--date YYYY-MM-DD]",
    "Examples:",
    "  pnpm sandbox:payday -- --amount 2400",
    '  pnpm sandbox:payday -- --amount 2400 --description "Payroll" --account <accountId>',
  ].join("\n");
}

export function parseSandboxPaydayCliArgs(
  args: readonly string[],
  now: () => string = () => new Date().toISOString(),
): SandboxPaydayInput {
  let accountId: string | undefined;
  let amount: string | undefined;
  let date: string | undefined;
  let description = DEFAULT_DESCRIPTION;
  let idempotencyKey: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case "--":
        break;
      case "--account":
      case "-a":
        accountId = parseNonEmptyValue(readArgumentValue(args, index, argument), "account");
        index += 1;
        break;
      case "--amount":
        amount = parseAmount(readArgumentValue(args, index, argument));
        index += 1;
        break;
      case "--date":
        date = parseDate(readArgumentValue(args, index, argument), "date");
        index += 1;
        break;
      case "--description":
        description = parseNonEmptyValue(readArgumentValue(args, index, argument), "description");
        index += 1;
        break;
      case "--idempotency-key":
        idempotencyKey = parseIdempotencyKey(readArgumentValue(args, index, argument));
        index += 1;
        break;
      default:
        throw new ValidationError(`Unknown argument: ${argument}`);
    }
  }

  if (!amount) {
    throw new ValidationError("Missing required --amount argument.");
  }

  return {
    ...(accountId ? { accountId } : {}),
    amount,
    date: date ?? parseDate(now().slice(0, 10), "date"),
    description,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export async function runSandboxPayday(
  service: SandboxPaydayService,
  input: SandboxPaydayInput,
): Promise<SandboxPaydayResult> {
  const account = await resolvePaydayAccount(service, input.accountId);
  const idempotencyKey =
    input.idempotencyKey ?? makeDefaultIdempotencyKey(account.accountId, input);
  const deposit = await service.depositCash({
    accountId: account.accountId,
    amount: input.amount,
    control: {
      approval: {
        approved: true,
      },
      idempotencyKey,
    },
    date: input.date,
    description: input.description,
  });

  return {
    account,
    amount: input.amount,
    date: input.date,
    deposit,
  };
}

async function resolvePaydayAccount(
  service: Pick<SandboxPaydayService, "listAccounts">,
  requestedAccountId: string | undefined,
): Promise<SandboxCashAccountSummary> {
  const response = await service.listAccounts();
  const accounts = readCheckingAccounts(response);

  if (accounts.length === 0) {
    throw new ValidationError("No depositable checking accounts were found in the local sandbox.");
  }

  if (requestedAccountId) {
    const account = accounts.find((entry) => entry.accountId === requestedAccountId);

    if (!account) {
      throw new ValidationError(`Sandbox account ${requestedAccountId} was not found.`);
    }

    return account;
  }

  const preferred = accounts.find((account) => account.name === DEFAULT_TARGET_ACCOUNT_NAME);

  if (preferred) {
    return preferred;
  }

  if (accounts.length === 1) {
    return accounts[0] as SandboxCashAccountSummary;
  }

  throw new ValidationError(
    `Multiple checking accounts are available. Pass --account with one of: ${accounts.map((account) => `${account.accountId} (${account.name}${account.mask ? ` ...${account.mask}` : ""})`).join(", ")}`,
  );
}

function readCheckingAccounts(
  value: Record<string, unknown>,
): readonly SandboxCashAccountSummary[] {
  const accounts = value.accounts;

  if (!Array.isArray(accounts)) {
    throw new Error("Sandbox service listAccounts() returned an unexpected payload.");
  }

  return accounts.flatMap((account) => {
    if (!isRecord(account)) {
      throw new Error("Sandbox service listAccounts() returned an unexpected account payload.");
    }

    if (account.type !== "depository" || account.subtype !== "checking") {
      return [];
    }

    if (typeof account.accountId !== "string" || typeof account.name !== "string") {
      throw new Error("Sandbox service listAccounts() returned an unexpected checking account.");
    }

    return [
      {
        accountId: account.accountId,
        ...(typeof account.mask === "string" ? { mask: account.mask } : {}),
        name: account.name,
        subtype: typeof account.subtype === "string" ? account.subtype : null,
        type: "depository",
      },
    ];
  });
}

function readArgumentValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("-")) {
    throw new ValidationError(`Missing value for ${flag}.`);
  }

  return value;
}

function parseAmount(value: string): string {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError("Amount must be a positive number.");
  }

  if (Math.round(parsed * 100) !== parsed * 100) {
    throw new ValidationError("Amount must use at most two decimal places.");
  }

  return parsed.toFixed(2);
}

function parseDate(value: string, fieldName: string): string {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new ValidationError(`${capitalize(fieldName)} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${capitalize(fieldName)} must be a real calendar date.`);
  }

  return value;
}

function parseIdempotencyKey(value: string): string {
  const key = parseNonEmptyValue(value, "idempotency key");

  if (key.length > 50) {
    throw new ValidationError("Idempotency key must be 50 characters or fewer.");
  }

  return key;
}

function parseNonEmptyValue(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new ValidationError(`${capitalize(fieldName)} must not be empty.`);
  }

  return trimmed;
}

function makeDefaultIdempotencyKey(accountId: string, input: SandboxPaydayInput): string {
  const cents = input.amount.replace(".", "");
  const compactAccountId = accountId.slice(0, 8);
  return `payday-${compactAccountId}-${input.date}-${cents}`.slice(0, 50);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
