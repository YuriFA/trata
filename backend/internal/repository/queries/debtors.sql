-- debtors (household-scoped, unique name among LIVE rows only - the partial
-- unique index ignores tombstones so a deleted name can be recreated). Scoped
-- by household_id everywhere; user_id stays on rows as authorship; deletes
-- are soft (deleted_at tombstone).

-- name: CreateDebtor :one
-- id is the optional client-generated id (offline-first clients). currency
-- falls back to the household's base currency when the client omits it.
INSERT INTO debtors (id, household_id, user_id, name, currency)
VALUES (
    $1, $2, $3, $4,
    COALESCE(sqlc.narg('currency')::text, (SELECT currency FROM households WHERE id = $2))
)
RETURNING id, user_id, name, currency, created_at, updated_at, version;

-- name: UpdateDebtor :one
-- Optimistic concurrency: the WHERE clause includes version = @version (and
-- liveness) so a concurrent update yields zero rows. The name is the only
-- updatable field; PATCH uses COALESCE for nil = keep (the service rejects a
-- no-op before the write).
UPDATE debtors
SET
    name       = COALESCE(sqlc.narg('name'), name),
    version    = version + 1,
    updated_at = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @version
RETURNING id, user_id, name, currency, created_at, updated_at, version;

-- name: SoftDeleteDebtor :one
UPDATE debtors
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING version;

-- name: LockDebtorForDelete :one
-- Row lock for the cascade delete: FOR UPDATE pins the debtor row against
-- concurrent mutations for the rest of the transaction, and the deleted_at
-- read classifies a tombstone (deleted = not-found) before any dependant is
-- touched.
SELECT deleted_at
FROM debtors
WHERE id = $1 AND household_id = $2
FOR UPDATE;

-- name: GetDebtor :one
SELECT id, user_id, name, currency, created_at, updated_at, version
FROM debtors
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: GetDebtorAny :one
-- Includes tombstoned rows (sync push + conflict classification).
SELECT id, user_id, name, currency, created_at, updated_at, version, deleted_at
FROM debtors
WHERE id = $1 AND household_id = $2;

-- name: GetDebtors :many
SELECT id, user_id, name, currency, created_at, updated_at, version
FROM debtors
WHERE household_id = @household_id AND deleted_at IS NULL
ORDER BY created_at, id;

-- name: DebtorNameTaken :one
-- Live-name uniqueness pre-check (race-free under the per-household
-- change-log advisory lock); used by the sync path where a constraint
-- violation would abort the shared batch transaction.
SELECT EXISTS(
    SELECT 1
    FROM debtors
    WHERE household_id = @household_id AND name = @name AND deleted_at IS NULL AND id <> sqlc.arg('except_id')
) AS taken;

-- name: SyncReplaceDebtor :one
-- Full-state CAS upsert from a sync push.
UPDATE debtors
SET
    name       = @name,
    version    = version + 1,
    updated_at = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @base_version
RETURNING id, user_id, name, currency, created_at, updated_at, version;

-- name: SyncDebtorsByIDs :many
SELECT id, user_id, name, currency, version, deleted_at
FROM debtors
WHERE household_id = @household_id AND id = ANY(@ids::uuid[]);
