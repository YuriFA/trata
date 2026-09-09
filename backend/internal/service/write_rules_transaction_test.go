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

// Table tests for the transaction write rules (ADR-0005): the amount sign
// rule and the per-type reference rules both surfaces (REST service and sync
// push adapter) delegate to. The reads seam is stubbed; the service and
// sync-engine suites cover the two real read styles end to end.

type stubRefReads struct {
	accounts   map[uuid.UUID]bool
	categories map[uuid.UUID]*domain.Category
}

func (s stubRefReads) AccountExists(_ context.Context, _ domain.Scope, id uuid.UUID) (bool, error) {
	return s.accounts[id], nil
}

func (s stubRefReads) Category(_ context.Context, _ domain.Scope, id uuid.UUID) (*domain.Category, error) {
	if c, ok := s.categories[id]; ok {
		return c, nil
	}
	return nil, domain.ErrCategoryNotFound
}

func TestValidateTransactionWrite_AmountRule(t *testing.T) {
	t.Parallel()
	reads := stubRefReads{accounts: map[uuid.UUID]bool{}, categories: map[uuid.UUID]*domain.Category{}}

	cases := []struct {
		name    string
		typ     domain.TransactionType
		amount  int64
		wantErr error
	}{
		{"income positive ok", domain.TransactionTypeIncome, 100, nil},
		{"expense positive ok", domain.TransactionTypeExpense, 1, nil},
		{"income zero rejected", domain.TransactionTypeIncome, 0, domain.ErrInvalidAmount},
		{"income negative rejected", domain.TransactionTypeIncome, -5, domain.ErrInvalidAmount},
		{"transfer positive ok", domain.TransactionTypeTransfer, 500, nil},
		{"transfer zero rejected", domain.TransactionTypeTransfer, 0, domain.ErrInvalidAmount},
		{"adjustment positive ok", domain.TransactionTypeAdjustment, 42, nil},
		{"adjustment negative ok (reconciliation delta)", domain.TransactionTypeAdjustment, -42, nil},
		{"adjustment zero rejected", domain.TransactionTypeAdjustment, 0, domain.ErrInvalidAmount},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			state := service.TransactionWriteState{Type: tc.typ, Amount: tc.amount}
			// Ref-free variants (cashflow category presence etc.) are the
			// reference-rule cases below; here only the amount rule can fire
			// before any read, except cashflow's category requirement, so
			// give cashflow a dummy category id set and expect ErrInvalidRefs
			// only when amount passed.
			err := service.ValidateTransactionWrite(
				context.Background(),
				reads,
				domain.Scope{HouseholdID: uuid.Nil},
				state,
			)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			// Amount passed: cashflow without refs is an ErrInvalidRefs, not
			// an amount error - proves the amount check let it through.
			require.ErrorIs(t, err, domain.ErrInvalidRefs)
		})
	}
}

