## 1. Design mockup

- [ ] 1.1 Superdesign mockup: accounts summary with per-currency totals, «≈» converted total, rate date, and the account form with the 18-currency picker; update `.superdesign/design-system.md` money rules (replace the RUB-only rule); pass `pnpm lint:design`

## 2. Shared packages

- [ ] 2.1 `@trata/money`: widen the catalog to 18 currencies (symbols, en/ru formats); add `fetchLatestRates()` (open.er-api.com, fawazahmed0 fallback documented), `convert(minor, from, to, rates)` with cross-rate and single half-up rounding, and types; unit tests: cross rate, rounding, missing pair, provider-failure parse
- [ ] 2.2 `@trata/i18n`: currency names and new presentation strings (en/ru), reword `transferAccountsMustMatchCurrency`, reuse `defaultCurrency` for the display-currency setting

## 3. Contract

- [ ] 3.1 `docs/api/openapi.yaml`: widen the `AccountCurrency` enum to the 18-currency catalog; `currency` on the Household response and the owner-only household update; optional `destinationAmount` on transfer create/update/response; `currency` on debtor create (optional) and all debtor responses; pass redocly lint

## 4. Backend

- [ ] 4.1 Appended migration: widen the `accounts.currency` CHECK; `households.currency` (NOT NULL, catalog CHECK, default RUB); `debtors.currency` (NOT NULL, catalog CHECK, backfill RUB); `transactions.destination_amount` (nullable bigint)
- [ ] 4.2 `make gen` + `pnpm gen:api`; regenerate and commit generated code (`make gen-check` green)
- [ ] 4.3 sqlc queries/models + domain: transfer create/update validates the destination-amount iff-rule against the effective accounts and rejects zero/negative; balance computation adds `COALESCE(destination_amount, amount)` to the destination
- [ ] 4.4 Household service: base currency defaults RUB at implicit creation, owner-only update via the household management surface, returned in household responses
- [ ] 4.5 Debtor service: currency defaults to the household base on create, immutable on update; debt operations validate against the debtor's currency rules
- [ ] 4.6 Backend tests: cross-currency transfer balances, destination-amount rejections (missing/zero/same-currency), debtor currency default and immutability, household base currency default and owner-only change; `golangci-lint` green

## 5. Web app

- [ ] 5.1 Settings: display-currency field in the settings store and localStorage schema (bump the schema version), selector on the settings screen; resolution chain display → household base → `DEFAULT_CURRENCY`
- [ ] 5.2 Account form: restore the currency picker (catalog, household base preselected); drop the hardcoded `DEFAULT_CURRENCY` submit; update the "no currency field" tests
- [ ] 5.3 Local rates: cache table in web local-data, refresh at session boundaries and on explicit action, as-of date surfaced; non-fatal refresh failure
- [ ] 5.4 Aggregates: per-currency totals + «≈» converted total with rate date on the accounts summary and dashboard; transaction rows stay native
- [ ] 5.5 Household settings: owner base-currency editor; one-time locale suggestion when the household is still on default RUB
- [ ] 5.6 Debts screens: debtor currency at creation (default household base), per-debtor-currency presentation with conversion
- [ ] 5.7 Web tests: display-currency preference, converted aggregates with missing-rate degradation, picker submit

## 6. Mobile app

- [ ] 6.1 Settings screen: display-currency selector; local rates table + session-boundary refresh; as-of surfaced
- [ ] 6.2 New-account form: restore the currency picker; remove the RUB-only mapper; account rows keep native currency labels
- [ ] 6.3 Transfer form: cross-currency flow (source amount, destination amount suggested from the cached rate, editable), remove the same-currency-only rule; same-currency flow unchanged
- [ ] 6.4 Home/analytics/debts: per-currency figures + «≈» converted totals per the analytics delta; donut and percentages follow converted figures; missing-rate degradation
- [ ] 6.5 Mobile tests: conversion presentation, transfer flow, rates cache staleness

## 7. Docs and gates

- [ ] 7.1 ADR-0008: multi-currency presentation and rates (decisions 2-9 of design.md)
- [ ] 7.2 Prune the `docs/assumptions.md` multi-currency entry; record the two refinements (planned payments need no currency field; no stored rate column - two amounts pin the rate)
- [ ] 7.3 Full gates: `pnpm arch:check`, `pnpm knip`, `pnpm lint:design`, `make gen-check`, backend tests, package and app type-checks
