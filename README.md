# Niven

## Plaid Sandbox Env

For local Plaid sandbox setup, put these in the repo root `.env` file:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV=sandbox`
- optional: `PLAID_COUNTRY_CODES=US`
- optional: `PLAID_PRODUCTS=transactions,investments,transfer`

## Wealth API

The repo now includes a Pi-ready internal API in [apps/wealth-api](/Users/allisonmahmood/Dev/Niven/apps/wealth-api) plus a package-first finance layer in [packages/wealth-tools](/Users/allisonmahmood/Dev/Niven/packages/wealth-tools) backed by [packages/plaid-client](/Users/allisonmahmood/Dev/Niven/packages/plaid-client).

Start it with:

```bash
pnpm api:start
```

For local development:

```bash
pnpm api:dev
```

The API is sandbox-only, single-user, stores Plaid access tokens/cursors in a gitignored local JSON store under `.niven/`, and supports:

- linked sandbox item creation
- accounts and balances reads
- transaction sync plus cached transaction history queries
- investment holdings and investment transaction reads
- Plaid Transfer authorization, creation, cancellation, and recurring transfer flows
- dry-run, idempotency, audit logging, and optional approval enforcement via `NIVEN_REQUIRE_MUTATION_APPROVAL=true`
