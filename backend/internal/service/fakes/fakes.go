// Package fakes provides in-memory implementations of the repository interfaces
// for fast, hermetic service-layer unit tests (no database).
package fakes

import (
	"context"
	"crypto/subtle"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// Store is an in-memory fake implementing every repository interface. It
// approximates Postgres semantics enough to exercise service logic: unique
// constraints, FK existence, optimistic concurrency, and not-found mapping.
//
// Scoping is household-based like the real schema: every record keeps its
// author UserID, and a record belongs to the household its author was a member
// of when it was created (v1 memberships are immutable, so the resolution via
// the memberships map is exact).
type Store struct {
	mu sync.Mutex

	// now is the store's clock (invitation windows in the join-lifecycle
	// fake); tests may replace it via SetClock.
	now func() time.Time

	users        map[uuid.UUID]*domain.User
	emails       map[string]uuid.UUID // email -> user id
	sessions     map[string]*domain.Session
	accounts     map[uuid.UUID]*domain.Account
	categories   map[uuid.UUID]*domain.Category
	transactions map[uuid.UUID]*domain.Transaction
	debtors      map[uuid.UUID]*domain.Debtor
	debtOps      map[uuid.UUID]*domain.DebtOperation
	plans        map[uuid.UUID]*domain.PlannedPayment
	pushSubs     map[uuid.UUID]*domain.PushSubscription

	// households + memberships mirror the scoping tables: every user owns
	// exactly one household (v1), every record belongs to a household.
	households  map[uuid.UUID]*domain.Household  // id -> household shell
	memberships map[uuid.UUID]*domain.Membership // userID -> membership

	// Join lifecycle (household-join change): invitations by id and the
	// household's single code row.
	invitations []*domain.HouseholdInvitation
	codes       map[uuid.UUID]*domain.HouseholdCode // householdID -> code

	// catUnique enforces UNIQUE(household_id, name) among LIVE categories.
	catUnique map[string]struct{} // "householdID|name"
	// debtorUnique enforces UNIQUE(household_id, name) among LIVE debtors.
	debtorUnique map[string]struct{} // "householdID|name"

	// Sync plumbing: an in-memory change log (monotonic seq) and applied
	// operations, mirroring the Postgres tables closely enough to exercise
	// the sync service rules in hermetic tests.
	changeLog  []changeEntry
	nextSeq    int64
	appliedOps map[string]*domain.AppliedOperation // "householdID|opID"

	// idempotency: keyed by "userID|key"
	idemKeys map[string]*domain.IdempotencyKey

	verifyCodes  map[uuid.UUID]*verifyCode
	resetTokens  map[string]*resetToken // tokenHash -> resetToken
	verifyAge    map[uuid.UUID]int      // override for LatestVerificationCodeAgeSeconds
	verifyExists map[uuid.UUID]bool
	resetAge     map[uuid.UUID]int
	resetExists  map[uuid.UUID]bool
}

type changeEntry struct {
	seq         int64
	householdID uuid.UUID
	userID      uuid.UUID // author/actor of the change
	entity      string
	id          uuid.UUID
	action      string
	version     int
}

type verifyCode struct {
	code      string
	attempts  int
	expiresAt time.Time
	createdAt time.Time
}

type resetToken struct {
	userID    uuid.UUID
	expiresAt time.Time
	createdAt time.Time
}

// SetClock replaces the store's clock (default: [time.Now]).
func (s *Store) SetClock(now func() time.Time) { s.now = now }

// New returns an empty Store.
func New() *Store {
	return &Store{
		now:          func() time.Time { return time.Now().UTC() },
		users:        make(map[uuid.UUID]*domain.User),
		emails:       make(map[string]uuid.UUID),
		sessions:     make(map[string]*domain.Session),
		accounts:     make(map[uuid.UUID]*domain.Account),
		categories:   make(map[uuid.UUID]*domain.Category),
		transactions: make(map[uuid.UUID]*domain.Transaction),
		debtors:      make(map[uuid.UUID]*domain.Debtor),
		debtOps:      make(map[uuid.UUID]*domain.DebtOperation),
		plans:        make(map[uuid.UUID]*domain.PlannedPayment),
		pushSubs:     make(map[uuid.UUID]*domain.PushSubscription),
		households:   make(map[uuid.UUID]*domain.Household),
		memberships:  make(map[uuid.UUID]*domain.Membership),
		codes:        make(map[uuid.UUID]*domain.HouseholdCode),
		catUnique:    make(map[string]struct{}),
		debtorUnique: make(map[string]struct{}),
		appliedOps:   make(map[string]*domain.AppliedOperation),
		idemKeys:     make(map[string]*domain.IdempotencyKey),
		verifyCodes:  make(map[uuid.UUID]*verifyCode),
		resetTokens:  make(map[string]*resetToken),
		verifyAge:    make(map[uuid.UUID]int),
		verifyExists: make(map[uuid.UUID]bool),
		resetAge:     make(map[uuid.UUID]int),
		resetExists:  make(map[uuid.UUID]bool),
	}
}

// --- helpers --------------------------------------------------------------

func cloneUser(u *domain.User) *domain.User {
	c := *u
	return &c
}

// sameHousehold reports whether the record author (by membership) belongs to
// the household. Caller must hold s.mu.
func (s *Store) sameHousehold(authorUserID, householdID uuid.UUID) bool {
	m, ok := s.memberships[authorUserID]
	return ok && m.HouseholdID == householdID
}

// householdOf resolves the user's (single, v1) household id.
func (s *Store) householdOf(userID uuid.UUID) (uuid.UUID, bool) {
	m, ok := s.memberships[userID]
	if !ok {
		return uuid.Nil, false
	}
	return m.HouseholdID, true
}

// --- UserRepository -------------------------------------------------------

func (s *Store) RegisterUser(_ context.Context, params domain.RegisterUserParams) (*domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.emails[params.Email]; exists {
		return nil, domain.ErrUserAlreadyExists
	}
	now := time.Now().UTC()
	u := &domain.User{
		ID: uuid.New(), Email: params.Email, PasswordHash: params.PasswordHash,
		CreatedAt: now, UpdatedAt: now,
	}
	s.users[u.ID] = u
	s.emails[u.Email] = u.ID

	// Every registration creates the personal household + owner membership in
	// the same step (ADR-0002), mirroring the transactional Postgres flow.
	householdID := uuid.New()
	s.households[householdID] = &domain.Household{ID: householdID, CreatedAt: now}
	s.memberships[u.ID] = &domain.Membership{
		HouseholdID: householdID, UserID: u.ID, Role: domain.HouseholdRoleOwner, JoinedAt: now,
	}
	return cloneUser(u), nil
}

func (s *Store) GetUserByEmail(_ context.Context, email string) (*domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.emails[email]
	if !ok {
		return nil, domain.ErrUserNotFound
	}
	return cloneUser(s.users[id]), nil
}

func (s *Store) GetUserByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, domain.ErrUserNotFound
	}
	return cloneUser(u), nil
}

