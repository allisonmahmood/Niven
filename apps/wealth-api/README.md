# Wealth API

Internal HTTP API for the sandbox-only Plaid interface. This is intentionally separate from Pi wiring so the next step can be connecting Pi to stable endpoints instead of building finance primitives inline.

## Run

```bash
pnpm api:dev
```

or

```bash
pnpm api:start
```

Defaults:

- host: `127.0.0.1`
- port: `4321`

Optional auth:

- set `NIVEN_API_TOKEN`
- send `Authorization: Bearer <token>`

## Key Endpoints

- `GET /health`
- `GET /v1/config`
- `GET /v1/items`
- `POST /v1/items/sandbox/link`
- `GET /v1/items/:itemId`
- `GET /v1/items/:itemId/accounts`
- `GET /v1/items/:itemId/balances`
- `POST /v1/items/:itemId/transactions/sync`
- `POST /v1/items/:itemId/transactions/refresh`
- `GET /v1/items/:itemId/transactions`
- `POST /v1/items/:itemId/transactions/sandbox/create`
- `GET /v1/items/:itemId/investments/holdings`
- `GET /v1/items/:itemId/investments/transactions`
- `GET /v1/transfers/configuration`
- `GET /v1/transfers/balance`
- `GET /v1/items/:itemId/accounts/:accountId/transfers/capabilities`
- `POST /v1/items/:itemId/accounts/:accountId/transfers/authorize`
- `POST /v1/items/:itemId/accounts/:accountId/transfers`
- `GET /v1/transfers`
- `GET /v1/transfers/:transferId`
- `POST /v1/transfers/:transferId/cancel`
- `GET /v1/transfers/recurring`
- `POST /v1/items/:itemId/accounts/:accountId/transfers/recurring`
- `POST /v1/transfers/recurring/:recurringTransferId/cancel`

## Guardrails

- all mutations require an `idempotencyKey`
- all mutations support `dryRun`
- approvals can be enforced globally with `NIVEN_REQUIRE_MUTATION_APPROVAL=true`
- audit events are written to `.niven/audit.log`
- Plaid access tokens stay server-side in `.niven/wealth-store.json`
