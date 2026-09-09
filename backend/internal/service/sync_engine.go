package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// The push-protocol engine (ADR-0003): ONE implementation of the per-entity
// push skeleton - decode -> staged validation -> base-0 create (incl.
// adopt-orphaned) vs strict-CAS update -> four-way conflict classification ->
// replace + race re-read -> per-item result shaping. Idempotent replay and
// applied-op recording live one level up in applySyncOperation. Outcomes
// (codes, ordering, conflict shapes) are identical to the per-entity twins it
// replaced, except the delete in-use guards: they also block on live planned
// payments now, matching the REST delete semantics (2026-09-01 fix).
//
// Each adapter rides the batch tx through its own narrow contract (T: the
// shared SyncCore plus the entity's repository contract and any cross-entity
// reference reads it needs), so the seam a new entity touches is named in its
// adapter file, not the whole SyncTx.

// syncRow is the stored-row shape every synced entity offers the engine: the
// tombstone flag. (The full-state projection returns a concrete type per
// entity, so it rides the adapter instead of this constraint.)
type syncRow interface {
	Deleted() bool
}

// syncAdapter supplies everything entity-specific the engine cannot know:
// the decode target, the staged validation hooks, the immutability guard,
// the persistence calls, and the write-race sentinels. T is the entity's
// slice of the batch tx (repository.SyncCore + its contracts), R the stored
// row (pointer type), S the decoded full-state type.
type syncAdapter[T repository.SyncCore, R syncRow, S any] interface {
	// entity labels change-log rows and drives the adopt-orphaned check.
	entity() string
	// label names the entity in per-item messages ("account", "debt operation").
	label() string

	decode(raw json.RawMessage) (S, error)
	invalidDataMessage() string

	// preValidate runs before the current-row read (shape rules, live-name
	// uniqueness pre-checks); "" = pass, err = batch error.
	preValidate(
		ctx context.Context,
		t T,
		scope domain.Scope,
		op domain.SyncOperation,
		data S,
	) (code, message string, err error)
	// postReadValidate runs after the current-row read, before the
	// create-vs-update split (transaction reference rules); "" = pass.
	postReadValidate(
		ctx context.Context,
		t T,
		scope domain.Scope,
		op domain.SyncOperation,
		data S,
	) (code, message string, err error)

	version(row R) int
	fullState(row R) any
	// getAny reads the row including tombstones; found = false means the id
	// was never created in this household.
	getAny(ctx context.Context, t T, scope domain.Scope, id uuid.UUID) (row R, found bool, err error)

	// immutable fires between the deleted-check and the version-check of the
	// update branch (an immutable-field violation outranks the version
	// conflict); "" = pass.
	immutable(cur R, data S) (code, message string)

	create(ctx context.Context, t T, scope domain.Scope, id uuid.UUID, data S) (R, error)
	// onCreateError turns a create failure into a per-item result when the
	// entity knows how (the account id-race safety net); handled = false
	// makes the engine propagate the error as a batch error.
	onCreateError(
		ctx context.Context,
		t T,
		scope domain.Scope,
		op domain.SyncOperation,
		err error,
	) (result domain.SyncPushResult, handled bool, ferr error)

	replace(
		ctx context.Context,
		t T,
		scope domain.Scope, id uuid.UUID,
		baseVersion int,
		data S,
	) (R, error)
	isWriteRace(err error) bool
	tombstone(ctx context.Context, t T, scope domain.Scope, id uuid.UUID) (R, error)
}

// syncInUseGuard is implemented by the entities whose delete is blocked by
// live dependants (account, category, debtor); the other synced entities
// tombstone unconditionally. inUse returns the domain sentinel of the
// relation that blocks the delete (nil = not blocked); the engine maps it
// to the shared wire spec (domain.ErrorSpecFor), so an entity with several
// dependants names the one that fired through its sentinel message.
type syncInUseGuard[T repository.SyncCore, R syncRow] interface {
	inUse(ctx context.Context, t T, scope domain.Scope, id uuid.UUID) error
}

// syncDeleteOptionsResolver is implemented by entities whose delete payload
// may carry delete options (category: {"cascade": true}). It runs after the
// existence/liveness checks; a non-empty code turns the item into a per-item
// error (malformed payload), otherwise cascade reports whether dependants
// are removed together with the record.
type syncDeleteOptionsResolver[T repository.SyncCore, R syncRow] interface {
	resolveDelete(op domain.SyncOperation) (cascade bool, code, message string)
}

// syncCascadeGuard pairs with a resolved cascade: the dependants the cascade
// itself removes no longer block the delete (the category cascade removes
// the referencing transactions), so only the remaining relations (live
// planned payments) are checked. Returns the blocking sentinel or nil.
type syncCascadeGuard[T repository.SyncCore, R syncRow] interface {
	inUseUnderCascade(ctx context.Context, t T, scope domain.Scope, id uuid.UUID) error
}

// syncCascadeTombstoner pairs with a resolved cascade: the tombstone write
// also removes the dependants (each with its own change_log row, on the same
// batch transaction).
type syncCascadeTombstoner[T repository.SyncCore, R syncRow] interface {
	cascadeTombstone(ctx context.Context, t T, scope domain.Scope, id uuid.UUID) (R, error)
}