func (s *Store) UpdateDisplayName(_ context.Context, userID uuid.UUID, displayName string) (*domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[userID]
	if !ok {
		return nil, domain.ErrUserNotFound
	}
	name := displayName
	u.DisplayName = &name
	u.UpdatedAt = time.Now().UTC()
	return cloneUser(u), nil
}

// --- HouseholdRepository --------------------------------------------------

func (s *Store) GetMembershipByUser(_ context.Context, userID uuid.UUID) (*domain.Membership, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.memberships[userID]
	if !ok {
		return nil, domain.ErrMembershipNotFound
	}
	c := *m
	return &c, nil
}

func (s *Store) GetHouseholdWithMembers(_ context.Context, scope domain.Scope) (*domain.Household, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.householdWithMembersLocked(householdID)
}

// AddMembership inserts an additional membership row (the shape the change-2
// join flow will write). Test-only: v1 registration creates exactly one owner
// membership per user; this helper lets isolation tests place a second user
// into an existing household.
func (s *Store) AddMembership(userID, householdID uuid.UUID, role domain.HouseholdRole) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.households[householdID]; !exists {
		panic("fakes: AddMembership into unknown household")
	}
	s.memberships[userID] = &domain.Membership{
		HouseholdID: householdID, UserID: userID, Role: role, JoinedAt: time.Now().UTC(),
	}
}

// --- SessionRepository ----------------------------------------------------

func (s *Store) CreateSession(_ context.Context, params domain.CreateSessionParams) (*domain.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	sess := &domain.Session{
		ID:        params.SessionID,
		UserID:    params.UserID,
		ExpiresAt: params.ExpiresAt,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.sessions[sess.ID] = sess
	c := *sess
	return &c, nil
}

func (s *Store) GetSessionByID(_ context.Context, id string) (*domain.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok || sess.ExpiresAt.Before(time.Now()) {
		return nil, domain.ErrSessionNotFound
	}
	c := *sess
	return &c, nil
}

func (s *Store) DeleteSession(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.sessions[id]; !ok {
		return domain.ErrSessionNotFound
	}
	delete(s.sessions, id)
	return nil
}

func (s *Store) ExtendSession(_ context.Context, id string, newExpiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok || sess.ExpiresAt.Before(time.Now()) {
		return domain.ErrSessionNotFound
	}
	sess.ExpiresAt = newExpiresAt
	return nil
}

func (s *Store) DeleteExpiredSessions(_ context.Context) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	for id, sess := range s.sessions {
		if sess.ExpiresAt.Before(time.Now()) {
			delete(s.sessions, id)
			n++
		}
	}
	return n, nil
}

func (s *Store) GetSessionsByUser(_ context.Context, userID uuid.UUID) ([]domain.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.Session
	for _, sess := range s.sessions {
		if sess.UserID == userID && sess.ExpiresAt.After(time.Now()) {
			out = append(out, *sess)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *Store) DeleteSessionsByUserExcept(_ context.Context, userID uuid.UUID, except string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	for id, sess := range s.sessions {
		if sess.UserID == userID && id != except {
			delete(s.sessions, id)
			n++
		}
	}
	return n, nil
}

func (s *Store) DeleteSessionsByUser(_ context.Context, userID uuid.UUID) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	for id, sess := range s.sessions {
		if sess.UserID == userID {
			delete(s.sessions, id)
			n++
		}
	}
	return n, nil
}

// --- AccountRepository ----------------------------------------------------

func (s *Store) CreateAccount(_ context.Context, params domain.CreateAccountParams) (*domain.Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := params.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	if _, exists := s.accounts[id]; exists {
		return nil, domain.ErrAccountAlreadyExists
	}
	now := time.Now().UTC()
	a := &domain.Account{
		ID: id, UserID: params.UserID, Name: params.Name, Currency: params.Currency,
		OpeningBalance: params.OpeningBalance,
		Balance:        params.OpeningBalance, CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	s.accounts[a.ID] = a
	s.appendChange(
		params.HouseholdID,
		params.UserID,
		domain.SyncEntityAccount,
		a.ID,
		domain.SyncChangeUpsert,
		a.Version,
	)
	c := *a
	return &c, nil
}

func (s *Store) recomputeBalance(a *domain.Account) int64 {
	bal := a.OpeningBalance
	householdID, ok := s.householdOf(a.UserID)
	if !ok {
		return bal
	}
	for _, t := range s.transactions {
		if !s.sameHousehold(t.UserID, householdID) || t.Deleted() {
			continue
		}
		switch t.Type {
		case domain.TransactionTypeIncome:
			if t.AccountID != nil && *t.AccountID == a.ID {
				bal += t.Amount
			}
		case domain.TransactionTypeExpense:
			if t.AccountID != nil && *t.AccountID == a.ID {
				bal -= t.Amount
			}
		case domain.TransactionTypeTransfer:
			if t.FromAccountID != nil && *t.FromAccountID == a.ID {
				bal -= t.Amount
			}
			if t.ToAccountID != nil && *t.ToAccountID == a.ID {
				bal += t.Amount
			}
		case domain.TransactionTypeAdjustment:
			if t.AccountID != nil && *t.AccountID == a.ID {
				bal += t.Amount
			}
		}
	}
	return bal
}

func (s *Store) UpdateAccount(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateAccountParams,
) (*domain.Account, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[id]
	if !ok || !s.sameHousehold(a.UserID, householdID) || a.Deleted() {
		return nil, domain.ErrAccountNotFound
	}
	if a.Version != params.Version {
		return nil, domain.ErrAccountVersionConflict
	}
	if params.Name != nil {
		a.Name = *params.Name
	}
	a.UpdatedAt = time.Now().UTC()
	a.Version++
	a.Balance = s.recomputeBalance(a)
	s.appendChange(householdID, actorID, domain.SyncEntityAccount, a.ID, domain.SyncChangeUpsert, a.Version)
	c := *a
	return &c, nil
}

func (s *Store) DeleteAccount(_ context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[id]
	if !ok || !s.sameHousehold(a.UserID, householdID) {
		return domain.ErrAccountNotFound
	}
	for _, t := range s.transactions {
		if !s.sameHousehold(t.UserID, householdID) {
			continue
		}
		if (t.AccountID != nil && *t.AccountID == id) ||
			(t.FromAccountID != nil && *t.FromAccountID == id) ||
			(t.ToAccountID != nil && *t.ToAccountID == id) {
			return domain.ErrAccountHasTransactions
		}
	}
	for _, p := range s.plans {
		if s.sameHousehold(p.UserID, householdID) && p.AccountID == id && !p.Deleted() {
			return domain.ErrAccountHasPlannedPayments
		}
	}
	now := time.Now().UTC()
	a.DeletedAt = &now
	a.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityAccount, a.ID, domain.SyncChangeTombstone, a.Version)
	return nil
}

func (s *Store) GetAccount(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[id]
	if !ok || !s.sameHousehold(a.UserID, householdID) || a.Deleted() {
		return nil, domain.ErrAccountNotFound
	}
	a.Balance = s.recomputeBalance(a)
	c := *a
	return &c, nil
}

func (s *Store) GetAccounts(_ context.Context, scope domain.Scope) ([]domain.Account, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.Account
	for _, a := range s.accounts {
		if s.sameHousehold(a.UserID, householdID) && !a.Deleted() {
			a.Balance = s.recomputeBalance(a)
			out = append(out, *a)
		}
	}
	return out, nil
}

// --- CategoryRepository ---------------------------------------------------

func catUniqueKey(householdID uuid.UUID, name string) string {
	return householdID.String() + "|" + name
}

func (s *Store) CreateCategory(_ context.Context, params domain.CreateCategoryParams) (*domain.Category, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := params.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	if _, exists := s.categories[id]; exists {
		return nil, domain.ErrCategoryAlreadyExists
	}
	if _, exists := s.catUnique[catUniqueKey(params.HouseholdID, params.Name)]; exists {
		return nil, domain.ErrCategoryAlreadyExists
	}
	now := time.Now().UTC()
	c := &domain.Category{
		ID:        id,
		UserID:    params.UserID,
		Name:      params.Name,
		Type:      params.Type,
		Icon:      params.Icon,
		Color:     params.Color,
		CreatedAt: now,
		UpdatedAt: now,
		Version:   1,
	}
	s.categories[c.ID] = c
	s.catUnique[catUniqueKey(params.HouseholdID, c.Name)] = struct{}{}
	s.appendChange(
		params.HouseholdID,
		params.UserID,
		domain.SyncEntityCategory,
		c.ID,
		domain.SyncChangeUpsert,
		c.Version,
	)
	cc := *c
	return &cc, nil
}

func (s *Store) UpdateCategory(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateCategoryParams,
) (*domain.Category, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.categories[id]
	if !ok || !s.sameHousehold(c.UserID, householdID) || c.Deleted() {
		return nil, domain.ErrCategoryNotFound
	}
	if c.Version != params.Version {
		return nil, domain.ErrCategoryVersionConflict
	}
	if params.Name != nil {
		if _, exists := s.catUnique[catUniqueKey(householdID, *params.Name)]; exists && c.Name != *params.Name {
			return nil, domain.ErrCategoryAlreadyExists
		}
		delete(s.catUnique, catUniqueKey(householdID, c.Name))
		c.Name = *params.Name
		s.catUnique[catUniqueKey(householdID, c.Name)] = struct{}{}
	}
	if params.Type != nil {
		c.Type = *params.Type
	}
	if params.Icon != nil {
		c.Icon = *params.Icon
	}
	if params.Color != nil {
		c.Color = *params.Color
	}
	if params.Archive != nil {
		if *params.Archive {
			for _, p := range s.plans {
				if s.sameHousehold(p.UserID, householdID) && p.CategoryID == id && !p.Deleted() {
					return nil, domain.ErrCategoryHasPlannedPayments
				}
			}
			now := time.Now().UTC()
			c.ArchivedAt = &now
		} else {
			c.ArchivedAt = nil
		}
	}
	c.UpdatedAt = time.Now().UTC()
	c.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityCategory, c.ID, domain.SyncChangeUpsert, c.Version)
	cc := *c
	return &cc, nil
}

