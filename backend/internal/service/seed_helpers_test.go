package service_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

func seedFakeUser(t *testing.T, store *fakes.Store) *domain.User {
	t.Helper()
	u, err := store.RegisterUser(context.Background(), domain.RegisterUserParams{
		Email:        fmt.Sprintf("u-%d@example.com", time.Now().UnixNano()),
		PasswordHash: "hashed",
	})
	if err != nil {
		t.Fatalf("seedFakeUser: %v", err)
	}
	return u
}

// householdOf resolves the user's (single, v1) personal household id - the
// scoping key every service call takes.
func householdOf(t *testing.T, store *fakes.Store, userID uuid.UUID) uuid.UUID {
	t.Helper()
	m, err := store.GetMembershipByUser(context.Background(), userID)
	if err != nil {
		t.Fatalf("householdOf: %v", err)
	}
	return m.HouseholdID
}

func seedFakeAccount(t *testing.T, store *fakes.Store, scope domain.Scope, userID uuid.UUID) *domain.Account {
	t.Helper()
	a, err := store.CreateAccount(context.Background(), domain.CreateAccountParams{
		HouseholdID: scope.HouseholdID, UserID: userID, Name: "A", Currency: "USD", OpeningBalance: 0,
	})
	if err != nil {
		t.Fatalf("seedFakeAccount: %v", err)
	}
	return a
}

func seedFakeCategory(
	t *testing.T,
	store *fakes.Store,
	scope domain.Scope, userID uuid.UUID,
	name string,
	typ domain.TransactionType,
) *domain.Category {
	t.Helper()
	c, err := store.CreateCategory(context.Background(), domain.CreateCategoryParams{
		HouseholdID: scope.HouseholdID, UserID: userID, Name: name, Type: typ, Icon: "i", Color: "#fff",
	})
	if err != nil {
		t.Fatalf("seedFakeCategory: %v", err)
	}
	return c
}

func strPtr(s string) *string { x := s; return &x }
func i64(v int64) *int64      { x := v; return &x }
