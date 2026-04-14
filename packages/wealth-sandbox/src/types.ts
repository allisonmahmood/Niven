export type SandboxAccountCategory =
  | "cash"
  | "credit"
  | "investment"
  | "loan"
  | "restricted_cash"
  | "other";

export interface SandboxSnapshotMetadata {
  readonly importedAt: string;
  readonly importedAccountCount: number;
  readonly importedHoldingCount: number;
  readonly importedSecurityCount: number;
  readonly importedTransactionCount: number;
  readonly source: "plaid_sandbox";
}

export interface SandboxAccountRecord {
  readonly accountId: string;
  readonly category: SandboxAccountCategory;
  readonly creditLimitMicros: string | null;
  readonly currencyCode: string;
  cashBalanceMicros: string | null;
  availableCashMicros: string | null;
  readonly holderCategory: string | null;
  readonly importedAt: string;
  readonly mask: string | null;
  readonly name: string;
  readonly officialName: string | null;
  readonly permissions: {
    readonly canTrade: boolean;
    readonly canTransfer: boolean;
  };
  readonly plaidAccountId: string;
  readonly sourceLabel: string;
  readonly staticAvailableBalanceMicros: string | null;
  readonly staticCurrentBalanceMicros: string | null;
  readonly subtype: string | null;
  readonly type: string;
}

export interface SandboxSecurityRecord {
  readonly currencyCode: string;
  readonly importedAt: string;
  readonly isCashSecurity: boolean;
  readonly name: string;
  priceMicros: string;
  readonly plaidSecurityId: string;
  readonly priceAsOf: string | null;
  readonly securityId: string;
  readonly subtype: string | null;
  readonly symbol: string | null;
  readonly type: string | null;
}

export interface SandboxPositionRecord {
  readonly accountId: string;
  costBasisMicros: string;
  readonly createdAt: string;
  readonly positionId: string;
  quantityAtoms: string;
  readonly securityId: string;
  updatedAt: string;
}

export interface SandboxImportedTransactionRecord {
  readonly accountId: string;
  readonly amountMicros: string;
  readonly date: string;
  readonly importedAt: string;
  readonly merchantName: string | null;
  readonly name: string;
  readonly pending: boolean;
  readonly plaidTransactionId: string;
  readonly sourceLabel: string;
  readonly transactionId: string;
}

export interface SandboxTransferRecord {
  readonly amountMicros: string;
  readonly approvalRationale: string | null;
  readonly createdAt: string;
  readonly description: string | null;
  readonly fromAccountId: string;
  readonly idempotencyKey: string;
  readonly transferId: string;
  readonly toAccountId: string;
}

export interface SandboxOrderRecord {
  readonly accountId: string;
  readonly approvalRationale: string | null;
  readonly createdAt: string;
  readonly grossAmountMicros: string;
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly priceMicros: string;
  readonly quantityAtoms: string;
  readonly securityId: string;
  readonly side: "buy" | "sell";
}

export interface SandboxEventRecord {
  readonly accountIds: readonly string[];
  readonly createdAt: string;
  readonly entityId: string;
  readonly eventId: string;
  readonly payload: Record<string, string | number | boolean | null | readonly string[]>;
  readonly type: "order_executed" | "snapshot_imported" | "transfer_executed";
}

interface StoredIdempotencyRecord {
  readonly createdAt: string;
  readonly operation: string;
  readonly response: unknown;
  readonly scope: string;
}

export interface SandboxState {
  readonly version: 1;
  accounts: Record<string, SandboxAccountRecord>;
  events: SandboxEventRecord[];
  idempotency: Record<string, StoredIdempotencyRecord>;
  importedTransactions: Record<string, SandboxImportedTransactionRecord>;
  orders: Record<string, SandboxOrderRecord>;
  positions: Record<string, SandboxPositionRecord>;
  securities: Record<string, SandboxSecurityRecord>;
  snapshot: SandboxSnapshotMetadata | null;
  transfers: Record<string, SandboxTransferRecord>;
}

export interface MutationControlInput {
  readonly approval?: {
    readonly approved?: boolean;
    readonly approvedBy?: string;
    readonly rationale?: string;
  };
  readonly dryRun?: boolean;
  readonly idempotencyKey: string;
}

export interface SandboxRuntimeConfig {
  readonly auditPath: string;
  readonly dataDirectory: string;
  readonly requireMutationApproval: boolean;
  readonly statePath: string;
}