func (s *Store) DeleteCategory(_ context.Context, scope domain.Scope, id uuid.UUID, cascade bool) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.categories[id]
	if !ok || !s.sameHousehold(c.UserID, householdID) {
		return domain.ErrCategoryNotFound
	}
	if !cascade {
		for _, t := range s.transactions {
			if !s.sameHousehold(t.UserID, householdID) {
				continue
			}
			if t.CategoryID != nil && *t.CategoryID == id && !t.Deleted() {
				return domain.ErrCategoryHasTransactions
			}
		}
	}
	for _, p := range s.plans {
		if s.sameHousehold(p.UserID, householdID) && p.CategoryID == id && !p.Deleted() {
			return domain.ErrCategoryHasPlannedPayments
		}
	}
	delete(s.catUnique, catUniqueKey(householdID, c.Name))
	now := time.Now().UTC()
	c.DeletedAt = &now
	c.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityCategory, c.ID, domain.SyncChangeTombstone, c.Version)
	for _, t := range s.transactions {
		if t.CategoryID == nil || *t.CategoryID != id || t.Deleted() || !s.sameHousehold(t.UserID, householdID) {
			continue
		}
		t.DeletedAt = &now
		t.Version++
		s.appendChange(householdID, actorID, domain.SyncEntityTransaction, t.ID, domain.SyncChangeTombstone, t.Version)
	}
	return nil
}

func (s *Store) GetCategory(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.categories[id]
	if !ok || !s.sameHousehold(c.UserID, householdID) || c.Deleted() {
		return nil, domain.ErrCategoryNotFound
	}
	cc := *c
	return &cc, nil
}

func (s *Store) GetCategories(
	_ context.Context,
	scope domain.Scope,
	params domain.GetCategoriesParams,
) ([]domain.Category, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.Category
	for _, c := range s.categories {
		if !s.sameHousehold(c.UserID, householdID) || c.Deleted() {
			continue
		}
		if c.Archived() && !params.IncludeArchived {
			continue
		}
		if params.Type != nil && c.Type != *params.Type {
			continue
		}
		out = append(out, *c)
	}
	return out, nil
}

// --- TransactionRepository -----------------------------------------------

func (s *Store) CreateTransaction(
	_ context.Context,
	params domain.CreateTransactionParams,
) (*domain.Transaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := params.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	if _, exists := s.transactions[id]; exists {
		return nil, domain.ErrTransactionAlreadyExists
	}
	now := time.Now().UTC()
	t := &domain.Transaction{
		ID:            id,
		UserID:        params.UserID,
		Type:          params.Type,
		Amount:        params.Amount,
		Description:   params.Description,
		OccurredAt:    params.OccurredAt,
		CreatedAt:     now,
		UpdatedAt:     now,
		Version:       1,
		AccountID:     params.AccountID,
		CategoryID:    params.CategoryID,
		FromAccountID: params.FromAccountID,
		ToAccountID:   params.ToAccountID,
	}
	s.transactions[t.ID] = t
	s.appendChange(
		params.HouseholdID,
		params.UserID,
		domain.SyncEntityTransaction,
		t.ID,
		domain.SyncChangeUpsert,
		t.Version,
	)
	c := *t
	return &c, nil
}

