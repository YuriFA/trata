# Design: add-planned-payments

## Context

The backend knows five user-owned synced entities (account, category,
transaction, debtor, debt operation), each with the same anatomy:
Postgres table with `user_id` / `version` / `deleted_at`, sqlc queries,
`withinLockedTx` + `appendChangeLog` writes, service validation, strict
handlers, REST CRUD, and first-class sync participation (`SyncEntity`
enum, push dispatch, pull state, retention). Two background jobs exist
(`internal/jobs/cleanup`, `internal/jobs/retention`) as the pattern for
server-side scheduled work. The mobile app is offline-first: local
SQLite (drizzle) is the source of truth; every entity table carries
`version` / `serverVersion` / `deletedAt`, mutations write row + outbox
atomically, and the sync engine switches exhaustively on the entity
union — unknown kinds are already skipped with cursor advance (debts
D5), so old builds survive new entities. Planned payments exist nowhere
yet; the «Планы» tab is a placeholder screen. See proposal.md for
motivation; the delta specs pin the behavior.

Relevant constraints:

- Spec-first: OpenAPI changes precede everything; `make gen` /
  `pnpm gen:api` regenerate both clients of the contract; drift gates in CI.
- Money is int64 minor units at every boundary; mobile forms use digit
  strings converted once at the mapper seam (`parseMajorUnitsToMinor` /
  `minorToInputValue`).
- Mobile FSD: single-screen UI stays in the page slice; entity data
  access goes through repository + TanStack hooks; forms follow
  `docs/conventions/forms.md`; the debts screen is the canonical shape.
- Precedent for "records + derived figures": balances and debt totals
  are sums, never stored. Plans follow it — no occurrence table, no
  stored projections.

## Goals / Non-Goals

**Goals:**

- `planned_payment` as a first-class entity across contract, backend,
  `packages/api`, and mobile — indistinguishable in structure and
  guarantees from the existing five.
- Confirmation (manual and automatic) produces ordinary transactions;
  the plan itself carries only the rule.
- The mobile screen works fully offline, including manual confirmation;
  local reminders fire without the network.

**Non-Goals:**

