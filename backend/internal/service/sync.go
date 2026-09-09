package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

const (
	defaultSyncPullLimit = 100
	maxSyncPullLimit     = 500
)

// SyncService owns the sync protocol rules: per-item push semantics
// (idempotent replay by opId, CAS updates, delete-wins deletes, per-item
// business-rule errors) and the cursor pull. The whole push batch commits
// atomically via repository.SyncRepository.WithinHouseholdTx; householdID is
// the scoping key and userID the authorship stamp of the pushing member.
// Push dispatch goes through the per-entity applier registry: every synced
// entity rides the push engine through its adapter (ADR-0003).
type SyncService struct {
	sync     repository.SyncRepository
	appliers map[string]syncOpApplier
}

func NewSyncService(sync repository.SyncRepository) *SyncService {
	return &SyncService{
		sync: sync,
		appliers: map[string]syncOpApplier{
			domain.SyncEntityAccount:        applySyncOperationFor(accountAdapter{}),
			domain.SyncEntityCategory:       applySyncOperationFor(categoryAdapter{}),
			domain.SyncEntityDebtOperation:  applySyncOperationFor(debtOperationAdapter{}),
			domain.SyncEntityTransaction:    applySyncOperationFor(transactionAdapter{}),
			domain.SyncEntityPlannedPayment: applySyncOperationFor(plannedPaymentAdapter{}),
			domain.SyncEntityDebtor:         applySyncOperationFor(debtorAdapter{}),
		},
	}
}

// Push applies a batch of client operations. Every item yields its own
// result; an unexpected error aborts the whole batch (the client retries the
// batch - confirmed opIds replay their stored results, so nothing duplicates).
func (s *SyncService) Push(
	ctx context.Context,
	scope domain.Scope,
	ops []domain.SyncOperation,
) ([]domain.SyncPushResult, error) {
	const op = "service.sync.Push"

	results := make([]domain.SyncPushResult, 0, len(ops))
	err := s.sync.WithinHouseholdTx(ctx, scope, func(t repository.SyncTx) error {
		for _, operation := range ops {
			result, err := applySyncOperation(ctx, t, scope, operation, s.appliers)
			if err != nil {
				return err
			}
			results = append(results, result)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return results, nil
}

// SyncPullPage is one pull page: changes in seq order plus the next cursor
// (nil when the client is caught up).
type SyncPullPage struct {
	Changes    []domain.SyncChange
	NextCursor *int64
}

// Pull returns the change-log page after afterSeq. A full page yields a
// nextCursor; the following pull then reports caught-up (nil cursor).
func (s *SyncService) Pull(
	ctx context.Context,
	scope domain.Scope,
	afterSeq int64,
	limit *int,
) (*SyncPullPage, error) {
	const op = "service.sync.Pull"

	pageSize := defaultSyncPullLimit
	if limit != nil && *limit > 0 {
		pageSize = min(*limit, maxSyncPullLimit)
	}

	changes, err := s.sync.PullChanges(ctx, scope, afterSeq, pageSize)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	page := &SyncPullPage{Changes: changes}
	if len(changes) == pageSize {
		next := changes[len(changes)-1].Seq
		page.NextCursor = &next
	}
	return page, nil
}

// applySyncOperation processes ONE operation and returns its per-item result.
// Domain-rule violations become `error` results (the batch keeps going);
// unexpected infrastructure errors abort the batch via the returned error.
func applySyncOperation(
	ctx context.Context,
	t repository.SyncTx,
	scope domain.Scope,
	op domain.SyncOperation,
	appliers map[string]syncOpApplier,
) (domain.SyncPushResult, error) {
	// Persistent idempotency: an already-applied opId replays its stored
	// result without side effects (retry after a lost response, duplicate
	// delivery across batches), scoped to this household's applied operations.
	if previous, err := t.GetAppliedOperation(ctx, scope, op.OpID); err != nil {
		return domain.SyncPushResult{}, err
	} else if previous != nil {
		return previous.Result, nil
	}

	applier, known := appliers[op.Entity]
	if !known {
		return domain.SyncPushResult{
			OpID: op.OpID, Status: domain.SyncStatusError,
			Code: "VALIDATION_FAILED", Message: "unknown entity",
		}, nil
	}
	result, err := applier(ctx, t, scope, op)
	if err != nil {
		return domain.SyncPushResult{}, err
	}

	// Only APPLIED operations are durably recorded: a recorded opId always
	// corresponds to an applied change (conflicts/errors are re-evaluated on
	// redelivery).
	if result.Status == domain.SyncStatusApplied {
		if err := t.InsertAppliedOperation(ctx, domain.AppliedOperation{
			OpID:        op.OpID,
			HouseholdID: scope.HouseholdID,
			UserID:      scope.ActorID,
			Entity:      op.Entity,
			EntityID:    op.ID,
			Result:      result,
		}); err != nil {
			return domain.SyncPushResult{}, err
		}
	}
	return result, nil
}

// adoptOrphanedOrConflict runs the create-time cross-household id check
// (household-join union semantics): a base-0 create whose id lives in
// another household may only proceed when that household is orphaned (the
// adopt frees the id); a live household's record yields an already-exists
// conflict result. The zero result means "free to create".
func adoptOrphanedOrConflict(
	ctx context.Context,
	t repository.SyncCore,
	entity string,
	op domain.SyncOperation,
	scope domain.Scope,
	message string,
) (domain.SyncPushResult, error) {
	blocked, err := t.AdoptOrphanedID(ctx, entity, op.ID, scope)
	if err != nil {
		return domain.SyncPushResult{}, err
	}
	if blocked != nil {
		return conflictResult(op.OpID, domain.SyncCodeAlreadyExists, message, blocked), nil
	}
	return domain.SyncPushResult{}, nil
}

func appliedResult(opID uuid.UUID, version int) domain.SyncPushResult {
	return domain.SyncPushResult{OpID: opID, Status: domain.SyncStatusApplied, Version: version}
}

func conflictResult(opID uuid.UUID, code, message string, server *domain.SyncServerState) domain.SyncPushResult {
	return domain.SyncPushResult{
		OpID: opID, Status: domain.SyncStatusConflict, Code: code, Message: message, ServerState: server,
	}
}

func errorResult(opID uuid.UUID, code, message string) domain.SyncPushResult {
	return domain.SyncPushResult{OpID: opID, Status: domain.SyncStatusError, Code: code, Message: message}
}

// serverStateOf builds the serverState payload for conflict results. Data is
// the full record state in wire format (nil for tombstones).
func serverStateOf(version int, deleted bool, data any) *domain.SyncServerState {
	state := &domain.SyncServerState{Version: version, Deleted: deleted}
	if !deleted && data != nil {
		if raw, err := json.Marshal(data); err == nil {
			state.Data = raw
		}
	}
	return state
}
func decodeSyncData(raw json.RawMessage, target any) error {
	if len(raw) == 0 {
		return errors.New("missing data")
	}
	return json.Unmarshal(raw, target)
}
