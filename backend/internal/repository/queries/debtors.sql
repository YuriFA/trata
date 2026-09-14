-- debtors (household-scoped, unique name among LIVE rows only - the partial
-- unique index ignores tombstones so a deleted name can be recreated). Scoped
-- by household_id everywhere; user_id stays on rows as authorship; deletes
-- are soft (deleted_at tombstone).

-- name: CreateDebtor :one
-- id is the optional client-generated id (offline-first clients). currency
-- falls back to the household's base currency when the client omits it.
INSERT INTO debtors (id, household_id, user_id, name, note, currency)
VALUES (
    $1, $2, $3, $4, $5,
    COALESCE(sqlc.narg('currency')::text, (SELECT currency FROM households WHERE id = $2))
)
RETURNING id, user_id, name, note, currency, created_at, updated_at, version;

-- name: UpdateDebtor :one
-- Optimistic concurrency: the WHERE clause includes version = @version (and
-- liveness) so a concurrent update yields zero rows. PATCH fields use
-- COALESCE for nil = keep; a non-nil empty note clears it.
UPDATE debtors
SET
    name       = COALESCE(sqlc.narg('name'), name),
    note       = COALESCE(sqlc.narg('note'), note),
    version    = version + 1,
    updated_at = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @version
RETURNING id, user_id, name, note, currency, created_at, updated_at, version;

-- name: SoftDeleteDebtor :one
UPDATE debtors
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING version;

-- name: GetDebtor :one
SELECT id, user_id, name, note, currency, created_at, updated_at, version
FROM debtors
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: GetDebtorAny :one
-- Includes tombstoned rows (sync push + conflict classification).
SELECT id, user_id, name, note, currency, created_at, updated_at, version, deleted_at
FROM debtors
WHERE id = $1 AND household_id = $2;

-- name: GetDebtors :many
SELECT id, user_id, name, note, currency, created_at, updated_at, version
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

-- name: HasLiveDebtOperationsForDebtor :one
-- In-use guard counts LIVE operations only: tombstoned operations never
-- block debtor deletion.
SELECT EXISTS(
    SELECT 1
    FROM debt_operations
    WHERE household_id = @household_id AND deleted_at IS NULL AND debtor_id = @debtor_id
) AS in_use;

-- name: SyncReplaceDebtor :one
-- Full-state CAS upsert from a sync push.
UPDATE debtors
SET
    name       = @name,
    note       = @note,
    version    = version + 1,
    updated_at = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @base_version
RETURNING id, user_id, name, note, currency, created_at, updated_at, version;

-- name: SyncDebtorsByIDs :many
SELECT id, user_id, name, note, currency, version, deleted_at
FROM debtors
WHERE household_id = @household_id AND id = ANY(@ids::uuid[]);
