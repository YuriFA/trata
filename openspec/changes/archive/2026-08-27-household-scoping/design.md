# Design: household-scoping

## Context

ADR-0002 fixes the model (single shared space, owner/member roles,
household as the scoping key). Today the backend is strictly per-user:
service methods take `userID` first, every query scopes `WHERE user_id`
(11 query files, ~140 mentions), and the sync plumbing (`change_log`,
`applied_operations`, the advisory lock in
`backend/internal/repository/queries/sync.sql`) keys on `user_id`.
Migrations are numbered up/down pairs under
`backend/internal/repository/postgres/migrations/` (next: `000005`).
Both clients (mobile, web) are local-first over
`@trata/local-data`; sync push/pull shapes are
platform-agnostic and generated from `docs/api/openapi.yaml`.

## Goals / Non-Goals

**Goals:**

- The household becomes the scoping key end-to-end on the backend, with a
  lossless backfill that gives every user a personal household of one.
- Zero client changes in this step (additive generated types only).
- Spec/doc wording that no longer claims per-user scoping.

**Non-Goals:**

- Invitations, home codes, join/leave flows, the rebase helper (change
  2: `household-join`).
- Any owner-vs-member behavioral split (roles are stored, not yet
  enforced beyond membership).
- Authorship in sync payloads (change 2 — needs schema + package work).
- Multi-membership, household switching, per-resource sharing (rejected
  in ADR-0002).

## Decisions

### D1. One migration, server-stamped backfill

`000005_household.up.sql` creates `households` (id, created_at) and
`household_members` (household_id, user_id, role `owner|member`,
joined_at, PK (household_id, user_id)), adds `household_id uuid NOT NULL
REFERENCES households(id)` to all six entity tables plus `change_log`
and `applied_operations`, then backfills in SQL: one household per
existing user (`INSERT ... SELECT`), owner memberships, and
`UPDATE ... FROM users` stamps on every row. A single migration keeps
deployment atomic — there is no intermediate state where scoping is
ambiguous. The `.down.sql` drops the added tables/columns (records
revert to user-scoping; acceptable as the rollback of a not-yet-shared
system).

### D2. Middleware resolves the household once

The auth middleware already resolves session → user; it additionally
loads the user's (single, v1) membership and puts `householdID` into the
request context alongside `userID`. Services change their first parameter
to `householdID`; `user_id` columns stay on entity rows purely as
authorship, stamped server-side from the session on create (never trusted
from the wire). IDOR-safety keeps its shape: not-a-member ⇒ the record is
invisible, exactly as cross-user invisibility works today.

### D3. Sync plumbing re-keys; shapes untouched

`change_log` and `applied_operations` gain `household_id` (drop the
`user_id` key or keep as authorship for `change_log` rows — keep: pull
payload will need the author in change 2); the advisory lock becomes
`pg_advisory_xact_lock(hashtextextended(@household_id::text, 0))`, making
`seq` allocation per household (invariant #7 generalizes to "per scoping
unit"). Pull scopes by household; per-device cursors remain client-side
and unchanged. No OpenAPI sync shape changes.

### D4. OpenAPI additions are additive

`GET /api/household` → own household with members (email, displayName?,
role, joinedAt); `User` gains optional `displayName`; `PATCH /api/me`
accepts `{ displayName }` (validation: non-empty trimmed, length cap).
Regeneration everywhere (`make gen`, `pnpm gen:api`) with drift gates
green. Existing endpoints' responses only grow an optional field — old
clients ignore it.

### D5. Registration creates the household transactionally

The register flow inserts user + household + owner membership in one
transaction (same service layer as today's user creation; no new
endpoint).

### D6. Spec and doc edits ride this change

Invariants #5/#7 wording generalizes to household scoping (ADR-0002 is
the recorded authority for this edit); `docs/architecture/overview.md`
pointers updated. Domain-spec deltas (accounts, categories,
transactions, debts, mobile-local-data) replace user-scoping sentences
with household-scoping ones — behavior for single-member households is
identical, so the merged specs stay truthful both before and after
members exist. `planned-payments` only mentions "per-user" in its
Purpose line; the `household` capability is the scoping authority, no
requirement there needs a delta.

## Risks / Trade-offs

- [Large mechanical diff hides a scoping mistake] → two-household
  isolation fixtures in service/e2e tests (member sees sibling's records;
  non-member gets not-found) run across every entity service.
- [Backfill correctness on real data] → migration is pure SQL over
  not-null FK stamps; verify with a staging restore before deploy
  (pg_dump is already part of ops).
- [Cursor/lock mismatch after re-key] → sync service tests cover
  per-household `seq` monotonicity and cross-household pull isolation.
- [Down migration loses household bindings] → acceptable pre-launch
  rollback; noted here deliberately.

## Migration Plan

Single backend deploy (migration runs on startup as today). No client
releases required; generated TS types are additive. Rollback = revert +
down migration.

## Open Questions

(none)

## Deviations during implementation

- **`applied_operations` PK is `(household_id, op_id)`, not a global
  `op_id` PK.** ADR-0002 said "re-key to household_id" without fixing the
  PK; client-generated op ids must be idempotent per household (the
  sync-protocol's persistent-idempotency requirement is scope-neutral),
  and a global PK would falsely collide across households.
- **Backfill uses the owner's user id as the household id** — stable,
  debuggable, no extra id generation in SQL.
- **Two hardening fixes beyond the task list**, both surfaced by the new
  two-household tests: a missing `household_id` stamp on the sync-path
  planned-payment create, and a nil-dereference when a client-generated
  id collides with a record of another household (now an already-exists
  conflict with no serverState — IDOR-safe).
- **Docs**: the backend AGENTS middleware allowlist now names
  `HouseholdRepository` (the auth middleware resolves memberships).
