-- accounts. Every query scopes by household_id (IDOR-safe: an access from
-- outside the household returns "not found", never the row). user_id stays on
-- the rows as authorship (stamped from the session on create). Balance is
-- computed via the account_contributions view (opening + sum(signed)).
-- Deletes are soft (deleted_at tombstone); every read path that feeds
-- listings/summaries filters tombstones, while the *Any reads (sync + conflict
-- classification) include them.

-- name: CreateAccount :one
-- id is the optional client-generated id (offline-first clients).
INSERT INTO accounts (id, household_id, user_id, name, currency, opening_balance)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING
    id,
    user_id,
    name,
    currency,
    opening_balance,
    opening_balance::bigint AS balance,
    created_at,
    updated_at,
    version;

-- name: UpdateAccount :one
-- Optimistic concurrency: the WHERE clause includes version = @version (and
-- liveness) so a concurrent update yields zero rows. COALESCE keeps a column
-- unchanged when its narg is NULL (PATCH semantics). The post-update balance
-- comes from account_with_balance via the CTE (RETURNING cannot join).
WITH updated AS (
    UPDATE accounts
    SET
        name       = COALESCE(sqlc.narg('name'), name),
        version    = version + 1,
        updated_at        = now()
    WHERE accounts.id = @id AND accounts.household_id = @household_id
      AND accounts.deleted_at IS NULL AND accounts.version = @version
    RETURNING
        accounts.id,
        accounts.user_id,
        accounts.name,
        accounts.currency,
        accounts.opening_balance,
        accounts.created_at,
        accounts.updated_at,
        accounts.version
)
SELECT
    u.id,
    u.user_id,
    u.name,
    u.currency,
    u.opening_balance,
    v.balance,
    u.created_at,
    u.updated_at,
    u.version
FROM updated u
JOIN account_with_balance v ON v.id = u.id;

-- name: SoftDeleteAccount :one
-- Tombstone (never a hard DELETE): excluded from listings, retained for sync.
UPDATE accounts
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING version;

-- name: GetAccount :one
SELECT
    id,
    user_id,
    name,
    currency,
    opening_balance,
    balance,
    created_at,
    updated_at,
    version
FROM account_with_balance
WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: GetAccountAny :one
-- Includes tombstoned rows; used by sync push (serverState / idempotent
-- delete) and REST conflict classification.
SELECT
    id,
    user_id,
    name,
    currency,
    opening_balance,
    balance,
    created_at,
    updated_at,
    version,
    deleted_at
FROM account_with_balance
WHERE id = $1 AND household_id = $2;

-- name: GetAccounts :many
SELECT
    id,
    user_id,
    name,
    currency,
    opening_balance,
    balance,
    created_at,
    updated_at,
    version
FROM account_with_balance
WHERE household_id = $1 AND deleted_at IS NULL
ORDER BY created_at, id;

-- name: HasLiveTransactionsForAccount :one
-- In-use guard for deletion: a non-deleted cashflow or transfer referencing
-- the account blocks the tombstone. Adjustments never block - they are the
-- account's own reconciliation bookkeeping and cascade with the delete
-- (SoftDeleteAdjustmentsForAccount).
SELECT EXISTS(
    SELECT 1
    FROM transactions
    WHERE household_id = @household_id
      AND deleted_at IS NULL
      AND type <> 'adjustment'
      AND (account_id = @account_id OR from_account_id = @account_id OR to_account_id = @account_id)
) AS in_use;

-- name: SoftDeleteAdjustmentsForAccount :many
-- Cascade half of an account delete: tombstone the account's live
-- adjustments (they reference no category and no second account, so they
-- carry no meaning without it). Returns id+version per row for the
-- per-record change_log appends.
UPDATE transactions
SET deleted_at = now(), version = version + 1, updated_at = now()
WHERE household_id = @household_id AND account_id = @account_id
  AND type = 'adjustment' AND deleted_at IS NULL
RETURNING id, version;

-- name: SyncReplaceAccount :one
-- Full-state CAS upsert from a sync push: applies only on the exact base
-- version of a live row; version increments by one. Post-update balance via
-- the CTE join on account_with_balance (RETURNING cannot join).
WITH updated AS (
    UPDATE accounts
    SET
        name            = @name,
        currency        = @currency,
        opening_balance = @opening_balance,
        version         = version + 1,
        updated_at        = now()
    WHERE accounts.id = @id AND accounts.household_id = @household_id
      AND accounts.deleted_at IS NULL AND accounts.version = @base_version
    RETURNING
        accounts.id,
        accounts.user_id,
        accounts.name,
        accounts.currency,
        accounts.opening_balance,
        accounts.created_at,
        accounts.updated_at,
        accounts.version
)
SELECT
    u.id,
    u.user_id,
    u.name,
    u.currency,
    u.opening_balance,
    v.balance,
    u.created_at,
    u.updated_at,
    u.version
FROM updated u
JOIN account_with_balance v ON v.id = u.id;

-- name: SyncAccountsByIDs :many
-- Batch fetch for pull data (current state of records named by change rows).
SELECT
    id,
    user_id,
    name,
    currency,
    opening_balance,
    created_at,
    updated_at,
    version,
    deleted_at
FROM accounts
WHERE household_id = @household_id AND id = ANY(@ids::uuid[]);
