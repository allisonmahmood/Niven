import { NotImplementedYetError } from "@niven/shared";

export interface ExchangedPublicToken {
  readonly itemId: string;
  readonly accessToken: string;
}

export async function exchangePublicTokenPlaceholder(
  publicToken: string,
): Promise<ExchangedPublicToken> {
  void publicToken;
  throw new NotImplementedYetError("Plaid public token exchange");
}
