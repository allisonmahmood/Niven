import {
  type EnvMap,
  NivenError,
  readCsvEnv,
  readOptionalEnv,
  readRequiredEnv,
} from "@niven/shared";

export interface PlaidClientEnv {
  readonly clientId: string;
  readonly secret: string;
  readonly environment: PlaidEnvironmentName;
  readonly countryCodes: readonly string[];
  readonly products: readonly string[];
}

export type PlaidEnvironmentName = "development" | "production" | "sandbox";

function parseEnvironment(value: string | undefined): PlaidEnvironmentName {
  const environment = value?.trim() || "sandbox";

  if (environment === "development" || environment === "production" || environment === "sandbox") {
    return environment;
  }

  throw new NivenError(`Unsupported Plaid environment: ${environment}`);
}

export function readValidatedPlaidClientEnv(env: EnvMap = process.env): PlaidClientEnv {
  return {
    clientId: readRequiredEnv("PLAID_CLIENT_ID", env),
    secret: readRequiredEnv("PLAID_SECRET", env),
    environment: parseEnvironment(readOptionalEnv("PLAID_ENV", env)),
    countryCodes: readCsvEnv("PLAID_COUNTRY_CODES", env).length
      ? readCsvEnv("PLAID_COUNTRY_CODES", env)
      : ["US"],
    products: readCsvEnv("PLAID_PRODUCTS", env),
  };
}

export const readPlaidClientEnv = readValidatedPlaidClientEnv;
