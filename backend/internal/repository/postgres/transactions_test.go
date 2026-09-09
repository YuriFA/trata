package postgres_test

import (
	"bytes"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
)

func TestTransactionCursorPagination(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "cursor")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	acct := seedAccount(t, userHH, user.ID)
	cat := seedCategory(t, userHH, user.ID, "CustomIncome")

	// Insert 5 transactions with distinct occurred_at (oldest first).
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	ids := make([]string, 5)
	for i := range 5 {
		tx, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
			HouseholdID: userHH,
			UserID:      user.ID,
			Type:        domain.TransactionTypeIncome,
			Amount:      int64(100 + i),
			Description: "t",
			OccurredAt:  base.Add(time.Duration(i) * time.Hour),
			AccountID:   &acct.ID,
			CategoryID:  &cat.ID,
		})
		require.NoError(t, err)
		ids[i] = tx.ID.String()
	}

	page := 2
	fetch := page + 1 // service fetches page+1 to detect a next page

	// Page 1 (fetch): newest 3 = ids[4], ids[3], ids[2]. Service trims to the
	// first 2 and encodes the cursor from the 2nd item (ids[3]).
	first, err := testRepo.GetTransactions(
		ctx,
		domain.Scope{HouseholdID: userHH},
		domain.GetTransactionsParams{Limit: &fetch},
	)
	require.NoError(t, err)
	require.Len(t, first, 3)
	assert.Equal(t, ids[4], first[0].ID.String())
	assert.Equal(t, ids[3], first[1].ID.String())

	// Page 2: cursor at ids[3] -> everything strictly after it: ids[2], ids[1], ids[0].
	cursor := &domain.TransactionCursor{OccurredAt: first[1].OccurredAt, ID: first[1].ID}
	remaining := 10
	second, err := testRepo.GetTransactions(
		ctx,
		domain.Scope{HouseholdID: userHH},
		domain.GetTransactionsParams{Limit: &remaining, Cursor: cursor},
	)
	require.NoError(t, err)
	require.Len(t, second, 3)
	assert.Equal(t, ids[2], second[0].ID.String())
	assert.Equal(t, ids[1], second[1].ID.String())
	assert.Equal(t, ids[0], second[2].ID.String())
}

func TestTransactionCursorTieBreakOnEqualOccurredAt(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "tie")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	acct := seedAccount(t, userHH, user.ID)
	cat := seedCategory(t, userHH, user.ID, "Sal")

	// Two transactions with the SAME occurred_at - id DESC breaks the tie.
	same := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
	_, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID, Type: domain.TransactionTypeIncome, Amount: 1, OccurredAt: same,
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)
	_, err = testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID, Type: domain.TransactionTypeIncome, Amount: 2, OccurredAt: same,
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)

	rows, err := testRepo.GetTransactions(
		ctx,
		domain.Scope{HouseholdID: userHH},
		domain.GetTransactionsParams{Limit: ptrInt(10)},
	)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	// Both share occurred_at; the lex-higher id comes first (DESC).
	require.Equal(t, 1, bytes.Compare(rows[0].ID[:], rows[1].ID[:]), "higher id sorts first")

	// Cursor on the lex-higher id yields the lower-id row only.
	higher := rows[0].ID
	lower := rows[1].ID
	cursor := &domain.TransactionCursor{OccurredAt: same, ID: higher}
	rows2, err := testRepo.GetTransactions(
		ctx,
		domain.Scope{HouseholdID: userHH},
		domain.GetTransactionsParams{Limit: ptrInt(10), Cursor: cursor},
	)
	require.NoError(t, err)
	require.Len(t, rows2, 1)
	assert.Equal(t, lower, rows2[0].ID)
}

func TestTransactionOptimisticConcurrency(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "occ")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	acct := seedAccount(t, userHH, user.ID)
	cat := seedCategory(t, userHH, user.ID, "Sal")

	tx, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID, Type: domain.TransactionTypeIncome, Amount: 100, OccurredAt: mustNow(),
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)
	require.Equal(t, 1, tx.Version)

	// Wrong version -> conflict.
	_, err = testRepo.UpdateTransaction(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx.ID,
		domain.UpdateTransactionParams{Version: 999, Amount: ptrInt64(200)},
	)
	require.ErrorIs(t, err, domain.ErrTransactionVersionConflict)

	// Correct version -> succeeds, version increments.
	desc := "updated"
	updated, err := testRepo.UpdateTransaction(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx.ID,
		domain.UpdateTransactionParams{Version: 1, Description: &desc},
	)
	require.NoError(t, err)
	assert.Equal(t, 2, updated.Version)
	assert.Equal(t, "updated", updated.Description)
}

func TestTransactionIDORScoping(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	owner := seedUser(t, "tx-owner")
	ownerHH := householdOf(t, owner.ID)
	intruder := seedUser(t, "tx-intruder")
	intruderHH := householdOf(t, intruder.ID)
	ctx := newCtx(t)

	acct := seedAccount(t, ownerHH, owner.ID)
	cat := seedCategory(t, ownerHH, owner.ID, "Sal")

	tx, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: ownerHH,
		UserID:      owner.ID, Type: domain.TransactionTypeIncome, Amount: 1, OccurredAt: mustNow(),
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)

	_, err = testRepo.GetTransaction(ctx, domain.Scope{HouseholdID: intruderHH}, tx.ID)
	require.ErrorIs(t, err, domain.ErrTransactionNotFound)

	err = testRepo.DeleteTransaction(ctx, domain.Scope{HouseholdID: intruderHH, ActorID: intruder.ID}, tx.ID)
	require.ErrorIs(t, err, domain.ErrTransactionNotFound)
}

func ptrInt(v int) *int       { x := v; return &x }
func ptrInt64(v int64) *int64 { x := v; return &x }
