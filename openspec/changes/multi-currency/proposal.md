## Why

The product presents money in rubles only (change `currency-rub-only`,
2026-08-28): account forms hardcode RUB, every aggregate displays in RUB,
and there is no supported way to keep money in another currency. Real
users live in different countries with different home currencies and hold
accounts in more than one currency. The API contract stayed
multi-currency-ready on purpose, and `docs/assumptions.md` records the
intended direction (two-amount transfers, per-currency aggregates
converted into a single display currency, externally sourced rates); this
change executes that direction.

- The currency catalog grows from `USD/EUR/RUB` to 18 currencies, adding
  `TRY, GEL, KZT, UAH, AMD, AZN, UZS, KGS, RSD, ILS, AED, THB, CNY, PLN,
  GBP`. All are two-decimal, so the money invariant (int64 minor units,
  divisor 100) is untouched. The catalog stays a fixed list: the DB check
  constraint, the OpenAPI enum, and `@trata/money`'s currency map.
- Households gain a base currency: proposed by the client from the device
  locale at creation (server fallback RUB), editable by the owner,
  carried in household responses. It is the conversion target for
  presentation only - changing it never rewrites stored records.
- Both apps regain the account-creation currency picker (the ruble-only
  restriction is dropped) and gain a local, per-device display-currency
  preference defaulting to the household's base currency.
- Aggregates (account balances summaries, analytics totals, debts) are
  computed per currency and converted into the display currency for
  presentation. Converted figures are marked approximate («≈») and the
  rate date is shown; the native account currency stays visible on
  account and transaction rows.
- Transfers between accounts of different currencies carry two amounts -
  the source-account amount and the destination-account amount. The
  destination amount is suggested from the cached rate and stays
  editable before saving. No exchange-rate column is stored; the
  effective rate is derived from the two amounts. Same-currency
  transfers are unchanged.
- Debtors gain an immutable currency (defaulting to the household's base
  currency); debt operations inherit it, keeping each debtor's ledger
  single-currency.
- Planned payments need no currency field: every plan references exactly
  one live account and therefore inherits that account's currency.
- Exchange rates are fetched from open.er-api.com (no API key; CDN
  fallback documented), cached per device in the local database, and
  never synchronized through the sync protocol. Offline presentation
  falls back to the last cached rate and shows its date.
- The ruble-only `app-currency` requirements are replaced by the
  multi-currency presentation policy, and the analytics spec's
  "mixed-currency aggregation is intentionally undefined in v1" clause
  is replaced by per-currency totals with display-currency conversion.

## Capabilities

### New Capabilities

- `exchange-rates`: sourcing exchange rates from an external provider,
  the per-device cache and refresh/staleness rules, and how rate
  provenance (date, approximation) is presented in both apps.

### Modified Capabilities

- `app-currency`: the ruble-only presentation policy is replaced by the
  multi-currency policy - display-currency preference, approximate
  conversion marks, per-currency aggregates in both apps.
- `accounts`: the creation catalog widens and the currency picker
  returns; currency stays immutable after creation; balance semantics
  cover cross-currency transfers.
- `transactions`: the transfer shape gains the destination amount for
  cross-currency transfers, with validation and balance effects.
- `household`: the household gains a base currency with creation,
  editing, and exposure rules.
- `debts`: debtors gain an immutable currency that debt operations
  inherit.
- `analytics`: mixed-currency aggregation is defined - per-currency sums
  plus conversion into the display currency.
