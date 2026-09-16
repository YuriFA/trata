package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// debtOperationTx is the debt operation's slice of the batch tx (ADR-0003):
// the shared core, its own contract, and the live-debtor reference read the
// pre-validation needs (declared inline so the adapter sees exactly the read
// it uses, not the debtor contract's writes). The compile-time check pins
// the contract to the full repository.SyncTx the applier hands in.
type debtOperationTx interface {
	repository.SyncCore
	repository.DebtOperationSyncTx
	LiveDebtorExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
}

var _ debtOperationTx = repository.SyncTx(nil)

// debtOperationAdapter is the debt operation's half of the push engine: the
// amount/direction/kind shape rules and the live-debtor reference check as
// pre-validation, the debtor/direction/kind immutability guard, and no
// delete guard (debt operations tombstone unconditionally).
type debtOperationAdapter struct {
	syncAdapterDefaults[debtOperationTx, *domain.DebtOperation, domain.DebtOperationFullState]
}

func (debtOperationAdapter) entity() string { return domain.SyncEntityDebtOperation }
func (debtOperationAdapter) label() string {
	return catalogSyncEntityLabel(domain.SyncEntityDebtOperation)
}

func (debtOperationAdapter) decode(raw json.RawMessage) (domain.DebtOperationFullState, error) {
	var data domain.DebtOperationFullState
	err := decodeSyncData(raw, &data)
	return data, err
}

func (debtOperationAdapter) invalidDataMessage() string {
	return catalogSyncEntityInvalidDataMessage(domain.SyncEntityDebtOperation)
}

// preValidate checks the shape rules, then the debtor reference (the
// write rules, ADR-0005) against the LIVE debtors - a tombstoned debtor is
// "not found" - mapping the domain sentinel to the shared wire spec
// (domain.ErrorSpecFor), the same code + message the REST surface answers
// with.
func (debtOperationAdapter) preValidate(
	ctx context.Context,
	t debtOperationTx,
	scope domain.Scope,
	_ domain.SyncOperation,
	data domain.DebtOperationFullState,
) (string, string, error) {
	if data.Amount < 1 {
		return "VALIDATION_FAILED", "amount must be at least 1 minor unit", nil
	}
	if data.Direction != domain.DebtDirectionReceivable && data.Direction != domain.DebtDirectionPayable {
		return "VALIDATION_FAILED", "invalid debt direction", nil
	}
	if data.Kind != domain.DebtOperationKindDebt && data.Kind != domain.DebtOperationKindRepayment {
		return "VALIDATION_FAILED", "invalid debt operation kind", nil
	}
	err := ValidateDebtOperationWrite(ctx, syncDebtorRefReads{src: t}, scope, data.DebtorID)
	if err != nil {
		if spec, ok := domain.ErrorSpecFor(err); ok {
			return spec.Code, spec.Message, nil
		}
		return "", "", err
	}
	return "", "", nil
}

func (debtOperationAdapter) immutable(cur *domain.DebtOperation, data domain.DebtOperationFullState) (string, string) {
	if err := ValidateDebtOperationImmutable(cur, data); err != nil {
		if spec, ok := domain.ErrorSpecFor(err); ok {
			return spec.Code, spec.Message
		}
	}
	return "", ""
}

func (debtOperationAdapter) version(o *domain.DebtOperation) int   { return o.Version }
func (debtOperationAdapter) fullState(o *domain.DebtOperation) any { return o.FullState() }
func (debtOperationAdapter) isWriteRace(err error) bool {
	return errors.Is(err, domain.ErrDebtOperationVersionConflict) || errors.Is(err, domain.ErrRecordDeleted)
}

func (debtOperationAdapter) getAny(
	ctx context.Context, t debtOperationTx, scope domain.Scope, id uuid.UUID,
) (*domain.DebtOperation, bool, error) {
	o, err := t.GetDebtOperationAny(ctx, scope, id)
	if err != nil || o == nil {
		return nil, false, err
	}
	return o, true, nil
}

func (debtOperationAdapter) create(
	ctx context.Context, t debtOperationTx, scope domain.Scope, id uuid.UUID, data domain.DebtOperationFullState,
) (*domain.DebtOperation, error) {
	return t.CreateDebtOperation(ctx, domain.CreateDebtOperationParams{
		ID: id, HouseholdID: scope.HouseholdID, UserID: scope.ActorID,
		DebtorID: data.DebtorID, Direction: data.Direction, Kind: data.Kind,
		Amount: data.Amount, OccurredAt: data.OccurredAt,
	})
}

func (debtOperationAdapter) replace(
	ctx context.Context,
	t debtOperationTx,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	data domain.DebtOperationFullState,
) (*domain.DebtOperation, error) {
	return t.ReplaceDebtOperation(ctx, scope, id, baseVersion, data)
}

func (debtOperationAdapter) tombstone(
	ctx context.Context, t debtOperationTx, scope domain.Scope, id uuid.UUID,
) (*domain.DebtOperation, error) {
	return t.TombstoneDebtOperation(ctx, scope, id)
}