func TestValidateTransactionWrite_CashflowRefs(t *testing.T) {
	t.Parallel()

	hh := uuid.New()
	acct := uuid.New()
	missingAcct := uuid.New()
	income := &domain.Category{ID: uuid.New(), Type: domain.TransactionTypeIncome}
	expense := &domain.Category{ID: uuid.New(), Type: domain.TransactionTypeExpense}
	archived := &domain.Category{ID: uuid.New(), Type: domain.TransactionTypeIncome, ArchivedAt: new(time.Now())}
	missing := uuid.New()

	reads := stubRefReads{
		accounts: map[uuid.UUID]bool{acct: true},
		categories: map[uuid.UUID]*domain.Category{
			income.ID: income, expense.ID: expense, archived.ID: archived,
		},
	}

	cases := []struct {
		name    string
		state   service.TransactionWriteState
		wantErr error
	}{
		{
			"account-less income with a live matching category ok",
			service.TransactionWriteState{Type: domain.TransactionTypeIncome, Amount: 10, CategoryID: new(income.ID)},
			nil,
		},
		{
			"expense with account and matching category ok",
			service.TransactionWriteState{
				Type: domain.TransactionTypeExpense, Amount: 10,
				AccountID: new(acct), CategoryID: new(expense.ID),
			},
			nil,
		},
		{
			"missing account",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10,
				AccountID: new(missingAcct), CategoryID: new(income.ID),
			},
			domain.ErrTransactionAccountNotFound,
		},
		{
			"missing category",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10, CategoryID: new(missing),
			},
			domain.ErrTransactionCategoryNotFound,
		},
		{
			"category type mismatch",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10, CategoryID: new(expense.ID),
			},
			domain.ErrCategoryTypeMismatch,
		},
		{
			"archived category newly assigned",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10, CategoryID: new(archived.ID),
			},
			domain.ErrCategoryArchived,
		},
		{
			"archived category reassigned from another category",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10,
				CategoryID: new(archived.ID), PrevCategoryID: new(income.ID),
			},
			domain.ErrCategoryArchived,
		},
		{
			"archived category kept on the record it already labels",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10,
				CategoryID: new(archived.ID), PrevCategoryID: new(archived.ID),
			},
			nil,
		},
		{
			"transfer refs on a cashflow rejected",
			service.TransactionWriteState{
				Type: domain.TransactionTypeIncome, Amount: 10, CategoryID: new(income.ID),
				FromAccountID: new(acct), ToAccountID: new(acct),
			},
			domain.ErrInvalidRefs,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := service.ValidateTransactionWrite(
				context.Background(),
				reads,
				domain.Scope{HouseholdID: hh},
				tc.state,
			)
			if tc.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestValidateTransactionWrite_TransferRefs(t *testing.T) {
	t.Parallel()

	hh := uuid.New()
	from := uuid.New()
	to := uuid.New()
	missing := uuid.New()
	reads := stubRefReads{
		accounts:   map[uuid.UUID]bool{from: true, to: true},
		categories: map[uuid.UUID]*domain.Category{},
	}

	cases := []struct {
		name    string
		state   service.TransactionWriteState
		wantErr error
	}{
		{
			"distinct live endpoints ok",
			service.TransactionWriteState{
				Type: domain.TransactionTypeTransfer, Amount: 10,
				FromAccountID: new(from), ToAccountID: new(to),
			},
			nil,
		},
		{
			"missing from account",
			service.TransactionWriteState{
				Type: domain.TransactionTypeTransfer, Amount: 10,
				FromAccountID: new(missing), ToAccountID: new(to),
			},
			domain.ErrTransactionFromAccountNotFound,
		},
		{
			"missing to account",
			service.TransactionWriteState{
				Type: domain.TransactionTypeTransfer, Amount: 10,
				FromAccountID: new(from), ToAccountID: new(missing),
			},
			domain.ErrTransactionToAccountNotFound,
		},
		{
			"same account transfer",
			service.TransactionWriteState{
				Type: domain.TransactionTypeTransfer, Amount: 10,
				FromAccountID: new(from), ToAccountID: new(from),
			},
			domain.ErrSameAccountTransfer,
		},
		{
			"cashflow refs on a transfer rejected",
			service.TransactionWriteState{
				Type: domain.TransactionTypeTransfer, Amount: 10,
				FromAccountID: new(from), ToAccountID: new(to), AccountID: new(from),
			},
			domain.ErrInvalidRefs,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := service.ValidateTransactionWrite(
				context.Background(),
				reads,
				domain.Scope{HouseholdID: hh},
				tc.state,
			)
			if tc.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestValidateTransactionWrite_AdjustmentRefs(t *testing.T) {
	t.Parallel()

	hh := uuid.New()
	acct := uuid.New()
	missing := uuid.New()
	cat := &domain.Category{ID: uuid.New(), Type: domain.TransactionTypeExpense}
	reads := stubRefReads{
		accounts:   map[uuid.UUID]bool{acct: true},
		categories: map[uuid.UUID]*domain.Category{cat.ID: cat},
	}

	cases := []struct {
		name    string
		state   service.TransactionWriteState
		wantErr error
	}{
		{
			"live account ok",
			service.TransactionWriteState{
				Type: domain.TransactionTypeAdjustment, Amount: -10, AccountID: new(acct),
			},
			nil,
		},
		{
			"missing account",
			service.TransactionWriteState{
				Type: domain.TransactionTypeAdjustment, Amount: 10, AccountID: new(missing),
			},
			domain.ErrTransactionAccountNotFound,
		},
		{
			"category on an adjustment rejected",
			service.TransactionWriteState{
				Type: domain.TransactionTypeAdjustment, Amount: 10,
				AccountID: new(acct), CategoryID: new(cat.ID),
			},
			domain.ErrInvalidRefs,
		},
		{
			"no account rejected",
			service.TransactionWriteState{Type: domain.TransactionTypeAdjustment, Amount: 10},
			domain.ErrInvalidRefs,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := service.ValidateTransactionWrite(
				context.Background(),
				reads,
				domain.Scope{HouseholdID: hh},
				tc.state,
			)
			if tc.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestValidateTransactionTypeImmutable(t *testing.T) {
	t.Parallel()

	require.NoError(t, service.ValidateTransactionTypeImmutable(
		domain.TransactionTypeIncome, domain.TransactionTypeIncome))
	require.ErrorIs(t, service.ValidateTransactionTypeImmutable(
		domain.TransactionTypeIncome, domain.TransactionTypeExpense), domain.ErrTransactionTypeImmutable)
}
