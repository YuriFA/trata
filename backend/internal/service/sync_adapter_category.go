package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// categoryTx is the category push path's slice of the batch tx (ADR-0003):
// the shared core plus the category's own contract. The compile-time check
// pins the contract to the full repository.SyncTx the applier hands in.
type categoryTx interface {
	repository.SyncCore
	repository.CategorySyncTx
}

var _ categoryTx = repository.SyncTx(nil)

// categoryAdapter is the category's half of the push engine: the type shape
// rule and live-name uniqueness pre-check, and the in-use delete guard. No
// immutable fields.
type categoryAdapter struct {
	syncAdapterDefaults[categoryTx, *domain.Category, domain.CategoryFullState]
}

func (categoryAdapter) entity() string { return domain.SyncEntityCategory }
func (categoryAdapter) label() string  { return catalogSyncEntityLabel(domain.SyncEntityCategory) }

func (categoryAdapter) decode(raw json.RawMessage) (domain.CategoryFullState, error) {
	var data domain.CategoryFullState
	err := decodeSyncData(raw, &data)
	return data, err
}

func (categoryAdapter) invalidDataMessage() string {
	return catalogSyncEntityInvalidDataMessage(domain.SyncEntityCategory)
}

// preValidate checks the type shape, then the live-name uniqueness - the
// latter pre-checked under the advisory lock so a violation surfaces as a
// per-item error, never an aborted batch.
func (categoryAdapter) preValidate(
	ctx context.Context,
	t categoryTx,
	scope domain.Scope,
	op domain.SyncOperation,
	data domain.CategoryFullState,
) (string, string, error) {
	if data.Type != domain.TransactionTypeIncome && data.Type != domain.TransactionTypeExpense {
		return "VALIDATION_FAILED", "invalid category type", nil
	}
	nameTaken, err := t.CategoryNameTaken(ctx, scope, data.Name, op.ID)
	if err != nil {
		return "", "", err
	}
	if nameTaken {
		// The shared wire spec (domain.ErrorSpecFor) - the same wording the
		// REST surface answers with.
		spec, _ := domain.ErrorSpecFor(domain.ErrCategoryAlreadyExists)
		return spec.Code, spec.Message, nil
	}
	return "", "", nil
}

func (categoryAdapter) version(c *domain.Category) int   { return c.Version }
func (categoryAdapter) fullState(c *domain.Category) any { return c.FullState() }
func (categoryAdapter) isWriteRace(err error) bool {
	return errors.Is(err, domain.ErrCategoryVersionConflict) || errors.Is(err, domain.ErrRecordDeleted)
}

func (categoryAdapter) getAny(
	ctx context.Context, t categoryTx, scope domain.Scope, id uuid.UUID,
) (*domain.Category, bool, error) {
	c, err := t.GetCategoryAny(ctx, scope, id)
	if err != nil || c == nil {
		return nil, false, err
	}
	return c, true, nil
}

func (categoryAdapter) create(
	ctx context.Context, t categoryTx, scope domain.Scope, id uuid.UUID, data domain.CategoryFullState,
) (*domain.Category, error) {
	return t.CreateCategory(ctx, domain.CreateCategoryParams{
		ID: id, HouseholdID: scope.HouseholdID, UserID: scope.ActorID,
		Name: data.Name, Type: data.Type, Icon: data.Icon, Color: data.Color,
	})
}

func (categoryAdapter) replace(
	ctx context.Context,
	t categoryTx,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	data domain.CategoryFullState,
) (*domain.Category, error) {
	return t.ReplaceCategory(ctx, scope, id, baseVersion, data)
}

func (categoryAdapter) tombstone(
	ctx context.Context, t categoryTx, scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	return t.TombstoneCategory(ctx, scope, id)
}

// inUse reports the category's live dependants in the REST order (postgres
// DeleteCategory): live transactions first, then live planned payments - the
// message names the relation that fired.
// inUse runs the category delete rule (ADR-0005) against the batch tx.
func (categoryAdapter) inUse(
	ctx context.Context, t categoryTx, scope domain.Scope, id uuid.UUID,
) error {
	return ValidateCategoryDelete(ctx, t, scope, id)
}

// categoryDeleteData is the delete-op payload shape ("cascade": true).
type categoryDeleteData struct {
	Cascade bool `json:"cascade"`
}

// resolveDelete parses the delete payload: absent data is a plain guarded
// delete; {"cascade": true} cascades to the referencing transactions;
// anything else is a per-item validation error.
func (categoryAdapter) resolveDelete(op domain.SyncOperation) (bool, string, string) {
	if len(op.Data) == 0 || string(op.Data) == "null" {
		return false, "", ""
	}
	var data categoryDeleteData
	if err := decodeSyncData(op.Data, &data); err != nil {
		return false, "VALIDATION_FAILED", "invalid category delete data"
	}
	return data.Cascade, "", ""
}

// inUseUnderCascade runs the reduced rule (ADR-0005) for a cascaded
// delete: the referencing transactions are removed by the cascade itself,
// so only live planned payments still block.
func (categoryAdapter) inUseUnderCascade(
	ctx context.Context, t categoryTx, scope domain.Scope, id uuid.UUID,
) error {
	return ValidateCategoryDeleteUnderCascade(ctx, t, scope, id)
}

// cascadeTombstone tombstones the category and every referencing live
// transaction, each with its own change_log row, on the batch transaction.
func (categoryAdapter) cascadeTombstone(
	ctx context.Context, t categoryTx, scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	return t.CascadeTombstoneCategory(ctx, scope, id)
}
