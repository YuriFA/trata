## Why

The product ships a three-currency facade: accounts carry a `USD/EUR/RUB`
enum, but every aggregate that crosses accounts (analytics totals, debts,
plans, the API's net worth) sums minor units across currencies and labels
the result with one symbol. The user's real finances are ruble-only, the
web defaults to `USD` (shared `DEFAULT_CURRENCY`), and currency pickers
add noise in three places. Multi-currency done right (rates, two-amount
transfers, converted aggregates) is a future change; today the currency
machinery only gets in the way.

## What Changes

- Both apps become **ruble-only in the UI**: account creation forms (web
  and mobile) lose the currency field and always create RUB accounts;
  currency-less aggregates (debts, plans, analytics totals) display in
  RUB.
- The web settings screen loses the currency selector; the `currency`
  field is removed from the settings store and its localStorage schema.
- `DEFAULT_CURRENCY` in `@trata/money` changes from `USD` to
  `RUB`, becoming the single source of the app display currency.
- The mobile account list keeps its per-account currency label (shows
  `RUB`, so it stays meaningful).
- The web dashboard net-worth empty state stops hardcoding `USD`.
- **BREAKING**: `GET /accounts/balances` (`AccountBalancesResponse`,
  `AccountBalance` schemas) is removed from the OpenAPI contract together
  with its backend handler/service/repository. Its `netWorth` was a
  cross-currency minor-unit sum and no client consumes the endpoint; both
  apps already compute per-currency totals client-side from the account
  listing.
- The API itself stays multi-currency-ready: the `USD/EUR/RUB` enum on
  accounts, server validation, and the sync protocol are unchanged.
- The same-currency rule for transfer endpoints stays in both apps' UI.
- `docs/assumptions.md` records the multi-currency direction (two-amount
  transfers with a rate snapshot, per-currency totals with conversion into
  a display currency) so the future change starts from a written decision.

## Capabilities

### New Capabilities

- `app-currency`: the product's currency policy - ruble-only presentation
  in both apps (account creation fixed to RUB, currency-less aggregates
  displayed in RUB) over a contract that still accepts the wider currency
  enum, keeping the system multi-currency-ready.

### Modified Capabilities

- `accounts`: remove the "Balances summary and net worth" requirement -
  the endpoint leaves the contract; the Deletion guard requirement drops
  its references to the balances summary and net worth.

## Impact

- **OpenAPI + generated code**: `docs/api/openapi.yaml` (remove path +
  schemas), regen `make gen` (backend) and `pnpm gen:api` (`packages/api`).
- **Backend**: transport handler, service, repository method, sqlc query,
  domain `AccountBalance` type removed.
- **Web**: settings store + settings screen (currency selector, locale
  keys), add-account form (currency field + validation + locale keys),
  debts/plans/analytics display currency sources, dashboard empty state.
- **Mobile**: new-account form (currency picker + validation), account
  list unchanged (label stays).
- **Packages**: `@trata/money` `DEFAULT_CURRENCY` → `RUB`.
- **Docs**: `docs/assumptions.md` multi-currency direction entry.
- No data migration: no production databases exist; dev databases are
  resettable.
