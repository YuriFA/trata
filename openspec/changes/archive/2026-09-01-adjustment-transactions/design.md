# Design: adjustment-transactions

## Context

Backend: layered Go API (transport → service → repository, sqlc/Postgres),
spec-first via `docs/api/openapi.yaml` (`make gen`, drift-gated). Web
(Vue 3, FSD) is online-first; mobile (Expo, FSD) is offline-first with
local SQLite (`@trata/local-data`) and the sync protocol.
Transaction contribution today: income `+amount`, expense `-amount`,
transfer `-from/+to`; `amount` is positive-only (`minimum: 1` in the
contract). Account balance is server-computed as
`opening_balance + manual_adjustment + Σ contributions`, stored and
recomputed transactionally on every transaction mutation. Mobile has no
account-editing UI; the manual-adjustment edit form exists on web only.
No production data carries a nonzero `manual_adjustment` (owner
confirmed), so a destructive column drop is acceptable.

## Goals / Non-Goals

**Goals:**

- Adjustment becomes a first-class transaction type with full
  create/edit/delete/sync/tombstone semantics for free.
- One mental model: balance = opening + Σ transactions; the account-level
  correction field disappears from every layer.
- Reconcile UX expresses intent ("make the balance equal this") and
  leaves an audit trail (author, timestamp, delta, optional note).

**Non-Goals:**

- Mobile reconcile UI (deferred until mobile gains account editing).
- Any dedicated reconcile endpoint or server-side delta computation.
- Statement import / bank-sync reconciliation flows.
- Changing planned payments or debts capabilities (adjustment is a manual
  cash-correction concept with no category; planned payments require a
  category and stay income/expense).

## Decisions

### D1: Client-computed delta over a server reconcile endpoint

The web dialog computes `delta = target − currentBalance` locally and
calls the existing `POST /transactions` with
`{type: "adjustment", amount: delta, accountId}`.

- Why: mobile is offline-first, so local delta computation against local
  balance must exist eventually anyway; a server endpoint would force two
  divergent code paths. No new endpoint, error codes, or sync rules.
- Alternative rejected: `POST /accounts/{id}/reconcile {targetBalance}`
  computes the delta atomically server-side (no read-then-write race),
  but cannot work offline and adds a second way to mutate balances.
- The race (balance changes between read and submit, e.g. a household
  member's transaction lands) degrades gracefully: the adjustment lands
  relative to a slightly stale base, the user sees the result and can
  re-reconcile. This is consistent with the sync model's existing
  last-writer-wins conflict handling.

### D2: Signed amount, positive-only rule relaxed only for adjustment

`amount` keeps `minimum: 1` for income/expense/transfer; for
`adjustment` the constraint is `not: 0` with both signs allowed. Sign is
carried by the value itself, not by a direction field.

- Why: one knob; the contribution rule is "add the signed amount".
  Encoding direction in the type (like income/expense) would need two
  pseudo-types or a direction enum for a concept that is inherently
  bidirectional.
- Validation stays in one place (the existing per-type reference/amount
  validation in the service layer).

### D3: Reference shape - account only, no category

Adjustment requires `accountId`, forbids `categoryId`/`fromAccountId`/
`toAccountId`. This rides the existing mutually-exclusive-pairs
validation; adjustment is a third pair shape. No category means no
category-type-mismatch checks apply.

### D4: Drop `manual_adjustment` column outright, no transition window

Single migration: drop column, update balance-recompute SQL to
`opening_balance + Σ contributions` (adjustment rows contribute via the
same CASE machinery over the new type). Since contribution recompute is
transactional on every mutation, balances converge immediately.

- Why: no production data to preserve; a nullable transition column or
  dual-read path would be dead code on arrival.
- Rollback: restore from the migration's `DOWN` (recreate column with
  default 0); adjustment transactions remain valid rows (their type is
  retained) and simply keep contributing via Σ.

### D5: Aggregate exclusion by type filter, not by special-casing

All money-flow aggregates (web dashboards/analytics/plans, mobile
cashflow selectors) already enumerate transaction types explicitly
(income/expense/transfer handling). Adjustment enters those enumerations
as "present in listings, absent from sums" - the same treatment transfers
already get. No new flag or computed column.

### D6: Web UI placement

- Account card dropdown gains «Сверить баланс»; the dialog instance
  lives once on the accounts page (existing list/dialog convention).
- Edit-account form shrinks to the name field (the account update
  contract becomes name-only; `AccountUpdateRequest` drops
  `manualAdjustment`).
- Add-transaction flow unchanged (no fourth tab); adjustment edit gets a
  small dedicated form (signed amount, description, occurredAt, account).

### D7: Sync and local data

`AccountFullState` drops `manualAdjustment`; local-data schema drops the
column with its own migration. Adjustment transactions flow through the
existing transaction sync path (full-state upserts, tombstones, change
log) with no protocol change - the type is just another enum value.
Conflict center loses the account adjustment field display.

## Risks / Trade-offs

- [Stale-balance race in reconcile dialog (household concurrency)] →
  Delta is computed from the freshest cached balance at submit time and
  the result is immediately visible; re-reconciling is cheap. Same class
  of risk as any offline mutation.
- [Enum extension reaches every exhaustive switch over transaction type]
  → TypeScript exhaustiveness checks and Go compiler will surface them;
  tasks include a sweep across web/mobile/packages (list items, filters,
  forms, analytics selectors, sync-conflict rendering, local-data
  repositories).
- [Destructive column drop] → No data at risk (confirmed); migration
  carries an explicit DOWN path.
- [Users of the old edit form look for the adjustment field] → The
  reconcile action sits in the same dropdown, one entry away; the edit
  dialog's shrinking is self-explanatory.

## Migration Plan

1. OpenAPI first (add type, relax amount rule per-type, drop
   `manualAdjustment`), regenerate backend and TS clients; CI drift
   gates enforce propagation.
2. Backend: validation, contribution SQL, column-drop migration,
   full-state, tests (unit + e2e).
3. Web: remove field usage, add reconcile dialog + history/filter/edit
   rendering, exclude from aggregates.
4. Mobile/packages: local-data schema migration + selector/list/conflict
   updates.
5. Deploy is a single backend+web release (mobile follows with the app
   release train); no API compatibility window is needed for a
   single-user deployment.

## Open Questions

(none)
