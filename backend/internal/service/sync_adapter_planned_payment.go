package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// plannedPaymentTx is the planned payment's slice of the batch tx
// (ADR-0003): the shared core, its own contract, and the live account/
// category reference reads the pre-validation needs (declared inline so the
// adapter sees exactly the reads it uses, not those contracts' writes). The
// compile-time check pins the contract to the full repository.SyncTx the
// applier hands in.
type plannedPaymentTx interface {
	repository.SyncCore
	repository.PlannedPaymentSyncTx
	LiveAccountExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	LiveCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
}

var _ plannedPaymentTx = repository.SyncTx(nil)

// plannedPaymentAdapter is the planned payment's half of the push engine:
// the shape rules and account/category reference checks as pre-validation,
// the plan-type immutability guard, and no delete guard (plans tombstone
// unconditionally; advancement is the auto-confirm job's, not push's).
type plannedPaymentAdapter struct {
	syncAdapterDefaults[plannedPaymentTx, *domain.PlannedPayment, domain.PlannedPaymentFullState]
}

func (plannedPaymentAdapter) entity() string { return domain.SyncEntityPlannedPayment }
func (plannedPaymentAdapter) label() string {
	return catalogSyncEntityLabel(domain.SyncEntityPlannedPayment)
}

func (plannedPaymentAdapter) decode(raw json.RawMessage) (domain.PlannedPaymentFullState, error) {
	var data domain.PlannedPaymentFullState
	err := decodeSyncData(raw, &data)
	return data, err
}

func (plannedPaymentAdapter) invalidDataMessage() string {
	return catalogSyncEntityInvalidDataMessage(domain.SyncEntityPlannedPayment)
}

// preValidate checks the shape rules (the per-item guard the REST surface
// gets from the OpenAPI request validator), then the write rules (ADR-0005)
// on the LIVE references, mapping the domain sentinel to the shared wire
// spec (domain.ErrorSpecFor) - the same code + message the REST surface
// answers with.
func (plannedPaymentAdapter) preValidate(
	ctx context.Context,
	t plannedPaymentTx,
	scope domain.Scope,
	_ domain.SyncOperation,
	data domain.PlannedPaymentFullState,
) (string, string, error) {
	if code := validatePlannedPaymentSyncData(&data); code != "" {
		return code, (plannedPaymentAdapter{}).invalidDataMessage(), nil
	}
	err := ValidatePlannedPaymentWrite(
		ctx, syncRefReads{src: t}, scope, data.AccountID, data.CategoryID, data.Type,
	)
	if err != nil {
		if spec, ok := domain.ErrorSpecFor(err); ok {
			return spec.Code, spec.Message, nil
		}
		return "", "", err
	}
	return "", "", nil
}

func (plannedPaymentAdapter) immutable(
	cur *domain.PlannedPayment,
	data domain.PlannedPaymentFullState,
) (string, string) {
	if err := ValidatePlannedPaymentTypeImmutable(cur.Type, data.Type); err != nil {
		if spec, ok := domain.ErrorSpecFor(err); ok {
			return spec.Code, spec.Message
		}
	}
	return "", ""
}

func (plannedPaymentAdapter) version(p *domain.PlannedPayment) int   { return p.Version }
func (plannedPaymentAdapter) fullState(p *domain.PlannedPayment) any { return p.FullState() }
func (plannedPaymentAdapter) isWriteRace(err error) bool {
	return errors.Is(err, domain.ErrPlannedPaymentVersionConflict) || errors.Is(err, domain.ErrRecordDeleted)
}

func (plannedPaymentAdapter) getAny(
	ctx context.Context, t plannedPaymentTx, scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, bool, error) {
	p, err := t.GetPlannedPaymentAny(ctx, scope, id)
	if err != nil || p == nil {
		return nil, false, err
	}
	return p, true, nil
}

func (plannedPaymentAdapter) create(
	ctx context.Context, t plannedPaymentTx, scope domain.Scope, id uuid.UUID, data domain.PlannedPaymentFullState,
) (*domain.PlannedPayment, error) {
	return t.CreatePlannedPayment(ctx, domain.CreatePlannedPaymentParams{
		ID: id, HouseholdID: scope.HouseholdID, UserID: scope.ActorID,
		Type: data.Type, Amount: data.Amount, Name: data.Name,
		AccountID: data.AccountID, CategoryID: data.CategoryID,
		NextDue: data.NextDue.Time, Regularity: data.Regularity,
		ConfirmMode: data.ConfirmMode, Reminder: data.Reminder, Note: data.Note,
	})
}

func (plannedPaymentAdapter) replace(
	ctx context.Context,
	t plannedPaymentTx,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	data domain.PlannedPaymentFullState,
) (*domain.PlannedPayment, error) {
	return t.ReplacePlannedPayment(ctx, scope, id, baseVersion, data)
}

func (plannedPaymentAdapter) tombstone(
	ctx context.Context, t plannedPaymentTx, scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, error) {
	return t.TombstonePlannedPayment(ctx, scope, id)
}

// validatePlannedPaymentSyncData checks the shape a plan upsert must satisfy
// regardless of the transport (the REST surface gets this from the OpenAPI
// request validator), returning the machine code of the violation ("" =
// valid).
func validatePlannedPaymentSyncData(data *domain.PlannedPaymentFullState) string {
	if data.Amount < 1 {
		return "VALIDATION_FAILED"
	}
	if data.Type != domain.TransactionTypeIncome && data.Type != domain.TransactionTypeExpense {
		return "VALIDATION_FAILED"
	}
	switch data.Regularity {
	case domain.PlannedRegularityDaily, domain.PlannedRegularityWeekly,
		domain.PlannedRegularityMonthly, domain.PlannedRegularityYearly:
	default:
		return "VALIDATION_FAILED"
	}
	if data.ConfirmMode != domain.PlannedConfirmManual && data.ConfirmMode != domain.PlannedConfirmAuto {
		return "VALIDATION_FAILED"
	}
	switch data.Reminder {
	case domain.PlannedReminderOff, domain.PlannedReminderDayBefore, domain.PlannedReminderOnDay:
	default:
		return "VALIDATION_FAILED"
	}
	if data.NextDue.IsZero() || data.AnchorDate.IsZero() {
		return "VALIDATION_FAILED"
	}
	return ""
}
