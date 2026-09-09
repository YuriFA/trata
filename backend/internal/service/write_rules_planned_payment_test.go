package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
)

// Table tests for the planned payment write rules (ADR-0005): the reference
// rules both surfaces (REST service and sync push adapter) delegate to. The
// reads seam is stubbed; the service and e2e suites cover the two real read
// styles end to end.

func TestValidatePlannedPaymentWrite(t *testing.T) {
	t.Parallel()

	hh := uuid.New()
	acct := uuid.New()
	missingAcct := uuid.New()
	expenseCat := &domain.Category{ID: uuid.New(), Type: domain.TransactionTypeExpense}
	incomeCat := &domain.Category{ID: uuid.New(), Type: domain.TransactionTypeIncome}
	archivedCat := &domain.Category{
		ID: uuid.New(), Type: domain.TransactionTypeExpense, ArchivedAt: new(time.Now()),
	}
	missingCat := uuid.New()

	reads := stubRefReads{
		accounts: map[uuid.UUID]bool{acct: true},
		categories: map[uuid.UUID]*domain.Category{
			expenseCat.ID: expenseCat, incomeCat.ID: incomeCat, archivedCat.ID: archivedCat,
		},
	}

	cases := []struct {
		name       string
		accountID  uuid.UUID
		categoryID uuid.UUID
		typ        domain.TransactionType
		wantErr    error
	}{
		{
			"live account with matching live category ok",
			acct, expenseCat.ID, domain.TransactionTypeExpense, nil,
		},
		{
			"missing account",
			missingAcct, expenseCat.ID, domain.TransactionTypeExpense,
			domain.ErrPlannedPaymentAccountNotFound,
		},
		{
			"missing category",
			acct, missingCat, domain.TransactionTypeExpense,
			domain.ErrPlannedPaymentCategoryNotFound,
		},
		{
			"category type mismatch",
			acct, incomeCat.ID, domain.TransactionTypeExpense,
			domain.ErrPlannedPaymentCategoryTypeMismatch,
		},
		{
			"archived category rejected (a plan is a future obligation)",
			acct, archivedCat.ID, domain.TransactionTypeExpense,
			domain.ErrPlannedPaymentCategoryArchived,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := service.ValidatePlannedPaymentWrite(
				context.Background(), reads, domain.Scope{HouseholdID: hh}, tc.accountID, tc.categoryID, tc.typ,
			)
			if tc.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestValidatePlannedPaymentTypeImmutable(t *testing.T) {
	t.Parallel()

	require.NoError(t, service.ValidatePlannedPaymentTypeImmutable(
		domain.TransactionTypeExpense, domain.TransactionTypeExpense))
	require.ErrorIs(t, service.ValidatePlannedPaymentTypeImmutable(
		domain.TransactionTypeExpense, domain.TransactionTypeIncome),
		domain.ErrPlannedPaymentTypeImmutable)
}
