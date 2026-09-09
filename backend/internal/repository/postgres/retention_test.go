package postgres_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
)

// The retention sweep hard-deletes tombstoned rows older than the cutoff, in
// FK-safe order (transactions first), while recent tombstones, live rows, and
// the change_log (which pulls serve tombstones from) are left untouched.
func TestTombstoneRetentionDeletesOnlyExpiredTombstones(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "retention")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	oldCategory := seedCategory(t, userHH, user.ID, "old-cat")
	oldAccount := seedAccount(t, userHH, user.ID)
	oldTxn, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID,
		Type:        domain.TransactionTypeExpense,
		Amount:      100,
		OccurredAt:  mustNow(),
		AccountID:   &oldAccount.ID,
		CategoryID:  &oldCategory.ID,
	})
	require.NoError(t, err, "seed old transaction")

	recentCategory := seedCategory(t, userHH, user.ID, "recent-cat")
	liveAccount := seedAccount(t, userHH, user.ID)

	// Soft-delete in dependency order (guards reject deletes while referenced).
	require.NoError(
		t,
		testRepo.DeleteTransaction(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, oldTxn.ID),
		"delete old transaction",
	)
	require.NoError(
		t,
		testRepo.DeleteCategory(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, oldCategory.ID, false),
		"delete old category",
	)
	require.NoError(
		t,
		testRepo.DeleteAccount(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, oldAccount.ID),
		"delete old account",
	)
	require.NoError(
		t,
		testRepo.DeleteCategory(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, recentCategory.ID, false),
		"delete recent category",
	)

	// Backdate the old tombstones beyond the 90-day cutoff; leave the recent
	// tombstone at now().
	backdate := func(table string, id string) {
		t.Helper()
		_, err := testPool.Exec(ctx,
			"UPDATE "+table+" SET deleted_at = now() - interval '100 days' WHERE id = $1", id)
		require.NoError(t, err, "backdate %s", table)
	}
	backdate("transactions", oldTxn.ID.String())
	backdate("categories", oldCategory.ID.String())
	backdate("accounts", oldAccount.ID.String())

	cutoff := time.Now().UTC().Add(-90 * 24 * time.Hour)

	n, err := testRepo.DeleteTombstonedTransactionsBefore(ctx, cutoff)
	require.NoError(t, err)
	assert.EqualValues(t, 1, n, "one old tombstoned transaction deleted")
	n, err = testRepo.DeleteTombstonedCategoriesBefore(ctx, cutoff)
	require.NoError(t, err)
	assert.EqualValues(t, 1, n, "one old tombstoned category deleted")
	n, err = testRepo.DeleteTombstonedAccountsBefore(ctx, cutoff)
	require.NoError(t, err)
	assert.EqualValues(t, 1, n, "one old tombstoned account deleted")

	count := func(query string, args ...any) int {
		t.Helper()
		var c int
		require.NoError(t, testPool.QueryRow(ctx, query, args...).Scan(&c))
		return c
	}

	assert.Equal(t, 0, count("SELECT count(*) FROM transactions WHERE id = $1", oldTxn.ID), "old txn row gone")
	assert.Equal(t, 0, count("SELECT count(*) FROM categories WHERE id = $1", oldCategory.ID), "old category row gone")
	assert.Equal(t, 0, count("SELECT count(*) FROM accounts WHERE id = $1", oldAccount.ID), "old account row gone")

	assert.Equal(t, 1, count("SELECT count(*) FROM categories WHERE id = $1", recentCategory.ID),
		"recent tombstone kept until its window elapses")
	assert.Equal(t, 1, count("SELECT count(*) FROM accounts WHERE id = $1", liveAccount.ID),
		"live account untouched")

	// The change_log must survive the sweep: pulls serve these tombstones to
	// devices that were offline during the window.
	for _, row := range []struct{ entity, id string }{
		{"transaction", oldTxn.ID.String()},
		{"category", oldCategory.ID.String()},
		{"account", oldAccount.ID.String()},
	} {
		assert.Equal(
			t,
			1,
			count(
				"SELECT count(*) FROM change_log WHERE user_id = $1 AND entity = $2 AND entity_id = $3 AND action = 'tombstone'",
				user.ID,
				row.entity,
				row.id,
			),
			"change_log keeps the %s tombstone",
			row.entity,
		)
	}
}

// A second pass with the same cutoff is idempotent (nothing left to delete).
func TestTombstoneRetentionIsIdempotent(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "retention-idem")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	category := seedCategory(t, userHH, user.ID, "idem-cat")
	require.NoError(
		t,
		testRepo.DeleteCategory(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, category.ID, false),
	)
	_, err := testPool.Exec(ctx,
		"UPDATE categories SET deleted_at = now() - interval '100 days' WHERE id = $1", category.ID)
	require.NoError(t, err)

	cutoff := time.Now().UTC().Add(-90 * 24 * time.Hour)
	_, err = testRepo.DeleteTombstonedCategoriesBefore(ctx, cutoff)
	require.NoError(t, err)

	n, err := testRepo.DeleteTombstonedCategoriesBefore(ctx, cutoff)
	require.NoError(t, err)
	assert.EqualValues(t, 0, n, "second sweep deletes nothing")
}