func (s *Store) UpdateTransaction(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateTransactionParams,
) (*domain.Transaction, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.transactions[id]
	if !ok || !s.sameHousehold(t.UserID, householdID) || t.Deleted() {
		return nil, domain.ErrTransactionNotFound
	}
	if t.Version != params.Version {
		return nil, domain.ErrTransactionVersionConflict
	}
	if params.Amount != nil {
		t.Amount = *params.Amount
	}
	if params.Description != nil {
		t.Description = *params.Description
	}
	if params.OccurredAt != nil {
		t.OccurredAt = *params.OccurredAt
	}
	if params.AccountID != nil {
		t.AccountID = params.AccountID
	}
	if params.CategoryID != nil {
		t.CategoryID = params.CategoryID
	}
	if params.FromAccountID != nil {
		t.FromAccountID = params.FromAccountID
	}
	if params.ToAccountID != nil {
		t.ToAccountID = params.ToAccountID
	}
	t.Version++
	t.UpdatedAt = time.Now().UTC()
	s.appendChange(householdID, actorID, domain.SyncEntityTransaction, t.ID, domain.SyncChangeUpsert, t.Version)
	c := *t
	return &c, nil
}

func (s *Store) DeleteTransaction(_ context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.transactions[id]
	if !ok || !s.sameHousehold(t.UserID, householdID) {
		return domain.ErrTransactionNotFound
	}
	now := time.Now().UTC()
	t.DeletedAt = &now
	t.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityTransaction, t.ID, domain.SyncChangeTombstone, t.Version)
	return nil
}

func (s *Store) GetTransaction(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Transaction, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.transactions[id]
	if !ok || !s.sameHousehold(t.UserID, householdID) || t.Deleted() {
		return nil, domain.ErrTransactionNotFound
	}
	c := *t
	return &c, nil
}

func (s *Store) GetTransactions(
	_ context.Context,
	scope domain.Scope,
	params domain.GetTransactionsParams,
) ([]domain.Transaction, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.Transaction
	for _, t := range s.transactions {
		if s.sameHousehold(t.UserID, householdID) && !t.Deleted() && transactionMatchesFilters(*t, params) {
			out = append(out, *t)
		}
	}
	// ORDER BY occurred_at DESC, id DESC
	sort.Slice(out, func(i, j int) bool {
		if !out[i].OccurredAt.Equal(out[j].OccurredAt) {
			return out[i].OccurredAt.After(out[j].OccurredAt)
		}
		return uuidLess(out[j].ID, out[i].ID)
	})
	if params.Limit != nil && len(out) > *params.Limit {
		out = out[:*params.Limit]
	}
	return out, nil
}

// transactionMatchesFilters reports whether a single transaction satisfies all
// of the list filters (type, account, category, date range, keyset cursor).
func transactionMatchesFilters(t domain.Transaction, params domain.GetTransactionsParams) bool {
	if params.Type != nil && t.Type != *params.Type {
		return false
	}
	if params.AccountID != nil {
		match := (t.AccountID != nil && *t.AccountID == *params.AccountID) ||
			(t.FromAccountID != nil && *t.FromAccountID == *params.AccountID) ||
			(t.ToAccountID != nil && *t.ToAccountID == *params.AccountID)
		if !match {
			return false
		}
	}
	if params.CategoryID != nil && (t.CategoryID == nil || *t.CategoryID != *params.CategoryID) {
		return false
	}
	if params.FromDate != nil && t.OccurredAt.Before(*params.FromDate) {
		return false
	}
	if params.ToDate != nil && t.OccurredAt.After(*params.ToDate) {
		return false
	}
	if params.Cursor != nil {
		if t.OccurredAt.After(params.Cursor.OccurredAt) {
			return false
		}
		if t.OccurredAt.Equal(params.Cursor.OccurredAt) && !uuidLess(t.ID, params.Cursor.ID) {
			return false
		}
	}
	return true
}

func uuidLess(a, b uuid.UUID) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}

// --- DebtorRepository -----------------------------------------------------

func debtorUniqueKey(householdID uuid.UUID, name string) string {
	return householdID.String() + "|" + name
}

func (s *Store) CreateDebtor(_ context.Context, params domain.CreateDebtorParams) (*domain.Debtor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := params.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	if _, exists := s.debtors[id]; exists {
		return nil, domain.ErrDebtorAlreadyExists
	}
	if _, exists := s.debtorUnique[debtorUniqueKey(params.HouseholdID, params.Name)]; exists {
		return nil, domain.ErrDebtorAlreadyExists
	}
	now := time.Now().UTC()
	d := &domain.Debtor{
		ID: id, UserID: params.UserID, Name: params.Name, Note: params.Note,
		CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	s.debtors[d.ID] = d
	s.debtorUnique[debtorUniqueKey(params.HouseholdID, d.Name)] = struct{}{}
	s.appendChange(params.HouseholdID, params.UserID, domain.SyncEntityDebtor, d.ID, domain.SyncChangeUpsert, d.Version)
	c := *d
	return &c, nil
}

func (s *Store) UpdateDebtor(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateDebtorParams,
) (*domain.Debtor, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.debtors[id]
	if !ok || !s.sameHousehold(d.UserID, householdID) || d.Deleted() {
		return nil, domain.ErrDebtorNotFound
	}
	if d.Version != params.Version {
		return nil, domain.ErrDebtorVersionConflict
	}
	if params.Name != nil {
		if _, exists := s.debtorUnique[debtorUniqueKey(householdID, *params.Name)]; exists && d.Name != *params.Name {
			return nil, domain.ErrDebtorAlreadyExists
		}
		delete(s.debtorUnique, debtorUniqueKey(householdID, d.Name))
		d.Name = *params.Name
		s.debtorUnique[debtorUniqueKey(householdID, d.Name)] = struct{}{}
	}
	if params.Note != nil {
		d.Note = *params.Note
	}
	d.UpdatedAt = time.Now().UTC()
	d.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityDebtor, d.ID, domain.SyncChangeUpsert, d.Version)
	c := *d
	return &c, nil
}

func (s *Store) DeleteDebtor(_ context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.debtors[id]
	if !ok || !s.sameHousehold(d.UserID, householdID) {
		return domain.ErrDebtorNotFound
	}
	// In-use counts LIVE operations only: tombstoned ops never block.
	for _, o := range s.debtOps {
		if s.sameHousehold(o.UserID, householdID) && !o.Deleted() && o.DebtorID == id {
			return domain.ErrDebtorHasOperations
		}
	}
	delete(s.debtorUnique, debtorUniqueKey(householdID, d.Name))
	now := time.Now().UTC()
	d.DeletedAt = &now
	d.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityDebtor, d.ID, domain.SyncChangeTombstone, d.Version)
	return nil
}

func (s *Store) GetDebtor(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Debtor, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.debtors[id]
	if !ok || !s.sameHousehold(d.UserID, householdID) || d.Deleted() {
		return nil, domain.ErrDebtorNotFound
	}
	c := *d
	return &c, nil
}

func (s *Store) GetDebtors(_ context.Context, scope domain.Scope) ([]domain.Debtor, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.Debtor
	for _, d := range s.debtors {
		if s.sameHousehold(d.UserID, householdID) && !d.Deleted() {
			out = append(out, *d)
		}
	}
	return out, nil
}

// --- DebtOperationRepository ----------------------------------------------