// syncAdapterDefaults carries the no-op answers for the optional adapter
// hooks (validation stages, immutability, create-error recovery). Adapters
// embed it, instantiated with their tx, row, and full-state types, and
// override only what their entity actually has.
type syncAdapterDefaults[T repository.SyncCore, R syncRow, S any] struct{}

func (syncAdapterDefaults[T, R, S]) preValidate(
	context.Context, T, domain.Scope, domain.SyncOperation, S,
) (string, string, error) {
	return "", "", nil
}

func (syncAdapterDefaults[T, R, S]) postReadValidate(
	context.Context, T, domain.Scope, domain.SyncOperation, S,
) (string, string, error) {
	return "", "", nil
}

func (syncAdapterDefaults[T, R, S]) immutable(R, S) (string, string) {
	return "", ""
}

func (syncAdapterDefaults[T, R, S]) onCreateError(
	context.Context, T, domain.Scope, domain.SyncOperation, error,
) (domain.SyncPushResult, bool, error) {
	return domain.SyncPushResult{}, false, nil
}

// syncOpApplier applies one pushed operation for one entity; the registry
// built in NewSyncService maps entities to appliers.
type syncOpApplier func(ctx context.Context, t repository.SyncTx, scope domain.Scope, op domain.SyncOperation) (domain.SyncPushResult, error)

// applySyncOperationFor binds an adapter into the registry's applier shape,
// narrowing the batch tx to the adapter's own contract: the registry erases
// the entity's tx type, so the assertion restores it. It cannot fail for a
// declared contract - each adapter file's compile-time check pins its
// contract to the full repository.SyncTx the applier hands in.
func applySyncOperationFor[T repository.SyncCore, R syncRow, S any](ad syncAdapter[T, R, S]) syncOpApplier {
	return func(ctx context.Context, t repository.SyncTx, scope domain.Scope, op domain.SyncOperation) (domain.SyncPushResult, error) {
		// A violated contract is a programming error: fail loud - the
		// per-adapter compile-time checks prevent it.
		narrowed := t.(T) //nolint:errcheck // see above
		return applySyncEntity(ctx, narrowed, scope, op, ad)
	}
}

func applySyncEntity[T repository.SyncCore, R syncRow, S any](
	ctx context.Context,
	t T,
	scope domain.Scope,
	op domain.SyncOperation,
	ad syncAdapter[T, R, S],
) (domain.SyncPushResult, error) {
	if op.Action == domain.SyncActionDelete {
		return deleteSyncEntity(ctx, t, scope, op, ad)
	}
	if op.Action != domain.SyncActionUpsert {
		return errorResult(op.OpID, "VALIDATION_FAILED", "unknown action"), nil
	}

	data, err := ad.decode(op.Data)
	if err != nil {
		return errorResult( //nolint:nilerr // decode failure is a per-item error result, not a batch error
			op.OpID,
			"VALIDATION_FAILED",
			ad.invalidDataMessage(),
		), nil
	}
	if code, message, verr := ad.preValidate(ctx, t, scope, op, data); verr != nil {
		return domain.SyncPushResult{}, verr
	} else if code != "" {
		return errorResult(op.OpID, code, message), nil
	}

	current, found, err := ad.getAny(ctx, t, scope, op.ID)
	if err != nil {
		return domain.SyncPushResult{}, err
	}
	if code, message, verr := ad.postReadValidate(ctx, t, scope, op, data); verr != nil {
		return domain.SyncPushResult{}, verr
	} else if code != "" {
		return errorResult(op.OpID, code, message), nil
	}

	if op.BaseVersion == 0 {
		return createSyncEntity(ctx, t, scope, op, ad, data, current, found)
	}
	return updateSyncEntity(ctx, t, scope, op, ad, data, current, found)
}

// createSyncEntity is the base-0 branch: absent -> adopt-orphaned check ->
// create; exists -> already-exists conflict (a replay of the same opId was
// answered one level up, so this is a DIFFERENT operation claiming the id -
// never a silent overwrite).
func createSyncEntity[T repository.SyncCore, R syncRow, S any](
	ctx context.Context,
	t T,
	scope domain.Scope,
	op domain.SyncOperation,
	ad syncAdapter[T, R, S],
	data S, current R, found bool,
) (domain.SyncPushResult, error) {
	if found {
		return conflictResult(
			op.OpID, domain.SyncCodeAlreadyExists, ad.label()+" already exists",
			serverStateOf(ad.version(current), current.Deleted(), ad.fullState(current)),
		), nil
	}
	if res, err := adoptOrphanedOrConflict(ctx, t, ad.entity(), op, scope,
		ad.label()+" already exists in another household"); err != nil {
		return domain.SyncPushResult{}, err
	} else if res.Status != "" {
		return res, nil
	}
	created, err := ad.create(ctx, t, scope, op.ID, data)
	if err != nil {
		if res, handled, ferr := ad.onCreateError(ctx, t, scope, op, err); ferr != nil {
			return domain.SyncPushResult{}, ferr
		} else if handled {
			return res, nil
		}
		return domain.SyncPushResult{}, err
	}
	return appliedResult(op.OpID, ad.version(created)), nil
}

