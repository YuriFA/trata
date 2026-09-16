-- debt_operations (household-scoped ledger records referencing a debtor;
-- direction and kind are immutable, amount is a positive int64 in minor
-- units). user_id stays on rows as authorship. Deletes are soft (deleted_at
-- tombstone); balances are derived from the live operation history, never
-- stored.

-- name: CreateDebtOperation :one
-- id is the optional client-generated id (offline-first clients).
INSERT INTO debt_operations (id, household_id, user_id, debtor_id, direction, kind, amount, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, user_id, debtor_id, direction, kind, amount, occurred_at, created_at, updated_at, version;

-- name: UpdateDebtOperation :one
-- Optimistic concurrency: the WHERE clause includes version = @version (and
-- liveness) so a concurrent update yields zero rows. PATCH fields use
-- COALESCE for nil = keep.
UPDATE debt_operations
SET
    amount      = COALESCE(sqlc.narg('amount'), amount),
    occurred_at = COALESCE(sqlc.narg('occurred_at'), occurred_at),
    version     = version + 1,
    updated_at  = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @version
RETURNING id, user_id, debtor_id, direction, kind, amount, occurred_at, created_at, updated_at, version;

-- name: SoftDeleteDebtOperation :one
UPDATE debt_operations
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING version;

-- name: SoftDeleteDebtOperationsForDebtor :many
-- Cascade half of a debtor delete: tombstone every live operation of the
-- debtor (balances are derived from live operations, so they recompute
-- implicitly). Returns id+version per row for the per-record change_log
-- appends.
UPDATE debt_operations
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE household_id = $1 AND debtor_id = $2 AND deleted_at IS NULL
RETURNING id, version;

-- name: GetDebtOperation :one
SELECT id, user_id, debtor_id, direction, kind, amount, occurred_at, created_at, updated_at, version
FROM debt_operations
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: GetDebtOperationAny :one
-- Includes tombstoned rows (sync push + conflict classification).
SELECT id, user_id, debtor_id, direction, kind, amount, occurred_at, created_at, updated_at, version, deleted_at
FROM debt_operations
WHERE id = $1 AND household_id = $2;

-- name: GetDebtOperations :many
SELECT id, user_id, debtor_id, direction, kind, amount, occurred_at, created_at, updated_at, version
FROM debt_operations
WHERE
    household_id = @household_id
    AND deleted_at IS NULL
    AND (sqlc.narg('debtor_id')::uuid IS NULL OR debtor_id = sqlc.narg('debtor_id'))
ORDER BY occurred_at DESC, id DESC;

-- name: SyncReplaceDebtOperation :one
-- Full-state CAS upsert from a sync push.
UPDATE debt_operations
SET
    debtor_id   = @debtor_id,
    direction   = @direction,
    kind        = @kind,
    amount      = @amount,
    occurred_at = @occurred_at,
    version     = version + 1,
    updated_at  = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @base_version
RETURNING id, user_id, debtor_id, direction, kind, amount, occurred_at, created_at, updated_at, version;

-- name: SyncDebtOperationsByIDs :many
SELECT id, user_id, debtor_id, direction, kind, amount, occurred_at, version, deleted_at
FROM debt_operations
WHERE household_id = @household_id AND id = ANY(@ids::uuid[]);
