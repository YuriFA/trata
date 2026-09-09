package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// householdOf resolves the user's (single, v1) personal household id - the
// scoping key every repository call takes.
func householdOf(t *testing.T, userID uuid.UUID) uuid.UUID {
	t.Helper()
	m, err := testRepo.GetMembershipByUser(newCtx(t), userID)
	if err != nil {
		t.Fatalf("householdOf: %v", err)
	}
	return m.HouseholdID
}

// mustNow returns a UTC timestamp suitable for occurred_at.
func mustNow() time.Time {
	return time.Now().UTC()
}

// seedCategory creates an income category for the user's household and returns it.
func seedCategory(t *testing.T, householdID, userID uuid.UUID, name string) *domain.Category {
	t.Helper()
	ctx := newCtx(t)
	c, err := testRepo.CreateCategory(ctx, domain.CreateCategoryParams{
		HouseholdID: householdID, UserID: userID,
		Name: name, Type: domain.TransactionTypeIncome, Icon: "x", Color: "#fff",
	})
	if err != nil {
		t.Fatalf("seedCategory: %v", err)
	}
	return c
}

// seedAccount creates an account for the user's household and returns it.
func seedAccount(t *testing.T, householdID, userID uuid.UUID) *domain.Account {
	t.Helper()
	ctx := newCtx(t)
	a, err := testRepo.CreateAccount(ctx, domain.CreateAccountParams{
		HouseholdID: householdID, UserID: userID, Name: "A", Currency: "USD", OpeningBalance: 0,
	})
	if err != nil {
		t.Fatalf("seedAccount: %v", err)
	}
	return a
}
