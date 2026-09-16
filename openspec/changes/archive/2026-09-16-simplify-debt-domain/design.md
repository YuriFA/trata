## Context

Debtors and debt operations are tombstone-based sync entities backed by a
per-user change log with a retention job; balances are derived, never
stored. Today a debtor delete is guarded (409 `DEBTOR_IN_USE`) both in the
REST repository layer (`backend/internal/repository/postgres/debtors.go`,
in-transaction live-operations check) and in the sync batch write rules
(`backend/internal/service/write_rules_debtor.go`). Both entities carry an
optional `note` with the shared optional-note semantics. The web app edits
a debtor through `DebtorFormDialog` (name + note + delete), mobile through
`debtor-form-sheet` (same); the local SQLite schema in
`packages/local-data/src/schema.ts` mirrors the API shape for both apps.
See proposal.md - Why for motivation.

## Goals / Non-Goals

**Goals:**

- Cascade delete: one action tombstones the debtor and all its live
  operations atomically, in REST and in the sync batch.
- Remove `note` end-to-end: OpenAPI, Postgres schema, sync payloads, local
  SQLite schema, both UIs, i18n.
- Reduce the debtor surface to rename-only in the UI; deletion moves to the
  debtor history.
- Contract-first: edit `docs/api/openapi.yaml`, then regenerate backend and
  TS types.

**Non-Goals:**

- No change to direction netting rules, per-household name uniqueness,
  currency model, or balances derivation.
- No change to sync mechanics (change log, tombstones, idempotency,
  retention); only the debtor-delete guard disappears.
- No merging or aggregation of debtors by name.
- No data preservation for existing note text; the migration drops it.

## Decisions

- **Debtor stays as an internal identity.** The `debtor` row remains the
  FK target of operations and the carrier of the immutable ledger currency.
  Only its user-facing management surface shrinks. Alternative rejected:
  denormalizing the name onto each operation - it turns identity into
  string comparison and churns sync/migrations for no behavior gain.
- **Cascade in one transaction.** `DeleteDebtor` locks the debtor row,
  tombstones every live operation (`deleted_at = now()`, `version = version
  + 1`), then the debtor, appending one change-log tombstone per record in
  the same transaction (change-log atomicity invariant). The sync batch
  path reuses the same service function, so a pushed debtor delete is
  reported as applied and its operations propagate as tombstones via pull.
- **Guard removal is total.** Drop the repository guard, the sync write
  rule, `ErrDebtorHasOperations` and its `DEBTOR_IN_USE` error spec, and
  the 409 case from the OpenAPI delete-debtor operation. Orphan-operation
  protection is unchanged: an operation pushed for a non-live debtor still
  gets the per-item `debtor-not-found` error.
- **Note removal relies on the contract.** Generated Go structs and TS
  types simply lose the field; `encoding/json` ignores unknown fields, so
  stale clients pushing `note` degrade to "ignored". Historical change-log
  entries keep whatever they stored - no rewrite.
- **Local cascade mirrors the server.** `packages/local-data` gains a
  cascade delete that tombstones the debtor and its live operations and
  enqueues the sync operations in one local transaction; the existing
  per-entity tombstone helpers stay for single-operation deletes.
- **UI placement.** Web: rename-only dialog replaces `DebtorFormDialog`;
  delete lives in `DebtorHistoryDialog`'s header behind an AlertDialog
  showing the operation count (plus a non-zero balance warning). Mobile:
  the same behind the history sheet's header pencil/trash, Alert-based.
  Creation and operation forms lose the note input.
- **Migrations.** Postgres: next numbered migration drops
  `debtors.note` and `debt_operations.note`. Local SQLite: bump the schema
  version in `packages/local-data` and drop the same columns; no copy-out.

## Risks / Trade-offs

- **Breaking contract for stale clients.** Mobile builds in the field may
  still send/expect `note`. Reads: extra response fields are ignored; the
  missing field renders as nothing. Writes: `note` payloads are ignored.
  Deploy backend first, then web, then release mobile.
- **Cascade fan-out.** A debtor with many operations produces N+1
  tombstones and change-log rows in one transaction; bounded by one ledger
  and consistent with existing batched sync writes.
- **In-flight local edits to operations of a cascaded-deleted debtor**
  already follow the existing per-item `debtor-not-found` queue-and-retry
  rule; no new semantics introduced.