func (s *Store) CreateDebtOperation(
	_ context.Context,
	params domain.CreateDebtOperationParams,
) (*domain.DebtOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := params.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	if _, exists := s.debtOps[id]; exists {
		return nil, domain.ErrDebtOperationAlreadyExists
	}
	now := time.Now().UTC()
	o := &domain.DebtOperation{
		ID: id, UserID: params.UserID, DebtorID: params.DebtorID,
		Direction: params.Direction, Kind: params.Kind, Amount: params.Amount,
		Note: params.Note, OccurredAt: params.OccurredAt,
		CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	s.debtOps[o.ID] = o
	s.appendChange(
		params.HouseholdID,
		params.UserID,
		domain.SyncEntityDebtOperation,
		o.ID,
		domain.SyncChangeUpsert,
		o.Version,
	)
	c := *o
	return &c, nil
}

func (s *Store) UpdateDebtOperation(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateDebtOperationParams,
) (*domain.DebtOperation, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.debtOps[id]
	if !ok || !s.sameHousehold(o.UserID, householdID) || o.Deleted() {
		return nil, domain.ErrDebtOperationNotFound
	}
	if o.Version != params.Version {
		return nil, domain.ErrDebtOperationVersionConflict
	}
	if params.Amount != nil {
		o.Amount = *params.Amount
	}
	if params.Note != nil {
		o.Note = *params.Note
	}
	if params.OccurredAt != nil {
		o.OccurredAt = *params.OccurredAt
	}
	o.UpdatedAt = time.Now().UTC()
	o.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityDebtOperation, o.ID, domain.SyncChangeUpsert, o.Version)
	c := *o
	return &c, nil
}

func (s *Store) DeleteDebtOperation(_ context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.debtOps[id]
	if !ok || !s.sameHousehold(o.UserID, householdID) {
		return domain.ErrDebtOperationNotFound
	}
	now := time.Now().UTC()
	o.DeletedAt = &now
	o.Version++
	s.appendChange(householdID, actorID, domain.SyncEntityDebtOperation, o.ID, domain.SyncChangeTombstone, o.Version)
	return nil
}

func (s *Store) GetDebtOperation(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.DebtOperation, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.debtOps[id]
	if !ok || !s.sameHousehold(o.UserID, householdID) || o.Deleted() {
		return nil, domain.ErrDebtOperationNotFound
	}
	c := *o
	return &c, nil
}

func (s *Store) GetDebtOperations( //nolint:dupl // per-entity list twins: identical filter/sort shape
	_ context.Context,
	scope domain.Scope,
	params domain.GetDebtOperationsParams,
) ([]domain.DebtOperation, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.DebtOperation
	for _, o := range s.debtOps {
		if !s.sameHousehold(o.UserID, householdID) || o.Deleted() {
			continue
		}
		if params.DebtorID != nil && o.DebtorID != *params.DebtorID {
			continue
		}
		out = append(out, *o)
	}
	// ORDER BY occurred_at DESC, id DESC
	sort.Slice(out, func(i, j int) bool {
		if !out[i].OccurredAt.Equal(out[j].OccurredAt) {
			return out[i].OccurredAt.After(out[j].OccurredAt)
		}
		return uuidLess(out[j].ID, out[i].ID)
	})
	return out, nil
}

// --- IdempotencyRepository ------------------------------------------------------

func idemKey(userID uuid.UUID, key string) string { return userID.String() + "|" + key }

func (s *Store) CreateIdempotencyKey(
	_ context.Context,
	params domain.CreateIdempotencyKeyParams,
) (*domain.IdempotencyKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := idemKey(params.UserID, params.IdempotencyKey)
	if _, exists := s.idemKeys[k]; exists {
		return nil, domain.ErrIdempotencyKeyInUse
	}
	now := time.Now().UTC()
	ik := &domain.IdempotencyKey{
		ID: uuid.New(), IdempotencyKey: params.IdempotencyKey, UserID: params.UserID,
		RequestHash: params.RequestHash, Status: "pending",
		CreatedAt: now, UpdatedAt: now, ExpiresAt: params.ExpiresAt,
	}
	s.idemKeys[k] = ik
	c := *ik
	return &c, nil
}

func (s *Store) UpdateIdempotencyKey(
	_ context.Context,
	userID, id uuid.UUID,
	params domain.UpdateIdempotencyKeyParams,
) (*domain.IdempotencyKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, ik := range s.idemKeys {
		if ik.ID == id && ik.UserID == userID {
			if params.Status != nil {
				ik.Status = *params.Status
			}
			if params.ResponseStatus != nil {
				ik.ResponseStatus = params.ResponseStatus
			}
			if params.ResponseHeaders != nil {
				ik.ResponseHeaders = params.ResponseHeaders
			}
			if params.ResponseBody != nil {
				ik.ResponseBody = params.ResponseBody
			}
			ik.UpdatedAt = time.Now().UTC()
			c := *ik
			_ = k
			return &c, nil
		}
	}
	return nil, domain.ErrIdempotencyKeyNotFound
}

func (s *Store) GetByUserAndKey(_ context.Context, userID uuid.UUID, key string) (*domain.IdempotencyKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ik, ok := s.idemKeys[idemKey(userID, key)]
	if !ok {
		return nil, domain.ErrIdempotencyKeyNotFound
	}
	c := *ik
	return &c, nil
}

func (s *Store) DeleteIdempotencyKey(_ context.Context, userID, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, ik := range s.idemKeys {
		if ik.ID == id && ik.UserID == userID {
			delete(s.idemKeys, k)
			return nil
		}
	}
	return nil
}

func (s *Store) DeleteExpiredIdempotencyKeys(_ context.Context) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	for k, ik := range s.idemKeys {
		if ik.ExpiresAt.Before(time.Now()) {
			delete(s.idemKeys, k)
			n++
		}
	}
	return n, nil
}

// --- EmailVerificationRepository -----------------------------------------

func (s *Store) CreateEmailVerificationCode(
	_ context.Context,
	userID uuid.UUID,
	code string,
	expiresAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.verifyCodes[userID] = &verifyCode{code: code, attempts: 0, expiresAt: expiresAt, createdAt: time.Now().UTC()}
	return nil
}

func (s *Store) VerifyEmailCode(_ context.Context, userID uuid.UUID, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	vc, ok := s.verifyCodes[userID]
	if !ok {
		return domain.ErrVerificationCodeNotFound
	}
	if vc.expiresAt.Before(time.Now()) {
		delete(s.verifyCodes, userID)
		return domain.ErrVerificationCodeExpired
	}
	if subtle.ConstantTimeCompare([]byte(vc.code), []byte(code)) == 1 {
		delete(s.verifyCodes, userID)
		if u, ok := s.users[userID]; ok {
			u.EmailVerified = true
		}
		return nil
	}
	vc.attempts++
	if vc.attempts >= domain.MaxVerificationAttempts {
		delete(s.verifyCodes, userID)
	}
	return domain.ErrInvalidVerificationCode
}

func (s *Store) LatestVerificationCodeAgeSeconds(_ context.Context, userID uuid.UUID) (int, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	vc, ok := s.verifyCodes[userID]
	if !ok {
		return 0, false, nil
	}
	return int(time.Since(vc.createdAt).Seconds()), true, nil
}

