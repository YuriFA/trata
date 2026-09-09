package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/service"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// Two-household isolation fixtures (household-scoping change): the shared
// records of one household are invisible to non-members (not-found, no data
// revealed), while members see and mutate them equally. The sibling member is
// placed into the owner's household via the fake's membership helper - the
// same row shape the change-2 join flow will write.

// isolationFixture wires the entity services over one store and returns:
// owner (household A's owner), sibling (a member added to household A), and
// outsider (the owner of household B).
type isolationFixture struct {
	store        *fakes.Store
	acctSvc      *service.AccountService
	catSvc       *service.CategoryService
	txSvc        *service.TransactionService
	debtorSvc    *service.DebtorService
	debtOpSvc    *service.DebtOperationService
	householdSvc *service.HouseholdService
	owner        *domain.User
	ownerHH      uuid.UUID
	sibling      *domain.User
	outsider     *domain.User
	outsiderHH   uuid.UUID
}

func newIsolationFixture(t *testing.T) *isolationFixture {
	t.Helper()
	store := fakes.New()
	f := &isolationFixture{
		store:     store,
		acctSvc:   service.NewAccountService(store),
		catSvc:    service.NewCategoryService(store),
		txSvc:     service.NewTransactionService(store, store, store),
		debtorSvc: service.NewDebtorService(store),
		debtOpSvc: service.NewDebtOperationService(store, store),
		householdSvc: service.NewHouseholdService(
			store,
			store,
			service.NewLogMailer(logger.NewDiscardLogger()),
			logger.NewDiscardLogger(),
			service.HouseholdJoinConfig{},
		),
	}
	f.owner = seedFakeUser(t, store)
	f.ownerHH = householdOf(t, store, f.owner.ID)
	f.sibling = seedFakeUser(t, store)
	store.AddMembership(f.sibling.ID, f.ownerHH, domain.HouseholdRoleMember)
	f.outsider = seedFakeUser(t, store)
	f.outsiderHH = householdOf(t, store, f.outsider.ID)
	return f
}

func TestHouseholdScoping_MemberSeesSiblingRecords(t *testing.T) {
	t.Parallel()
	f := newIsolationFixture(t)
	ctx := context.Background()

	acct, err := f.acctSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateAccountParams{
			Name: "Family card", Currency: "USD", OpeningBalance: 1000,
		},
	)
	require.NoError(t, err)
	cat, err := f.catSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateCategoryParams{
			Name: "Groceries", Type: domain.TransactionTypeExpense, Icon: "i", Color: "#fff",
		},
	)
	require.NoError(t, err)

	// The sibling lists the household's records like their own.
	accounts, err := f.acctSvc.List(ctx, domain.Scope{HouseholdID: f.ownerHH})
	require.NoError(t, err)
	assert.Len(t, accounts, 1)
	categories, err := f.catSvc.List(ctx, domain.Scope{HouseholdID: f.ownerHH}, domain.GetCategoriesParams{})
	require.NoError(t, err)
	assert.Len(t, categories, 1)

	// The sibling reads the owner's record by id.
	got, err := f.acctSvc.Get(ctx, domain.Scope{HouseholdID: f.ownerHH}, acct.ID)
	require.NoError(t, err)
	assert.Equal(t, acct.ID, got.ID)

	// The sibling creates a transaction referencing the owner's account and
	// category; the authorship stamp is the sibling, not the record owner.
	now := time.Now().UTC()
	tx, err := f.txSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.sibling.ID},
		domain.CreateTransactionParams{
			Type: domain.TransactionTypeExpense, Amount: 500, OccurredAt: now,
			AccountID: &acct.ID, CategoryID: &cat.ID,
		},
	)
	require.NoError(t, err)
	assert.Equal(t, f.sibling.ID, tx.UserID, "authorship = the acting member")

	listed, err := f.txSvc.List(ctx, domain.Scope{HouseholdID: f.ownerHH}, service.TransactionListQuery{})
	require.NoError(t, err)
	require.Len(t, listed.Transactions, 1)
	assert.Equal(t, f.sibling.ID, listed.Transactions[0].UserID)

	// Balances are household-wide: the sibling sees the owner's account
	// balance (via the listing) including their own transaction.
	relisted, err := f.acctSvc.List(ctx, domain.Scope{HouseholdID: f.ownerHH})
	require.NoError(t, err)
	require.Len(t, relisted, 1)
	assert.Equal(t, int64(500), relisted[0].Balance)
}

