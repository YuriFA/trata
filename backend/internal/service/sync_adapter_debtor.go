package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// debtorTx is the debtor push path's slice of the batch tx (ADR-0003): the
// shared core plus the debtor's own contract. The compile-time check pins
// the contract to the full repository.SyncTx the applier hands in.
type debtorTx interface {
	repository.SyncCore
	repository.DebtorSyncTx
}

var _ debtorTx = repository.SyncTx(nil)

// debtorAdapter is the debtor's half of the push engine: the live-name
// uniqueness pre-check, the in-use delete guard, and no immutable fields.
type debtorAdapter struct {
	syncAdapterDefaults[debtorTx, *domain.Debtor, domain.DebtorFullState]
}

func (debtorAdapter) entity() string { return domain.SyncEntityDebtor }
func (debtorAdapter) label() string  { return catalogSyncEntityLabel(domain.SyncEntityDebtor) }

func (debtorAdapter) decode(raw json.RawMessage) (domain.DebtorFullState, error) {
	var data domain.DebtorFullState
	err := decodeSyncData(raw, &data)
	return data, err
}

func (debtorAdapter) invalidDataMessage() string {
	return catalogSyncEntityInvalidDataMessage(domain.SyncEntityDebtor)
}

// preValidate is the live-name uniqueness check, pre-checked under the
// advisory lock so a violation surfaces as a per-item error, never an
// aborted batch.
func (debtorAdapter) preValidate(
	ctx context.Context,
	t debtorTx,
	scope domain.Scope,
	op domain.SyncOperation,
	data domain.DebtorFullState,
) (string, string, error) {
	nameTaken, err := t.DebtorNameTaken(ctx, scope, data.Name, op.ID)
	if err != nil {
		return "", "", err
	}
	if nameTaken {
		// The shared wire spec (domain.ErrorSpecFor) - the same wording the
		// REST surface answers with.
		spec, _ := domain.ErrorSpecFor(domain.ErrDebtorAlreadyExists)
		return spec.Code, spec.Message, nil
	}
	return "", "", nil
}

func (debtorAdapter) version(d *domain.Debtor) int   { return d.Version }
func (debtorAdapter) fullState(d *domain.Debtor) any { return d.FullState() }
func (debtorAdapter) isWriteRace(err error) bool {
	return errors.Is(err, domain.ErrDebtorVersionConflict) || errors.Is(err, domain.ErrRecordDeleted)
}

func (debtorAdapter) getAny(
	ctx context.Context, t debtorTx, scope domain.Scope, id uuid.UUID,
) (*domain.Debtor, bool, error) {
	d, err := t.GetDebtorAny(ctx, scope, id)
	if err != nil || d == nil {
		return nil, false, err
	}
	return d, true, nil
}

func (debtorAdapter) create(
	ctx context.Context, t debtorTx, scope domain.Scope, id uuid.UUID, data domain.DebtorFullState,
) (*domain.Debtor, error) {
	return t.CreateDebtor(ctx, domain.CreateDebtorParams{
		ID: id, HouseholdID: scope.HouseholdID, UserID: scope.ActorID, Name: data.Name, Note: data.Note,
	})
}

func (debtorAdapter) replace(
	ctx context.Context,
	t debtorTx,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	data domain.DebtorFullState,
) (*domain.Debtor, error) {
	return t.ReplaceDebtor(ctx, scope, id, baseVersion, data)
}

func (debtorAdapter) tombstone(
	ctx context.Context, t debtorTx, scope domain.Scope, id uuid.UUID,
) (*domain.Debtor, error) {
	return t.TombstoneDebtor(ctx, scope, id)
}

// inUse runs the debtor delete rule (ADR-0005) against the batch tx.
func (debtorAdapter) inUse(
	ctx context.Context, t debtorTx, scope domain.Scope, id uuid.UUID,
) error {
	return ValidateDebtorDelete(ctx, t, scope, id)
}
