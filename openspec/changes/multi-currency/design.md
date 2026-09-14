## Context

The contract is already multi-currency-ready: `accounts.currency` exists
in the DB check constraint and the OpenAPI enum, and the sync protocol
carries it. The 2026-08-28 ruble-only change cut only the UI (pickers,
settings field, `DEFAULT_CURRENCY` USD→RUB, `GET /accounts/balances`).
`@trata/money` formats three currencies but has no conversion and
hardcodes `toMinorUnits × 100`; no settings surface exists anywhere
(server, web store, mobile). `docs/assumptions.md` records the
multi-currency direction (two-amount transfers, per-currency aggregates
converted into a display currency, externally sourced rates) and hands
the undecided points - rate source, storage, precision - to this change.
Dev databases are resettable; no production data exists.

## Goals / Non-Goals

**Goals:**

- One coherent conversion model: stored amounts stay native and exact;
  conversion happens only at presentation, on aggregates, rounded once.
- Rates with zero backend involvement: per-device cache, stale-tolerant.
- Cross-currency transfers that store exact values (two amounts), not
  derivations.
- The catalog stays a fixed list (no free-form currencies).

**Non-Goals:**

- Per-transaction rate snapshots (only transfers pin values, via their
  two amounts).
- A synchronized or per-user currency preference; the display currency
  is per-device.
- Currencies with 0 or 3 decimal digits (`minor_units` column, invariant
  #2 revision, and its ADR are deferred until a real currency demands
  it).
- Manual rate overrides (additive later, if wanted).
- Restoring `GET /accounts/balances`.
- Historical rate series or backfilling.

## Decisions

1. **Catalog lands in one coordinated commit across its three homes**:
   the DB check constraint (new appended migration widening it), the
   OpenAPI enum (then `make gen` + `pnpm gen:api`), and `@trata/money`'s
   currency map (symbol + en/ru formatting already handles the shape).
   USD, EUR, RUB + TRY, GEL, KZT, UAH, AMD, AZN, UZS, KGS, RSD, ILS,
   AED, THB, CNY, PLN, GBP - 18 currencies, all two-decimal.

2. **Household base currency** is a `currency` column on `households`
   (NOT NULL, catalog CHECK, default `RUB` at implicit creation),
   editable by the owner via the existing household management surface,
   returned in household responses. It never enters the change log -
   devices already fetch the household at session boundaries, and that
   fetch carries it. Spec prose says "base currency" to avoid colliding
   with the household spec's existing "household currency" meaning (the
   current-household marker).

3. **Display currency is a local settings field** restored to the web
   settings store (and its localStorage schema version) and added to the
   mobile settings screen. Resolution chain: explicit display currency →
   household base currency → `DEFAULT_CURRENCY` (RUB). Not synchronized.

4. **Conversion lives in `@trata/money`**, platform-agnostic
   (fetch-family only): `fetchLatestRates()` returning
   `{ base, rates, asOf }`, `convert(minor, from, to, rates)` computing
   cross rates through the provider base, rounding half-up to minor
   units once per converted aggregate. Aggregates convert per-currency
   bucket totals - never individual rows; list rows stay native.
   Persistence is the apps' job (web local-data / mobile local-data
   tables), keeping `money` free of storage.

5. **Rates storage per device**: a local table of
   `(code, rate-to-base, as_of)` refreshed from
   `open.er-api.com/v6/latest/USD` (no key, CORS `*`, RUB verified
   live; fawazahmed0 CDN documented as fallback). Refresh at session
   boundaries and on explicit action; failure keeps the previous rows
   and is non-fatal. Rates never enter the sync protocol.

6. **Transfers gain `destination_amount BIGINT NULL`**: NULL iff the two
   accounts share a currency; service-level validation enforces the
   iff (a cross-table CHECK is impossible), rejects negative/zero
   values, and re-validates on every create/update against the
   effective accounts. OpenAPI carries `destinationAmount` as optional
   (present iff cross-currency - a condition the schema documents but
   the server validates). The balance computation adds
   `COALESCE(destination_amount, amount)` to the destination.
   Synchronization needs no spec delta: upserts carry entity payloads
   under the same per-type rules as REST. Migration is appended (dev
   databases are resettable, but environments stay reproducible).

7. **Debtors gain an immutable `currency`** (catalog CHECK, service
   default = household base on create, `RUB` DB backstop). Operations
   inherit it - no per-operation currency, so each debtor's ledger stays
   single-currency and the derived-balance model is untouched. Editing a
   debtor's currency is rejected (it would silently reinterpret past
   amounts).

8. **Planned payments gain no currency field** - a deliberate
   refinement of the session synthesis, grounded in the spec: every plan
   references exactly one live account, so a plan's amounts are already
   in that account's currency, and confirmation creates the transaction
   on that account. A separate field would be redundant and could
   diverge from the account.

9. **Aggregates group locally by native currency** (accounts summary,
   analytics, debts): per-currency exact sums, one conversion per
   bucket into the display currency, «≈» mark and rate date on converted
   figures; single-currency views stay exact and unmarked. When a rate
   is missing, the converted total is omitted, never an error.

10. **Rationale is preserved in ADR-0008** (multi-currency presentation
    and rates): cross-cutting like ADR-0001..0003, and it must outlive
    this change's archive. The `docs/assumptions.md` entry is pruned on
    implementation, per that file's own rule.

## Risks / Trade-offs

- **Provider dependency**: open.er-api.com outage degrades nothing
  (cache + stale tolerance), but rates age. Accepted: personal
  accounting tolerates stale display rates; the provider seam allows a
  swap.
- **Conditionally required `destinationAmount`** cannot be expressed in
  OpenAPI alone; the server validates the iff-rule. Risk: a client bug
  sends a same-currency transfer with a destination amount - rejected,
  surfaced in dev, both apps ship in lockstep.
- **Floating-point drift**: conversion is f64 arithmetic in TS; it
  applies once per aggregate bucket and rounds once, and every converted
  figure is labeled approximate. Exactness claims are confined to
  per-currency sums.
- **Terminology collision** ("household currency" marker vs base
  currency) can leak into i18n strings and code names; the spec prose
  and this design fix "base currency" as the term.
- **Locale-to-currency mapping** needs maintaining for the catalog; the
  fallback chain (→ RUB) keeps unmapped locales harmless.
