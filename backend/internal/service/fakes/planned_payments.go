package fakes

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// --- PlannedPaymentRepository ------------------------------------------------

func (s *Store) CreatePlannedPayment(
	_ context.Context,
	params domain.CreatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := params.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	if _, exists := s.plans[id]; exists {
		return nil, domain.ErrPlannedPaymentAlreadyExists
	}
	now := time.Now().UTC()
	p := &domain.PlannedPayment{
		ID: id, UserID: params.UserID, Type: params.Type, Amount: params.Amount,
		Name: params.Name, AccountID: params.AccountID, CategoryID: params.CategoryID,
		NextDue: dayStart(params.NextDue), AnchorDate: dayStart(params.NextDue),
		Regularity: params.Regularity, ConfirmMode: params.ConfirmMode,
		Reminder: params.Reminder, Note: params.Note,
		CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	s.plans[p.ID] = p
	s.appendChange(
		params.HouseholdID,
		params.UserID,
		domain.SyncEntityPlannedPayment,
		p.ID,
		domain.SyncChangeUpsert,
		p.Version,
	)
	c := *p
	return &c, nil
}

func (s *Store) UpdatePlannedPayment(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.plans[id]
	if !ok || !s.sameHousehold(p.UserID, householdID) || p.Deleted() {
		return nil, domain.ErrPlannedPaymentNotFound
	}
	if p.Version != params.Version {
		return nil, domain.ErrPlannedPaymentVersionConflict
	}
	if params.Amount != nil {
		p.Amount = *params.Amount
	}
	if params.Name != nil {
		p.Name = *params.Name
	}
	if params.Note != nil {
		p.Note = *params.Note
	}
	if params.AccountID != nil {
		p.AccountID = *params.AccountID
	}
	if params.CategoryID != nil {
		p.CategoryID = *params.CategoryID
	}
	if params.NextDue != nil {
		p.NextDue = dayStart(*params.NextDue)
		p.AnchorDate = p.NextDue
	}
	if params.Regularity != nil {
		p.Regularity = *params.Regularity
	}
	if params.ConfirmMode != nil {
		p.ConfirmMode = *params.ConfirmMode
	}
	if params.Reminder != nil {
		p.Reminder = *params.Reminder
	}
	p.UpdatedAt = time.Now().UTC()
	p.Version++
	s.appendChange(
		householdID,
		actorID,
		domain.SyncEntityPlannedPayment,
		p.ID,
		domain.SyncChangeUpsert,
		p.Version,
	)
	c := *p
	return &c, nil
}

func (s *Store) DeletePlannedPayment(_ context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.plans[id]
	if !ok || !s.sameHousehold(p.UserID, householdID) {
		return domain.ErrPlannedPaymentNotFound
	}
	if !p.Deleted() {
		now := time.Now().UTC()
		p.DeletedAt = &now
		p.Version++
		s.appendChange(
			householdID,
			actorID,
			domain.SyncEntityPlannedPayment,
			p.ID,
			domain.SyncChangeTombstone,
			p.Version,
		)
	}
	return nil
}

func (s *Store) GetPlannedPayment(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.plans[id]
	if !ok || !s.sameHousehold(p.UserID, householdID) || p.Deleted() {
		return nil, domain.ErrPlannedPaymentNotFound
	}
	c := *p
	return &c, nil
}

func (s *Store) GetPlannedPayments( //nolint:dupl // per-entity list twins: identical filter/sort shape
	_ context.Context,
	scope domain.Scope,
	params domain.GetPlannedPaymentsParams,
) ([]domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.PlannedPayment
	for _, p := range s.plans {
		if !s.sameHousehold(p.UserID, householdID) || p.Deleted() {
			continue
		}
		if params.Type != nil && p.Type != *params.Type {
			continue
		}
		out = append(out, *p)
	}
	// ORDER BY next_due ASC, id ASC
	sort.Slice(out, func(i, j int) bool {
		if !out[i].NextDue.Equal(out[j].NextDue) {
			return out[i].NextDue.Before(out[j].NextDue)
		}
		return uuidLess(out[i].ID, out[j].ID)
	})
	return out, nil
}

func dayStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// --- fakeSyncTx ---------------------------------------------------------------

func (t *fakeSyncTx) GetPlannedPaymentAny(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	p, ok := t.store.plans[id]
	if !ok || !t.store.sameHousehold(p.UserID, householdID) {
		return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
	}
	c := *p
	return &c, nil
}

func (t *fakeSyncTx) HasLivePlannedPaymentsForAccount(
	_ context.Context,
	scope domain.Scope, accountID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, p := range t.store.plans {
		if t.store.sameHousehold(p.UserID, householdID) && p.AccountID == accountID && !p.Deleted() {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) HasLivePlannedPaymentsForCategory(
	_ context.Context,
	scope domain.Scope, categoryID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	for _, p := range t.store.plans {
		if t.store.sameHousehold(p.UserID, householdID) && p.CategoryID == categoryID && !p.Deleted() {
			return true, nil
		}
	}
	return false, nil
}

func (t *fakeSyncTx) DueAutoPlannedPayments(
	_ context.Context,
	scope domain.Scope,
	today time.Time,
) ([]domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	var out []domain.PlannedPayment
	cutoff := dayStart(today)
	for _, p := range t.store.plans {
		if t.store.sameHousehold(p.UserID, householdID) && !p.Deleted() &&
			p.ConfirmMode == domain.PlannedConfirmAuto &&
			!dayStart(p.NextDue).After(cutoff) {
			out = append(out, *p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].NextDue.Equal(out[j].NextDue) {
			return out[i].NextDue.Before(out[j].NextDue)
		}
		return uuidLess(out[i].ID, out[j].ID)
	})
	return out, nil
}

func (t *fakeSyncTx) CreatePlannedPayment(
	_ context.Context,
	params domain.CreatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	return t.store.CreatePlannedPayment(context.Background(), params)
}

func (t *fakeSyncTx) ReplacePlannedPayment(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.PlannedPaymentFullState,
) (*domain.PlannedPayment, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	p, ok := t.store.plans[id]
	if !ok || !t.store.sameHousehold(p.UserID, householdID) {
		return nil, domain.ErrPlannedPaymentNotFound
	}
	if p.Deleted() {
		return nil, domain.ErrRecordDeleted
	}
	if p.Version != baseVersion {
		return nil, domain.ErrPlannedPaymentVersionConflict
	}
	p.Type = st.Type
	p.Amount = st.Amount
	p.Name = st.Name
	p.AccountID = st.AccountID
	p.CategoryID = st.CategoryID
	p.NextDue = dayStart(st.NextDue.Time)
	p.AnchorDate = dayStart(st.AnchorDate.Time)
	p.Regularity = st.Regularity
	p.ConfirmMode = st.ConfirmMode
	p.Reminder = st.Reminder
	p.Note = st.Note
	p.Version++
	p.UpdatedAt = time.Now().UTC()
	t.store.appendChange(
		householdID,
		actorID,
		domain.SyncEntityPlannedPayment,
		p.ID,
		domain.SyncChangeUpsert,
		p.Version,
	)
	c := *p
	return &c, nil
}

func (t *fakeSyncTx) TombstonePlannedPayment(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, error) {
	return tombstoneEntity(t.store, scope,
		domain.ErrPlannedPaymentNotFound, domain.SyncEntityPlannedPayment,
		func() (*domain.PlannedPayment, bool) {
			p, ok := t.store.plans[id]
			if !ok || !t.store.sameHousehold(p.UserID, scope.HouseholdID) {
				return nil, false
			}
			return p, true
		},
		func(p *domain.PlannedPayment) (uuid.UUID, int) {
			now := time.Now().UTC()
			p.DeletedAt = &now
			p.Version++
			return p.ID, p.Version
		},
	)
}

func (t *fakeSyncTx) AdvancePlannedPayment(
	_ context.Context,
	scope domain.Scope, id uuid.UUID,
	nextDue time.Time,
) (*domain.PlannedPayment, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	t.store.mu.Lock()
	defer t.store.mu.Unlock()
	p, ok := t.store.plans[id]
	if !ok || !t.store.sameHousehold(p.UserID, householdID) || p.Deleted() {
		return nil, domain.ErrPlannedPaymentNotFound
	}
	p.NextDue = dayStart(nextDue)
	p.Version++
	p.UpdatedAt = time.Now().UTC()
	t.store.appendChange(
		householdID,
		actorID,
		domain.SyncEntityPlannedPayment,
		p.ID,
		domain.SyncChangeUpsert,
		p.Version,
	)
	c := *p
	return &c, nil
}

// HouseholdsWithDueAutoPlannedPayments lists households owning at least one due
// auto plan (the auto-confirm job's work list).
func (s *Store) HouseholdsWithDueAutoPlannedPayments(
	_ context.Context,
	today time.Time,
) ([]uuid.UUID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := make(map[uuid.UUID]struct{})
	var out []uuid.UUID
	cutoff := dayStart(today)
	for _, p := range s.plans {
		if p.Deleted() || p.ConfirmMode != domain.PlannedConfirmAuto || dayStart(p.NextDue).After(cutoff) {
			continue
		}
		householdID, ok := s.householdOf(p.UserID)
		if !ok {
			continue
		}
		if _, dup := seen[householdID]; !dup {
			seen[householdID] = struct{}{}
			out = append(out, householdID)
		}
	}
	return out, nil
}