// updateSyncEntity is the update branch: strict CAS on the base version of a
// live record.
func updateSyncEntity[T repository.SyncCore, R syncRow, S any](
	ctx context.Context,
	t T,
	scope domain.Scope,
	op domain.SyncOperation,
	ad syncAdapter[T, R, S],
	data S, current R, found bool,
) (domain.SyncPushResult, error) {
	if !found {
		return conflictResult(
			op.OpID, domain.SyncCodeVersionConflict, ad.label()+" not found on server",
			serverStateOf(0, false, nil),
		), nil
	}
	if current.Deleted() {
		return conflictResult(
			op.OpID, domain.SyncCodeDeletedConflict, ad.label()+" was deleted on server",
			serverStateOf(ad.version(current), true, nil),
		), nil
	}
	if code, message := ad.immutable(current, data); code != "" {
		return errorResult(op.OpID, code, message), nil
	}
	if ad.version(current) != op.BaseVersion {
		return conflictResult(
			op.OpID, domain.SyncCodeVersionConflict, ad.label()+" version conflict",
			serverStateOf(ad.version(current), false, ad.fullState(current)),
		), nil
	}

	updated, err := ad.replace(ctx, t, scope, op.ID, op.BaseVersion, data)
	if ad.isWriteRace(err) {
		// Lost a race inside the batch (two ops touching the same record);
		// report the conflict, the client re-pushes on the new base.
		fresh, _, ferr := ad.getAny(ctx, t, scope, op.ID)
		if ferr != nil {
			return domain.SyncPushResult{}, ferr
		}
		return conflictResult(
			op.OpID, domain.SyncCodeVersionConflict, ad.label()+" version conflict",
			serverStateOf(ad.version(fresh), fresh.Deleted(), ad.fullState(fresh)),
		), nil
	}
	if err != nil {
		return domain.SyncPushResult{}, err
	}
	return appliedResult(op.OpID, ad.version(updated)), nil
}

// deleteSyncEntity implements the delete side: idempotent on tombstones and
// missing records, delete-wins over concurrent edits (the device that edited
// learns of the tombstone via pull and its conflict flow), in-use guard as a
// per-item error.
func deleteSyncEntity[T repository.SyncCore, R syncRow, S any](
	ctx context.Context,
	t T,
	scope domain.Scope,
	op domain.SyncOperation,
	ad syncAdapter[T, R, S],
) (domain.SyncPushResult, error) {
	current, found, err := ad.getAny(ctx, t, scope, op.ID)
	if err != nil {
		return domain.SyncPushResult{}, err
	}
	if !found {
		// The server never saw the record; nothing to delete (idempotent).
		return appliedResult(op.OpID, 0), nil
	}
	if current.Deleted() {
		return appliedResult(op.OpID, ad.version(current)), nil
	}
	cascade := false
	if rd, ok := any(ad).(syncDeleteOptionsResolver[T, R]); ok {
		var code, message string
		cascade, code, message = rd.resolveDelete(op)
		if code != "" {
			return errorResult(op.OpID, code, message), nil
		}
	}
	if guardErr := inUseBlocked(ctx, ad, t, scope, op.ID, cascade); guardErr != nil {
		if spec, ok := domain.ErrorSpecFor(guardErr); ok {
			return errorResult(op.OpID, spec.Code, spec.Message), nil
		}
		return domain.SyncPushResult{}, guardErr
	}
	var deleted R
	if cascade {
		if ct, ok := any(ad).(syncCascadeTombstoner[T, R]); ok {
			deleted, err = ct.cascadeTombstone(ctx, t, scope, op.ID)
		} else {
			return domain.SyncPushResult{}, fmt.Errorf(
				"cascade delete resolved for entity without cascade support: %s",
				op.Entity,
			)
		}
	} else {
		deleted, err = ad.tombstone(ctx, t, scope, op.ID)
	}
	if err != nil {
		return domain.SyncPushResult{}, err
	}
	return appliedResult(op.OpID, ad.version(deleted)), nil
}

// inUseBlocked runs the delete in-use guard: the blocking sentinel when a
// relation blocks (its ErrorSpec carries the per-item code + message), an
// infrastructure error otherwise, nil when nothing blocks. Under a resolved
// cascade the reduced guard (syncCascadeGuard) replaces the full one when
// implemented.
func inUseBlocked[T repository.SyncCore, R syncRow, S any](
	ctx context.Context,
	ad syncAdapter[T, R, S],
	t T,
	scope domain.Scope, id uuid.UUID,
	cascade bool,
) error {
	guard, ok := any(ad).(syncInUseGuard[T, R])
	if !ok {
		return nil
	}
	if cascade {
		if cg, ok := any(ad).(syncCascadeGuard[T, R]); ok {
			return cg.inUseUnderCascade(ctx, t, scope, id)
		}
	}
	return guard.inUse(ctx, t, scope, id)
}
