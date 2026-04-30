import type { SandboxService } from "@niven/wealth-sandbox";

export type WealthToolService = Pick<
  SandboxService,
  | "getAccount"
  | "getConfig"
  | "getOrder"
  | "getTransfer"
  | "listAccountActivity"
  | "listAccounts"
  | "listHoldings"
  | "listOrders"
  | "listSecurities"
  | "listTransfers"
  | "submitTrade"
  | "transferCash"
>;