func TestHouseholdScoping_NonMemberGetsNotFound(t *testing.T) {
	t.Parallel()
	f := newIsolationFixture(t)
	ctx := context.Background()

	acct, err := f.acctSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateAccountParams{
			Name: "Family card", Currency: "USD", OpeningBalance: 1000,
		},
	)
	require.NoError(t, err)
	cat, err := f.catSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateCategoryParams{
			Name: "Groceries", Type: domain.TransactionTypeExpense, Icon: "i", Color: "#fff",
		},
	)
	require.NoError(t, err)
	debtor, err := f.debtorSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateDebtorParams{Name: "Анна"},
	)
	require.NoError(t, err)

	// Reads by id: not-found, never the row.
	_, err = f.acctSvc.Get(ctx, domain.Scope{HouseholdID: f.outsiderHH}, acct.ID)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)
	_, err = f.catSvc.Get(ctx, domain.Scope{HouseholdID: f.outsiderHH}, cat.ID)
	require.ErrorIs(t, err, domain.ErrCategoryNotFound)
	_, err = f.debtorSvc.Get(ctx, domain.Scope{HouseholdID: f.outsiderHH}, debtor.ID)
	require.ErrorIs(t, err, domain.ErrDebtorNotFound)

	// Listings are empty, not an error.
	accounts, err := f.acctSvc.List(ctx, domain.Scope{HouseholdID: f.outsiderHH})
	require.NoError(t, err)
	assert.Empty(t, accounts)

	// Transaction references into the foreign household read as not-found
	// references (REST granularity), as if the record did not exist.
	now := time.Now().UTC()
	_, err = f.txSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.outsiderHH, ActorID: f.outsider.ID},
		domain.CreateTransactionParams{
			Type: domain.TransactionTypeExpense, Amount: 100, OccurredAt: now,
			AccountID: &acct.ID, CategoryID: &cat.ID,
		},
	)
	require.ErrorIs(t, err, domain.ErrTransactionAccountNotFound)

	// Debt-operation references likewise.
	_, err = f.debtOpSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.outsiderHH, ActorID: f.outsider.ID},
		domain.CreateDebtOperationParams{
			DebtorID: debtor.ID, Direction: domain.DebtDirectionReceivable,
			Kind: domain.DebtOperationKindDebt, Amount: 100, OccurredAt: now,
		},
	)
	require.ErrorIs(t, err, domain.ErrDebtOperationDebtorNotFound)

	// Writes (update/delete) on foreign records are not-found, not applied.
	name := "Hacked"
	_, err = f.acctSvc.Update(ctx, domain.Scope{HouseholdID: f.outsiderHH, ActorID: f.outsider.ID}, acct.ID,
		domain.UpdateAccountParams{Name: &name, Version: acct.Version})
	require.ErrorIs(t, err, domain.ErrAccountNotFound)
	err = f.acctSvc.Delete(ctx, domain.Scope{HouseholdID: f.outsiderHH, ActorID: f.outsider.ID}, acct.ID)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)
}

