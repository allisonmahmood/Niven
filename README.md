# Niven

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Create a local env file from the example:

```bash
cp .env.example .env
```

3. Fill in the required Plaid Sandbox credentials in `.env`:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV=sandbox`

Optional:

- `NIVEN_API_TOKEN` if you want the local API to require a bearer token
- `NIVEN_API_PORT` if you do not want to use the default `4321`

4. Pull the sample snapshot from Plaid Sandbox into the local sandbox:

```bash
pnpm sandbox:reset-from-plaid
```

5. Start the local API:

```bash
pnpm api:start
```

6. Authenticate Pi once:

```bash
pnpm harness:login
```

7. Start the chat session:

```bash
pnpm harness:chat
```

At that point you can ask things like:

- `what are my accounts and balances?`
- `show me my holdings`
- `preview moving 5.00 from account <from_account_id> to account <to_account_id>`
- `APPROVE: move 5.00 from account <from_account_id> to account <to_account_id>`

## Notes

- If you want to reset the local sandbox back to the Plaid sample snapshot, run `pnpm sandbox:reset-from-plaid` again.
- If you set `NIVEN_API_TOKEN`, the harness will automatically use it from your `.env`.
- For one-off prompts instead of chat, use:

```bash
pnpm harness:prompt -- "what are my accounts and balances?"
```