// --- PasswordResetRepository --------------------------------------------

func (s *Store) CreatePasswordResetToken(
	_ context.Context,
	userID uuid.UUID,
	tokenHash string,
	expiresAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resetTokens[tokenHash] = &resetToken{userID: userID, expiresAt: expiresAt, createdAt: time.Now().UTC()}
	return nil
}

func (s *Store) ResetPassword(_ context.Context, tokenHash, passwordHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rt, ok := s.resetTokens[tokenHash]
	if !ok || rt.expiresAt.Before(time.Now()) {
		return domain.ErrPasswordResetTokenNotFound
	}
	delete(s.resetTokens, tokenHash)
	if u, ok := s.users[rt.userID]; ok {
		u.PasswordHash = passwordHash
	}
	// revoke all sessions
	for id, sess := range s.sessions {
		if sess.UserID == rt.userID {
			delete(s.sessions, id)
		}
	}
	return nil
}

func (s *Store) LatestPasswordResetTokenAgeSeconds(_ context.Context, userID uuid.UUID) (int, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest time.Time
	found := false
	for _, rt := range s.resetTokens {
		if rt.userID == userID && (!found || rt.createdAt.After(latest)) {
			latest = rt.createdAt
			found = true
		}
	}
	if !found {
		return 0, false, nil
	}
	return int(time.Since(latest).Seconds()), true, nil
}

// silence unused import in some build configs.
var _ = pgx.ErrNoRows

// --- SyncRepository / SyncTx ----------------------------------------------

// appendChange records a change-log entry (seq is monotonic). Caller must
// hold s.mu.
func (s *Store) appendChange(
	householdID, actorID uuid.UUID,
	entity string, id uuid.UUID, action string, version int,
) {
	s.nextSeq++
	s.changeLog = append(s.changeLog, changeEntry{
		seq: s.nextSeq, householdID: householdID, userID: actorID,
		entity: entity, id: id, action: action, version: version,
	})
}

// fakeSyncTx implements repository.SyncTx over the in-memory store. Methods
// lock individually; there is no rollback on mid-batch errors (the Postgres
// batch transaction covers that; hermetic tests only exercise the rules).
type fakeSyncTx struct {
	store *Store
}

var _ repository.SyncTx = (*fakeSyncTx)(nil)

func (s *Store) WithinHouseholdTx(
	_ context.Context,
	_ domain.Scope,
	fn func(t repository.SyncTx) error,
) error {
	return fn(&fakeSyncTx{store: s})
}

func (s *Store) PullChanges(
	_ context.Context,
	scope domain.Scope,
	afterSeq int64,
	limit int,
) ([]domain.SyncChange, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.SyncChange
	for _, e := range s.changeLog {
		if e.householdID != householdID || e.seq <= afterSeq {
			continue
		}
		if len(out) == limit {
			break
		}
		change := domain.SyncChange{
			Seq: e.seq, UserID: e.userID, Entity: e.entity, ID: e.id, Action: e.action, Version: e.version,
		}
		if e.action == domain.SyncChangeUpsert {
			change.Data = s.currentState(householdID, e.entity, e.id)
		}
		out = append(out, change)
	}
	return out, nil
}

// currentState returns the record's full state for pull data (nil when the
// record no longer exists).
func (s *Store) currentState(householdID uuid.UUID, entity string, id uuid.UUID) any {
	switch entity {
	case domain.SyncEntityAccount:
		if a, ok := s.accounts[id]; ok && s.sameHousehold(a.UserID, householdID) {
			return a.FullState()
		}
	case domain.SyncEntityCategory:
		if c, ok := s.categories[id]; ok && s.sameHousehold(c.UserID, householdID) {
			return c.FullState()
		}
	case domain.SyncEntityTransaction:
		if t, ok := s.transactions[id]; ok && s.sameHousehold(t.UserID, householdID) {
			return t.FullState()
		}
	case domain.SyncEntityDebtor:
		if d, ok := s.debtors[id]; ok && s.sameHousehold(d.UserID, householdID) {
			return d.FullState()
		}
	case domain.SyncEntityDebtOperation:
		if o, ok := s.debtOps[id]; ok && s.sameHousehold(o.UserID, householdID) {
			return o.FullState()
		}
	case domain.SyncEntityPlannedPayment:
		if p, ok := s.plans[id]; ok && s.sameHousehold(p.UserID, householdID) {
			return p.FullState()
		}
	}
	return nil
}

// AdoptOrphanedID: the fake's records are keyed per household, so a base-0
// create with an id used in another household cannot collide here - always
// free to create. The cross-household semantics live in the Postgres layer
// (global PK) and are covered by its e2e tests.
func (t *fakeSyncTx) AdoptOrphanedID(
	_ context.Context,
	_ string,
	_ uuid.UUID,
	_ domain.Scope,
) (*domain.SyncServerState, error) {
	return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
}

func (t *fakeSyncTx) GetAppliedOperation(
	_ context.Context,
	scope domain.Scope, opID uuid.UUID,
) (*domain.AppliedOperation, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	if op, ok := t.store.appliedOps[idemOpKey(householdID, opID)]; ok {
		c := *op
		return &c, nil
	}
	return nil, nil //nolint:nilnil // (nil, nil) = never applied
}

func (t *fakeSyncTx) InsertAppliedOperation(_ context.Context, op domain.AppliedOperation) error {
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	c := op
	t.store.appliedOps[idemOpKey(op.HouseholdID, op.OpID)] = &c
	return nil
}

// idemOpKey mirrors the applied_operations PK (household_id, op_id).
func idemOpKey(householdID, opID uuid.UUID) string {
	return householdID.String() + "|" + opID.String()
}

func (t *fakeSyncTx) GetAccountAny(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	a, ok := t.store.accounts[id]
	if !ok || !t.store.sameHousehold(a.UserID, householdID) {
		return nil, nil //nolint:nilnil // (nil, nil) = never created
	}
	c := *a
	return &c, nil
}

func (t *fakeSyncTx) GetCategoryAny(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	c, ok := t.store.categories[id]
	if !ok || !t.store.sameHousehold(c.UserID, householdID) {
		return nil, nil //nolint:nilnil // (nil, nil) = never created
	}
	cc := *c
	return &cc, nil
}

func (t *fakeSyncTx) GetTransactionAny(
	_ context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Transaction, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	tx, ok := t.store.transactions[id]
	if !ok || !t.store.sameHousehold(tx.UserID, householdID) {
		return nil, nil //nolint:nilnil // (nil, nil) = never created
	}
	c := *tx
	return &c, nil
}

func (t *fakeSyncTx) GetDebtorAny(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Debtor, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	d, ok := t.store.debtors[id]
	if !ok || !t.store.sameHousehold(d.UserID, householdID) {
		return nil, nil //nolint:nilnil // (nil, nil) = never created
	}
	c := *d
	return &c, nil
}