func TestHouseholdScoping_NamesUniquePerHousehold(t *testing.T) {
	t.Parallel()
	f := newIsolationFixture(t)
	ctx := context.Background()

	// Categories: duplicate inside the household rejected (even from a
	// different member); the same name in another household is fine.
	_, err := f.catSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateCategoryParams{
			Name: "Food", Type: domain.TransactionTypeExpense, Icon: "i", Color: "#fff",
		},
	)
	require.NoError(t, err)
	_, err = f.catSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.sibling.ID},
		domain.CreateCategoryParams{
			Name: "Food", Type: domain.TransactionTypeIncome, Icon: "i", Color: "#fff",
		},
	)
	require.ErrorIs(t, err, domain.ErrCategoryAlreadyExists)
	_, err = f.catSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.outsiderHH, ActorID: f.outsider.ID},
		domain.CreateCategoryParams{
			Name: "Food", Type: domain.TransactionTypeExpense, Icon: "i", Color: "#fff",
		},
	)
	require.NoError(t, err)

	// Debtors: the same rule.
	_, err = f.debtorSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateDebtorParams{Name: "Анна"},
	)
	require.NoError(t, err)
	_, err = f.debtorSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.sibling.ID},
		domain.CreateDebtorParams{Name: "Анна"},
	)
	require.ErrorIs(t, err, domain.ErrDebtorAlreadyExists)
	_, err = f.debtorSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.outsiderHH, ActorID: f.outsider.ID},
		domain.CreateDebtorParams{Name: "Анна"},
	)
	require.NoError(t, err)
}

func TestHouseholdService_ListsMembers(t *testing.T) {
	t.Parallel()
	f := newIsolationFixture(t)
	ctx := context.Background()

	h, err := f.householdSvc.Get(ctx, domain.Scope{HouseholdID: f.ownerHH})
	require.NoError(t, err)
	require.Len(t, h.Members, 2)
	assert.Equal(t, f.owner.ID, h.Members[0].UserID)
	assert.Equal(t, domain.HouseholdRoleOwner, h.Members[0].Role)
	assert.Equal(t, f.owner.Email, h.Members[0].Email)
	assert.Nil(t, h.Members[0].DisplayName, "display name absent before it is set")
	assert.Equal(t, f.sibling.ID, h.Members[1].UserID)
	assert.Equal(t, domain.HouseholdRoleMember, h.Members[1].Role)
}

func TestHouseholdService_UnknownHousehold(t *testing.T) {
	t.Parallel()
	f := newIsolationFixture(t)
	_, err := f.householdSvc.Get(context.Background(), domain.Scope{HouseholdID: uuid.New()})
	require.ErrorIs(t, err, domain.ErrHouseholdNotFound)
}

func TestAuthService_UpdateDisplayName(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)

	// Invalid: empty after trim, whitespace-only, over the cap.
	for _, bad := range []string{"", "   ", strings.Repeat("x", 101)} {
		_, err := authSvc.UpdateDisplayName(ctx, user.ID, bad)
		require.ErrorIs(t, err, domain.ErrInvalidDisplayName, "value %q", bad)
	}

	// Set + change; the trimmed value is stored.
	updated, err := authSvc.UpdateDisplayName(ctx, user.ID, "  Юрий  ")
	require.NoError(t, err)
	require.NotNil(t, updated.DisplayName)
	assert.Equal(t, "Юрий", *updated.DisplayName)
	updated, err = authSvc.UpdateDisplayName(ctx, user.ID, "Юра")
	require.NoError(t, err)
	require.NotNil(t, updated.DisplayName)
	assert.Equal(t, "Юра", *updated.DisplayName)

	// The member listing reflects the current value.
	householdSvc := service.NewHouseholdService(
		store,
		store,
		service.NewLogMailer(logger.NewDiscardLogger()),
		logger.NewDiscardLogger(),
		service.HouseholdJoinConfig{},
	)
	householdID := householdOf(t, store, user.ID)
	h, err := householdSvc.Get(ctx, domain.Scope{HouseholdID: householdID})
	require.NoError(t, err)
	require.Len(t, h.Members, 1)
	require.NotNil(t, h.Members[0].DisplayName)
	assert.Equal(t, "Юра", *h.Members[0].DisplayName)
}
