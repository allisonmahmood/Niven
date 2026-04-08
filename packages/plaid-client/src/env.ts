import { type EnvMap, readOptionalEnv } from "@niven/shared";

export interface PlaidClientEnv {
  readonly clientId: string | undefined;
  readonly secret: string | undefined;
  readonly environment: string;
  readonly countryCodes: readonly string[];
  readonly products: readonly string[];
}

function parseCsv(value: string | undefined): readonly string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function readPlaidClientEnv(env: EnvMap = process.env): PlaidClientEnv {
  return {
    clientId: readOptionalEnv("PLAID_CLIENT_ID", env),
    secret: readOptionalEnv("PLAID_SECRET", env),
    environment: readOptionalEnv("PLAID_ENV", env) ?? "sandbox",
    countryCodes: parseCsv(readOptionalEnv("PLAID_COUNTRY_CODES", env) ?? "US"),
    products: parseCsv(readOptionalEnv("PLAID_PRODUCTS", env)),
  };
}