- No web UI or `apps/web` changes (the contract change is additive;
  regenerated `schema.ts` must not break web's type-check).
- No home-screen quick action (the tab exists) and no analytics
  integration (plans do not feed forecasts yet).
- No pause/archival, no end dates, no configurable reminder time.
- No server-side push notifications — reminders are local to each
  device; there is no push infrastructure and none is being built.
- No occurrence table — transactions created from a plan are the only
  record of executed occurrences (see D1).
- No `Idempotency-Key` support on REST creates in v1 — the only offline
  client (mobile) mutates through sync push, which has its own durable
  opId idempotency. Revisit when web builds a plans UI.
- No i18n wiring; RU strings hardcoded with `TODO(i18n)` markers.

## Decisions

### D1: Domain model — one entity, `anchor_date` + `next_due`, no occurrence records

`planned_payment` (id, user_id, `type: expense|income`, positive int64
amount, `name TEXT NOT NULL DEFAULT ''` — optional name, NOT unique,
stored empty like a note; `account_id` FK, `category_id` FK,
`next_due DATE`, `anchor_date DATE`, `regularity:
daily|weekly|monthly|yearly`, `confirm_mode: manual|auto`, `reminder:
off|day_before|on_day`, `note TEXT NOT NULL DEFAULT ''`, version,
timestamps, tombstone).

The anchor is a persisted column, not a derivation: monthly (weekly,
yearly) occurrences are computed from `anchor_date`'s day-of-month
(weekday, month-and-day), so a plan anchored to the 31st clamps to
February 28/29 and returns to the 31st in March — the clamp must not
poison the anchor, and `next_due` alone cannot express that
(31 → 28 → 28 → … drift). `anchor_date` is set to `next_due` on create
and whenever the user edits `next_due`; advancement updates only
`next_due`. Both columns are part of the wire payload and sync data so
every side computes the same sequence.

No occurrence table and no `last_confirmed_at`: executed occurrences are
ordinary transactions; advancing `next_due` in the same transaction that
creates the payment IS the dedup marker (D5). Alternatives rejected: an
`occurrence` table (one more synced entity, conflict surface, and
retention step — for nothing the transaction list doesn't already show);
storing only `last_charged_at` and deriving the schedule from it (same
columns, worse ergonomics for the "starts already overdue" case).

The plan's `type` is immutable (precedent: transaction/debt direction).
To fix a misrecorded plan, delete and recreate.

### D2: Calendar semantics — DATE columns, UTC day boundary, shared advance function

`next_due` / `anchor_date` are `DATE` (Postgres) / ISO `YYYY-MM-DD`
text (SQLite); `format: date` on the wire. An occurrence is due once its
calendar day has arrived, evaluated against the UTC date — the server
has no user timezone, and a ±hours skew at the world's edges beats
inventing a per-user timezone setting for v1. Auto transactions carry
`occurred_at = <scheduled date> 12:00:00Z` — mid-day UTC keeps the
transaction inside its own date for any user west of UTC+12 and sorts
before manually created same-day evening entries.

Advancement (`advanceNextDue(nextDue, anchor, regularity) → next date`)
is pure date arithmetic, implemented twice — Go
(`internal/domain/planned_payment.go`) and TS
(`entities/planned-payment/model/recurrence.ts`) — because backend and
mobile both advance the plan (auto job vs manual confirm). Both
implementations are pinned by table-driven tests sharing the same
vectors, including the 31 → 28/29 → 31 recovery, Feb 29 → Feb 28
yearly clamp, and multi-month catch-up sequences. Mobile date handling
goes through the `@trata/dates` facade per the workspace rule.

Monthly normalization for the «₽/мес» card figure is a separate pure
selector (`monthly amount = amount × {12, 1, 52/12, 365/12} by
regularity`, integer minor units, rounded half-up at display via
`formatAmount` — no float anywhere).

### D3: Contract surface — REST parity, sync as a first-class citizen

OpenAPI adds `PlannedPayment` (+ create/update requests with optional
client-generated id and required `version` on update), paths
`/api/planned-payments`, `/api/planned-payments/{id}` (list filterable
by `type`), and error codes following the existing naming:
`PLANNED_PAYMENT_NOT_FOUND`, `PLANNED_PAYMENT_ALREADY_EXISTS`,
`PLANNED_PAYMENT_VERSION_CONFLICT`,
`PLANNED_PAYMENT_ACCOUNT_NOT_FOUND`,
`PLANNED_PAYMENT_CATEGORY_NOT_FOUND`, plus `INVALID_PAYLOAD` /
`INVALID_REFS` reuse. The `SyncEntity` enum gains `planned_payment`;
`PlannedPaymentSyncData` joins the sync-data oneOf (all three lists).
Sync push applies the same validation and ownership rules as REST with
base-version CAS.

`name` and `note` both copy the `Transaction.description` convention:
`TEXT NOT NULL DEFAULT ''`, optional with `default: ""` on create, plain
non-nullable string on update (absent = keep via `*string` →
`COALESCE(sqlc.narg(...))`, explicit `null` = 400 from the kin-openapi
validator, `""` = clears), stored verbatim. Unlike debtors there is NO
name uniqueness — no partial unique index, no `NameTaken` pre-check on
push. REST DELETE carries no body or version parameter.

Category validation on create/update (REST and sync alike): the
category must be live and its type must match the plan's type (the same
rule transactions already enforce); the account must be live.

### D4: Storage — one migration, CHECK-constraint extension done online

Backend migration (golang-migrate, sequential pair) adds
`planned_payments` with the standard anatomy (uuid pk, `user_id` FK
cascade, `version`, timestamps, `deleted_at`), CHECK constraints for
`type`, `regularity`, `confirm_mode`, `reminder`, and `amount > 0`,
`next_due`/`anchor_date` as `DATE NOT NULL`, and partial indexes:
`(user_id, next_due) WHERE deleted_at IS NULL` (the job's due-scan),
`(user_id, account_id) WHERE deleted_at IS NULL` and
`(user_id, category_id) WHERE deleted_at IS NULL` (the in-use guards).
The same migration extends the `change_log.entity` and
`applied_operations.entity` CHECK constraints with
`ADD CONSTRAINT … NOT VALID` + `VALIDATE CONSTRAINT` (change_log is
append-only and possibly large; no long ACCESS EXCLUSIVE lock).

In-use guards: `HasLivePlannedPaymentsForAccount` /
`HasLivePlannedPaymentsForCategory` (live rows only — the exact shape of
the transactions guards) extend the existing account/category delete
services; tombstoned plans never block. Retention gains
`DeleteTombstonedPlannedPaymentsBefore` ordered after transactions and
before categories/accounts (FK order: referencing rows first), alongside
the debt steps.

### D5: Automatic confirmation — an hourly server job, advancement is the dedup marker

New `internal/jobs/plannedconfirm` (wired like the retention job):
every hour it scans live `auto` plans with `next_due <= today(UTC)`;
per user, inside `WithinUserTx` (advisory lock), for each due plan it
loops `while next_due <= today`: create transaction (type, account,
category, amount from the plan; `occurred_at` per D2; note = plan name)
via the transaction repository + `appendChangeLog`, advance the plan
(`next_due` only), `appendChangeLog` — one user-tx per plan batch.
Idempotency is structural: the advancement commits atomically with its
transaction, so a rerun (crash recovery, concurrent trigger, double
schedule) finds nothing due and creates nothing. No scheduler state, no
job table, no locks beyond the existing per-user advisory lock.

The job writes through the same repositories/services as everything
else — transactions appear in `change_log` and ride pull unchanged;
devices need no new machinery to receive auto-executed payments. There
is deliberately no manual-confirm endpoint: the client composes it
(D6), which keeps the API surface minimal and the offline story intact.

Missed periods: the `while` loop emits one transaction per period — a
plan three months behind yields three transactions on dated
`occurred_at`. A daily plan left unexecuted for N days yields N
transactions; that is the agreed catch-up semantics (missed charges are
real money), accepted in review.

### D6: Mobile data layer — same anatomy, confirmation is a two-op local transaction

Local table `planned_payments` in
`apps/mobile/src/shared/lib/db/schema.ts` (mandatory sync columns,
`next_due`/`anchor_date` as ISO text, enums as text, money integer);
extend the `SyncEntity` union; `pnpm db:generate` + inline. Switches to
extend: `sync-data.ts`, `sync-engine.ts`, `outbox.ts`, `conflicts.ts`,
`sync-meta.ts` (`wipeLocalData`) — the debts D6 list verbatim. New
slice `entities/planned-payment`: local repository (atomic row + outbox
writes, unborn-wipe vs tombstone delete, `RepositoryError` apiCodes
matching D3, no name-uniqueness check), repository provider, TanStack
hooks (`usePlannedPayments` single query + in-memory type filtering —
no per-type queries), barrel. Register in `ENTITY_SLICES` of
`.dependency-cruiser.mobile.cjs`; compose the provider in `_layout.tsx`.

Manual confirmation is one local `db.transaction`: insert the
transaction row + `enqueueOperation('transaction', …)` AND update the
plan row (`next_due` advanced via D2's TS function, `version + 1`) +
`enqueueOperation('planned_payment', …)`. Both outbox ops ship in the
next push; the transaction create is opId-idempotent, the plan upsert
is CAS. If the server advanced the plan meanwhile (auto job raced, or
another device confirmed), the plan upsert returns a version conflict →
the standard conflict-center flow; the transaction may still have
applied, leaving a possible duplicate the user deletes — the same
class of outcome as any two offline edits of one record, documented
rather than solved (no cross-entity dedup exists, and inventing an
occurrence ledger for it reintroduces D1's rejected table).

The account/category local-repository delete guards gain a live-plans
check alongside the existing transactions check (local mirror of D4).

### D7: Screen — a page slice replacing the placeholder, per-card sheets

`pages/plans/` replaces `plans-screen.tsx`'s `ScreenPlaceholder` (the
route `(tabs)/plans.tsx` already re-exports it — no routing changes).
Structure per the debts page: the page owns ALL sheet refs and the
creation context (invariant #15); `model/schema.ts` (Zod: one
discriminated form schema, amount as a decimal-pad digit-string input
sanitized via `sanitizeAmountInput` and refined via
`parseMajorUnitsToMinor`, named `toCreatePayload`/`toUpdatePayload`
mappers doing the single minor-unit conversion), `model/kind.ts` (RU
copy: card titles/descriptions, «Добавить расход/доход», regularity
labels «каждый день/неделю/месяц/год», confirm-mode «ручное/авто»,
reminder «выкл/за день/в день», account field «Счёт списания»/«Счёт
зачисления»), `model/selectors.ts` (monthly normalization, overdue
detection, next-due sort, row title `name || category.name` — needs the
categories in memory, one `useCategories()` read).

UI: two `Card`s («Расходы» / «Доходы») each with count +
`X ₽/мес`; tap opens a list `BottomSheet` (flat rows sorted by
`next_due`, overdue badge first, bottom «Добавить…» button — the
debts per-section creation pattern with the button living in the sheet
footer instead of a header «+»); row tap opens the edit sheet (same
form + delete). The add/edit form sheet follows forms.md and the
edit-transaction reference row layout (`field-rows.tsx` idiom): RHF +
`FormProvider`, a decimal-pad amount input carrying the selected
account's currency chip (₽ fallback before an account is chosen — the
`amount-input-field.tsx` idiom), then one-line rows — leading icon,
muted label left, value right, chevron — for the account
(`AccountPickerSheet`), the category (`CategoryPickerSheet`, filtered
to the plan type), the next-due date (`DatePickerSheet`, past dates
allowed), the regularity, the confirmation mode, and the reminder.
Regularity / confirm mode / reminder are single-choice option sheets
replacing the former `SegmentedSwitch`es (labels from `model/kind.ts`,
selected row checked); picking a non-`off` reminder value triggers the
D9 permission request. The note is an inline `BottomSheetInput` row
with a leading icon (tap focuses the input — no sheet). The submit
stays the circular `TransactionSubmitButton`, alone in the footer. The
confirm sheet reuses the same row layout: static account/category
context rows, an editable amount with the currency chip (prefilled),
a date row, and a note input row; submit runs the D6 composite. All
plans sheets — form, confirm, and the per-type list — reserve the
bottom safe area via `pb-safe` (the `debtor-history-sheet` footer
idiom). testIDs: `plans-*` (screen, cards `plans-card-<type>`, rows,
sheets, fields). The page-local `segmented-switch.tsx` is dropped with
the rework (nothing else imports it).

Reminder default in the create form is `off`; confirm-mode default is
`manual`; regularity default is `monthly` (the overwhelmingly common
case).

### D8: Sync edge semantics inherit the generic machinery (precedent map)

Every edge below is existing, tested behavior for the current five
entities; plans copy it verbatim — no new sync architecture.

- **In-use guard** — live references only (D4); on sync push an
  account/category delete blocked by live plans surfaces as the
  existing `ACCOUNT_IN_USE` / `CATEGORY_IN_USE` per-item errors.
- **Offline plan vs server-deleted refs** — sync push validates refs
  against LIVE accounts/categories (`validateSyncRefs`): a tombstoned
  or missing ref yields a per-item error with
  `PLANNED_PAYMENT_ACCOUNT_NOT_FOUND` /
  `PLANNED_PAYMENT_CATEGORY_NOT_FOUND` (the
  `DEBT_OPERATION_DEBTOR_NOT_FOUND` analog); the op keeps its
  `lastError`, retries under the standard backoff, never enters
  `sync_conflicts`, never silently discarded.
- **Entity id vs opId** — `applied_operations` records only APPLIED
  results; redelivery replays the stored result; a different `opId`
  claiming an existing entity id is `SYNC_ALREADY_EXISTS` carrying
  server state.
- **Delete versioning** — REST delete takes no version, soft-deletes
  live rows (`version + 1`, `deleted_at`, tombstone in change log);
  tombstoned/missing → not-found; sync delete idempotent, delete-wins;
  sync upsert vs tombstone → `SYNC_DELETED_CONFLICT`. REST update of a
  tombstone → not-found.
- **Mobile local delete** — tombstone + outbox delete with
  `baseVersion = serverVersion`; unborn records hard-delete without
  outbox traffic.
- **Unknown entity kinds on old builds** — the debts D5
  skip-and-advance default already shipped; pulling
  `planned_payment` changes on a pre-plans build skips them and
  advances the cursor. No new work; a sync-engine test extends the
  existing unknown-kind case list.

### D9: Reminders — expo-notifications, local-only, rescheduled from query data

New dependency `expo-notifications` (plus the Android 13+
`POST_NOTIFICATIONS` permission and iOS usage string via app config —
local notifications need no push entitlement). One small module,
`entities/planned-payment/model/reminders.ts`: `reschedule(plans)`
cancels all notifications tagged with the `plan-reminder-` id prefix
and schedules, per live plan with `reminder != 'off'`, one trigger at
10:00 device-local time on `next_due` (`day_before`: the previous
day), skipping dates already past. Notification ids are deterministic
(`plan-reminder-<planId>`), so rescheduling is idempotent. Copy per
confirm mode: auto → «Сегодня спишется X» / «Сегодня зачислится X»,
manual → «Подтверди платёж X» (title «Планы»).

Driver: an effect in the plans data layer subscribes to the
`usePlannedPayments` query data (plus categories for the title amount)
and calls `reschedule` whenever the data identity changes — which
covers local mutations and pull-driven invalidation alike
(`onDataChanged` invalidates queries after sync). Permission: the form
requests `requestPermissionsAsync` when the user first picks a
reminder value other than `off` in the reminder option sheet; denial
is stored as-is and the scheduler no-ops (quiet degradation — the
setting still syncs). Each device
schedules only for itself; there is no cross-device coordination and
no server involvement.

Rejected: server-side scheduling (would require push infrastructure
that does not exist); calendar-kit/Reminder export (out of scope);
per-plan reminder times (deferred product idea).

## Risks / Trade-offs

- [Two devices confirm the same occurrence offline → duplicate
  transaction + plan version conflict] → accepted: same class as any
  concurrent offline edit; conflict center resolves the plan, the user
  deletes the duplicate transaction. Cross-entity dedup would need the
  occurrence table D1 rejects.
- [Auto job races a manual confirmation pushed for the same plan] →
  both advance via CAS (job inside its tx, client via sync upsert):
  exactly one advancement wins per version; the loser takes the
  standard conflict path. No double-advance is possible.
- [Server down across due dates] → the hourly job catches up on next
  run (D5 loop); no occurrences are lost, only delayed.
- [CHECK-constraint migration locks a large change_log] → `NOT VALID` +
  `VALIDATE CONSTRAINT` (D4).
- [Advance logic duplicated Go/TS diverges] → shared table-driven test
  vectors pin both implementations (D2), including clamping edge cases.
- [expo-notifications platform drift (permissions, background
  behavior) → Jest-mocked unit tests for scheduling logic; permission
  denial path tested; device behavior verified manually once.
- [Daily auto plan offline for weeks → a burst of catch-up
  transactions] → agreed product semantics (missed charges are real
  money); the list UI is flat and dated, so the burst is auditable.
- [Mobile rollback after the DB migration shipped] → drizzle migrations
  are forward-only; rollback means reverting the app release before the
  migration has run in production — noted, not solved by tooling.

## Migration Plan

Order: (1) contract edits + `make gen` / `pnpm gen:api` + drift gates +
redocly lint; (2) backend migration + domain/queries/repository; (3)
backend service + transport + sync dispatch + pull state + retention +
the auto-confirm job + tests; (4) `packages/api` domain/contracts/
mappers/error codes; (5) mobile data layer (schema, migration, sync
plumbing, `entities/planned-payment`, local guards) with repository and
sync tests green before any UI; (6) mobile screen, sheets, forms,
confirm flow, reminders dependency + scheduling, Jest + Maestro;
(7) docs + `openspec validate`. Backend rollback is the down migration
(additive table + constraint values); web is untouched throughout.
