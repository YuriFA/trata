-- transactions. Scoped by household_id everywhere (IDOR protection); user_id
-- stays on rows as authorship. Deletes are soft (deleted_at tombstone):
-- balances (via the account_contributions view) and listings filter
-- tombstones; the *Any reads include them for sync.
--
-- The keyset-cursor index transactions(household_id, occurred_at DESC, id
-- DESC) serves ListTransactions directly.

-- name: CreateTransaction :one
-- id is the optional client-generated id (offline-first clients).
INSERT INTO transactions (
    id, household_id, user_id, type, amount, description, occurred_at,
    account_id, category_id, from_account_id, to_account_id, destination_amount
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount;

-- name: UpdateTransaction :one
-- Optimistic concurrency: the WHERE clause includes version = @version (and
-- liveness) so a concurrent update yields zero rows (-> version conflict).
-- version is incremented atomically; PATCH fields use COALESCE for nil = keep.
UPDATE transactions
SET
    amount           = COALESCE(sqlc.narg('amount'), amount),
    description      = COALESCE(sqlc.narg('description'), description),
    occurred_at      = COALESCE(sqlc.narg('occurred_at'), occurred_at),
    account_id       = COALESCE(sqlc.narg('account_id'), account_id),
    category_id      = COALESCE(sqlc.narg('category_id'), category_id),
    from_account_id  = COALESCE(sqlc.narg('from_account_id'), from_account_id),
    to_account_id    = COALESCE(sqlc.narg('to_account_id'), to_account_id),
    destination_amount = COALESCE(sqlc.narg('destination_amount'), destination_amount),
    version          = version + 1,
    updated_at       = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @version
RETURNING
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount;

-- name: SoftDeleteTransaction :one
UPDATE transactions
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING version;

-- name: GetTransaction :one
SELECT
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount
FROM transactions
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: GetTransactionAny :one
-- Includes tombstoned rows (sync push + conflict classification).
SELECT
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount,
    deleted_at
FROM transactions
WHERE id = $1 AND household_id = $2;

-- name: ListTransactions :many
-- Keyset cursor pagination (occurred_at DESC, id DESC). Each optional filter is
-- applied only when its narg is non-NULL. The account filter matches a
-- transaction if ANY of its account refs (account_id / from / to) equals it,
-- preserving the original OR-across-refs semantics.
SELECT
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount
FROM transactions
WHERE
    household_id = @household_id
    AND deleted_at IS NULL
    AND (sqlc.narg('type')::text IS NULL OR type = sqlc.narg('type'))
    AND (
        sqlc.narg('account_id')::uuid IS NULL
        OR account_id = sqlc.narg('account_id')
        OR from_account_id = sqlc.narg('account_id')
        OR to_account_id = sqlc.narg('account_id')
    )
    AND (sqlc.narg('category_id')::uuid IS NULL OR category_id = sqlc.narg('category_id'))
    AND (sqlc.narg('from_date')::timestamptz IS NULL OR occurred_at >= sqlc.narg('from_date'))
    AND (sqlc.narg('to_date')::timestamptz IS NULL OR occurred_at <= sqlc.narg('to_date'))
    AND (
        sqlc.narg('cursor_occurred_at')::timestamptz IS NULL
        OR occurred_at < sqlc.narg('cursor_occurred_at')
        OR (occurred_at = sqlc.narg('cursor_occurred_at') AND id < sqlc.narg('cursor_id'))
    )
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: SyncReplaceTransaction :one
-- Full-state CAS upsert from a sync push. Type is immutable.
UPDATE transactions
SET
    amount          = @amount,
    description     = @description,
    occurred_at     = @occurred_at,
    account_id      = @account_id,
    category_id     = @category_id,
    from_account_id = @from_account_id,
    to_account_id   = @to_account_id,
    destination_amount = @destination_amount,
    version         = version + 1,
    updated_at      = now()
WHERE id = @id AND household_id = @household_id AND deleted_at IS NULL AND version = @base_version
RETURNING
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount;

-- name: SyncTransactionsByIDs :many
SELECT
    id, user_id, type, amount, description, occurred_at,
    created_at, updated_at, version,
    account_id, category_id, from_account_id, to_account_id, destination_amount,
    deleted_at
FROM transactions
WHERE household_id = @household_id AND id = ANY(@ids::uuid[]);