func (t *fakeSyncTx) GetDebtOperationAny(
	_ context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.DebtOperation, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	o, ok := t.store.debtOps[id]
	if !ok || !t.store.sameHousehold(o.UserID, householdID) {
		return nil, nil //nolint:nilnil // (nil, nil) = never created
	}
	c := *o
	return &c, nil
}

func (t *fakeSyncTx) LiveAccountExists(_ context.Context, scope domain.Scope, id uuid.UUID) (bool, error) {
	a, _ := t.GetAccountAny(context.Background(), scope, id)
	return a != nil && !a.Deleted(), nil
}

func (t *fakeSyncTx) LiveCategory(_ context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error) {
	c, _ := t.GetCategoryAny(context.Background(), scope, id)
	if c == nil || c.Deleted() {
		return nil, domain.ErrCategoryNotFound
	}
	return c, nil
}

func (t *fakeSyncTx) CategoryNameTaken(
	_ context.Context,
	scope domain.Scope,
	name string,
	exceptID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, c := range t.store.categories {
		if t.store.sameHousehold(c.UserID, householdID) && !c.Deleted() && c.Name == name && c.ID != exceptID {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) HasLiveTransactionsForAccount(
	_ context.Context,
	scope domain.Scope, accountID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, tx := range t.store.transactions {
		if tx.Deleted() || !t.store.sameHousehold(tx.UserID, householdID) {
			continue
		}
		if (tx.AccountID != nil && *tx.AccountID == accountID) ||
			(tx.FromAccountID != nil && *tx.FromAccountID == accountID) ||
			(tx.ToAccountID != nil && *tx.ToAccountID == accountID) {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) HasLiveTransactionsForCategory(
	_ context.Context,
	scope domain.Scope, categoryID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, tx := range t.store.transactions {
		if !tx.Deleted() && t.store.sameHousehold(tx.UserID, householdID) &&
			tx.CategoryID != nil && *tx.CategoryID == categoryID {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) LiveDebtorExists(_ context.Context, scope domain.Scope, id uuid.UUID) (bool, error) {
	d, _ := t.GetDebtorAny(context.Background(), scope, id)
	return d != nil && !d.Deleted(), nil
}

func (t *fakeSyncTx) DebtorNameTaken(
	_ context.Context,
	scope domain.Scope,
	name string,
	exceptID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, d := range t.store.debtors {
		if t.store.sameHousehold(d.UserID, householdID) && !d.Deleted() && d.Name == name && d.ID != exceptID {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) HasLiveDebtOperationsForDebtor(
	_ context.Context,
	scope domain.Scope, debtorID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, o := range t.store.debtOps {
		if !o.Deleted() && t.store.sameHousehold(o.UserID, householdID) && o.DebtorID == debtorID {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) CreateAccount(_ context.Context, params domain.CreateAccountParams) (*domain.Account, error) {
	return t.store.CreateAccount(context.Background(), params)
}

func (t *fakeSyncTx) ReplaceAccount(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.AccountFullState,
) (*domain.Account, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	a, ok := t.store.accounts[id]
	if !ok || !t.store.sameHousehold(a.UserID, householdID) {
		return nil, domain.ErrAccountNotFound
	}
	if a.Deleted() {
		return nil, domain.ErrRecordDeleted
	}
	if a.Version != baseVersion {
		return nil, domain.ErrAccountVersionConflict
	}
	a.Name = st.Name
	a.Currency = st.Currency
	a.OpeningBalance = st.OpeningBalance
	a.UpdatedAt = time.Now().UTC()
	a.Version++
	a.Balance = t.store.recomputeBalance(a)
	t.store.appendChange(householdID, actorID, domain.SyncEntityAccount, a.ID, domain.SyncChangeUpsert, a.Version)
	c := *a
	return &c, nil
}

// tombstoneEntity is the fakes' shared tombstone protocol, mirroring the
// postgres tombstoneEntity core: locked map lookup with household scoping,
// idempotent re-delete (stored row back), version bump + change append.
// Wrappers supply the map access, the not-found sentinel, the sync entity
// const, and the transition apply (live-name unique-key release where the
// entity has one, plus the DeletedAt/Version stamp). PT is the row pointer
// type; the constraint needs its Deleted() for the idempotency check.
func tombstoneEntity[U any, PT interface {
	*U
	Deleted() bool
}](
	s *Store,
	scope domain.Scope,
	notFound error,
	entity string,
	locked func() (PT, bool),
	apply func(PT) (uuid.UUID, int),
) (PT, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()

	var zero PT
	row, ok := locked()
	if !ok {
		return zero, notFound
	}
	if !row.Deleted() {
		id, version := apply(row)
		s.appendChange(householdID, actorID, entity, id, domain.SyncChangeTombstone, version)
	}
	out := *row
	return PT(&out), nil
}

func (t *fakeSyncTx) TombstoneAccount(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Account, error) {
	return tombstoneEntity(t.store, scope,
		domain.ErrAccountNotFound, domain.SyncEntityAccount,
		func() (*domain.Account, bool) {
			a, ok := t.store.accounts[id]
			if !ok || !t.store.sameHousehold(a.UserID, scope.HouseholdID) {
				return nil, false
			}
			return a, true
		},
		func(a *domain.Account) (uuid.UUID, int) {
			now := time.Now().UTC()
			a.DeletedAt = &now
			a.Version++
			return a.ID, a.Version
		},
	)
}

func (t *fakeSyncTx) CreateCategory(_ context.Context, params domain.CreateCategoryParams) (*domain.Category, error) {
	return t.store.CreateCategory(context.Background(), params)
}

func (t *fakeSyncTx) ReplaceCategory(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.CategoryFullState,
) (*domain.Category, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	c, ok := t.store.categories[id]
	if !ok || !t.store.sameHousehold(c.UserID, householdID) {
		return nil, domain.ErrCategoryNotFound
	}
	if c.Deleted() {
		return nil, domain.ErrRecordDeleted
	}
	if c.Version != baseVersion {
		return nil, domain.ErrCategoryVersionConflict
	}
	delete(t.store.catUnique, catUniqueKey(householdID, c.Name))
	c.Name = st.Name
	c.Type = st.Type
	c.Icon = st.Icon
	c.Color = st.Color
	c.UpdatedAt = time.Now().UTC()
	c.Version++
	t.store.catUnique[catUniqueKey(householdID, c.Name)] = struct{}{}
	t.store.appendChange(householdID, actorID, domain.SyncEntityCategory, c.ID, domain.SyncChangeUpsert, c.Version)
	cc := *c
	return &cc, nil
}

func (t *fakeSyncTx) TombstoneCategory( //nolint:dupl // thin tombstoneEntity wrapper, names differ from debtor
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	return tombstoneEntity(t.store, scope,
		domain.ErrCategoryNotFound, domain.SyncEntityCategory,
		func() (*domain.Category, bool) {
			c, ok := t.store.categories[id]
			if !ok || !t.store.sameHousehold(c.UserID, scope.HouseholdID) {
				return nil, false
			}
			return c, true
		},
		func(c *domain.Category) (uuid.UUID, int) {
			delete(t.store.catUnique, catUniqueKey(scope.HouseholdID, c.Name))
			now := time.Now().UTC()
			c.DeletedAt = &now
			c.Version++
			return c.ID, c.Version
		},
	)
}

// CascadeTombstoneCategory mirrors the postgres cascade: the category
// tombstone plus one tombstone per live household transaction referencing
// it, each with its own change entry (the in-memory twin of the change_log
// appends on the batch transaction).
func (t *fakeSyncTx) CascadeTombstoneCategory(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	c, err := t.TombstoneCategory(context.Background(), scope, id)
	if err != nil {
		return nil, err
	}
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	now := time.Now().UTC()
	for _, tx := range t.store.transactions {
		if tx.CategoryID == nil || *tx.CategoryID != id || tx.Deleted() ||
			!t.store.sameHousehold(tx.UserID, householdID) {
			continue
		}
		tx.DeletedAt = &now
		tx.Version++
		t.store.appendChange(
			householdID,
			actorID,
			domain.SyncEntityTransaction,
			tx.ID,
			domain.SyncChangeTombstone,
			tx.Version,
		)
	}
	return c, nil
}

func (t *fakeSyncTx) CreateTransaction(
	_ context.Context,
	params domain.CreateTransactionParams,
) (*domain.Transaction, error) {
	return t.store.CreateTransaction(context.Background(), params)
}

func (t *fakeSyncTx) ReplaceTransaction(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.TransactionFullState,
) (*domain.Transaction, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	tx, ok := t.store.transactions[id]
	if !ok || !t.store.sameHousehold(tx.UserID, householdID) {
		return nil, domain.ErrTransactionNotFound
	}
	if tx.Deleted() {
		return nil, domain.ErrRecordDeleted
	}
	if tx.Version != baseVersion {
		return nil, domain.ErrTransactionVersionConflict
	}
	tx.Amount = st.Amount
	tx.Description = st.Description
	tx.OccurredAt = st.OccurredAt
	tx.AccountID = st.AccountID
	tx.CategoryID = st.CategoryID
	tx.FromAccountID = st.FromAccountID
	tx.ToAccountID = st.ToAccountID
	tx.Version++
	tx.UpdatedAt = time.Now().UTC()
	t.store.appendChange(householdID, actorID, domain.SyncEntityTransaction, tx.ID, domain.SyncChangeUpsert, tx.Version)
	c := *tx
	return &c, nil
}

func (t *fakeSyncTx) TombstoneTransaction(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Transaction, error) {
	return tombstoneEntity(t.store, scope,
		domain.ErrTransactionNotFound, domain.SyncEntityTransaction,
		func() (*domain.Transaction, bool) {
			tx, ok := t.store.transactions[id]
			if !ok || !t.store.sameHousehold(tx.UserID, scope.HouseholdID) {
				return nil, false
			}
			return tx, true
		},
		func(tx *domain.Transaction) (uuid.UUID, int) {
			now := time.Now().UTC()
			tx.DeletedAt = &now
			tx.Version++
			return tx.ID, tx.Version
		},
	)
}

func (t *fakeSyncTx) CreateDebtor(_ context.Context, params domain.CreateDebtorParams) (*domain.Debtor, error) {
	return t.store.CreateDebtor(context.Background(), params)
}

func (t *fakeSyncTx) ReplaceDebtor(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.DebtorFullState,
) (*domain.Debtor, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	d, ok := t.store.debtors[id]
	if !ok || !t.store.sameHousehold(d.UserID, householdID) {
		return nil, domain.ErrDebtorNotFound
	}
	if d.Deleted() {
		return nil, domain.ErrRecordDeleted
	}
	if d.Version != baseVersion {
		return nil, domain.ErrDebtorVersionConflict
	}
	delete(t.store.debtorUnique, debtorUniqueKey(householdID, d.Name))
	d.Name = st.Name
	d.Note = st.Note
	d.UpdatedAt = time.Now().UTC()
	d.Version++
	t.store.debtorUnique[debtorUniqueKey(householdID, d.Name)] = struct{}{}
	t.store.appendChange(householdID, actorID, domain.SyncEntityDebtor, d.ID, domain.SyncChangeUpsert, d.Version)
	c := *d
	return &c, nil
}

func (t *fakeSyncTx) TombstoneDebtor( //nolint:dupl // thin tombstoneEntity wrapper, names differ from category
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Debtor, error) {
	return tombstoneEntity(t.store, scope,
		domain.ErrDebtorNotFound, domain.SyncEntityDebtor,
		func() (*domain.Debtor, bool) {
			d, ok := t.store.debtors[id]
			if !ok || !t.store.sameHousehold(d.UserID, scope.HouseholdID) {
				return nil, false
			}
			return d, true
		},
		func(d *domain.Debtor) (uuid.UUID, int) {
			delete(t.store.debtorUnique, debtorUniqueKey(scope.HouseholdID, d.Name))
			now := time.Now().UTC()
			d.DeletedAt = &now
			d.Version++
			return d.ID, d.Version
		},
	)
}

func (t *fakeSyncTx) CreateDebtOperation(
	_ context.Context,
	params domain.CreateDebtOperationParams,
) (*domain.DebtOperation, error) {
	return t.store.CreateDebtOperation(context.Background(), params)
}

func (t *fakeSyncTx) ReplaceDebtOperation(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.DebtOperationFullState,
) (*domain.DebtOperation, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	o, ok := t.store.debtOps[id]
	if !ok || !t.store.sameHousehold(o.UserID, householdID) {
		return nil, domain.ErrDebtOperationNotFound
	}
	if o.Deleted() {
		return nil, domain.ErrRecordDeleted
	}
	if o.Version != baseVersion {
		return nil, domain.ErrDebtOperationVersionConflict
	}
	o.DebtorID = st.DebtorID
	o.Direction = st.Direction
	o.Kind = st.Kind
	o.Amount = st.Amount
	o.Note = st.Note
	o.OccurredAt = st.OccurredAt
	o.Version++
	o.UpdatedAt = time.Now().UTC()
	t.store.appendChange(householdID, actorID, domain.SyncEntityDebtOperation, o.ID, domain.SyncChangeUpsert, o.Version)
	c := *o
	return &c, nil
}

func (t *fakeSyncTx) TombstoneDebtOperation(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.DebtOperation, error) {
	return tombstoneEntity(t.store, scope,
		domain.ErrDebtOperationNotFound, domain.SyncEntityDebtOperation,
		func() (*domain.DebtOperation, bool) {
			o, ok := t.store.debtOps[id]
			if !ok || !t.store.sameHousehold(o.UserID, scope.HouseholdID) {
				return nil, false
			}
			return o, true
		},
		func(o *domain.DebtOperation) (uuid.UUID, int) {
			now := time.Now().UTC()
			o.DeletedAt = &now
			o.Version++
			return o.ID, o.Version
		},
	)
}
