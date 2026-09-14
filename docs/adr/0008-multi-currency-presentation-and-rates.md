# ADR-0008: Multi-currency presentation - native amounts, display-currency conversion, externally sourced rates

- **Status:** Accepted (2026-09-14)
- **Scope:** both apps (presentation, local settings, per-device rate cache),
  backend (household base currency, debtor currency, transfer destination
  amount); the sync protocol is unchanged
- **Related:** `openspec/changes/multi-currency` (the implementing change:
  proposal, spec deltas, design, tasks); `docs/assumptions.md`
  (multi-currency direction recorded 2026-08-28, pruned by this ADR);
  ADR-0003 (sync push engine - untouched); invariant #2 (money is int64
  minor units, divisor 100 - preserved by a two-decimal-only catalog)

## Context

The 2026-08-28 `currency-rub-only` change cut the multi-currency UI and left
a recorded direction: two-amount transfers, per-currency aggregates converted
into a single display currency, externally sourced rates. The API contract
stayed multi-currency-ready (accounts.currency enum, sync untouched), so
restoring the feature is additive. The direction left four points to this
change: the rate source, its storage/precision model, the transfer rate
snapshot shape, and whether debts and planned payments gain a currency.

## Decision

1. **Fixed two-decimal catalog.** Eighteen ISO currencies (USD, EUR, RUB,
   GBP, CNY, TRY, PLN, GEL, KZT, UAH, AMD, AZN, UZS, KGS, RSD, ILS, AED,
   THB) - every one two-decimal, so invariant #2 (int64 minor units, divisor
   100) survives untouched. A `minor_units` column and per-currency divisors
   are explicitly deferred until a real currency demands them (with their own
   ADR). The catalog is a fixed list landing in one coordinated change: the
   DB CHECK constraints, the OpenAPI `Currency` schema, `@trata/money`.
2. **Native amounts are the only stored truth.** Accounts keep their
   creation-time currency (immutable, as before); debtors gain an immutable
   ledger currency (default: household base); planned payments gain nothing -
   a plan references exactly one account and inherits that account's currency.
   Conversion is presentation-only and never rewrites records.
3. **Household base currency + per-device display currency.** The household
   carries a base currency (server default RUB at implicit creation,
   owner-editable, delivered with household responses). Each device keeps a
   local display-currency preference defaulting to the household base -
   deliberately NOT synchronized: currency presentation is a per-viewer
   concern, and syncing it would put a settings value into the change-log.
   Resolution chain: explicit display setting → household base →
   `DEFAULT_CURRENCY` (RUB, the last fallback).
4. **Aggregates convert once; rows never do.** Totals are computed per
   currency as exact integer sums, then each per-currency bucket is converted
   into the display currency with one `convert()` call rounded half-away-from
   -zero. Converted figures are marked «≈» and shown with the rate's as-of
   date; single-currency figures are exact and unmarked; when a rate is
   missing the converted total is omitted and per-currency figures remain.
   Transaction and account rows always render their native amounts.
5. **Rates are external, per-device, and never synced.** The provider is
   open.er-api.com (no API key, CORS-open, verified to include RUB;
   fawazahmed0's CDN documented as fallback). Rates cache into the device's
   local database, refresh at session boundaries and on explicit action, and
   treat failure as non-fatal (the previous cache keeps serving, with its
   as-of date shown). No manual override in v1 - the override surface is
   additive later.
6. **Cross-currency transfers store two amounts, not a rate.** A transfer
   carries `amount` (source currency) plus `destinationAmount` (destination
   currency, required iff the accounts' currencies differ, forbidden
   otherwise). The effective rate is derivable as `destinationAmount / amount`
   - a stored rate column would be redundant and drift-prone. This refines
   the recorded "two amounts + rate snapshot" wording: the two amounts ARE
   the snapshot. The destination-side balance credit uses
   `COALESCE(destination_amount, amount)`.
7. **Suggested (not forced) locale defaults.** Household creation is implicit
   at registration, so there is no creation form to prefill; instead, a device
   whose locale maps to a catalog currency suggests switching the household
   off the RUB default once, dismissibly. The display-currency preference is
   the everyday lever.

## Consequences

- The sync protocol needs no new mechanics: debtor upserts carry `currency`
  and transaction upserts carry `destinationAmount` as ordinary full-state
  fields under the same per-type rules as REST (the sync-catalog manifest is
  the generated source for all four catalogs).
- Client versions must ship in lockstep: `DebtorSyncData.currency` is
  required, and old pushers would fail the per-item validation. No production
  databases exist; dev databases are resettable, and the appended migration
  backfills RUB.
- Float arithmetic exists only in `convert()` on aggregate buckets with one
  final rounding; every converted figure is labeled approximate, so no exact
  claim is ever attached to a converted number.
- Expanding the catalog later is a coordinated four-point change (constraint,
  enum, package, this ADR's list) - cheap, mechanical, and reviewable.
