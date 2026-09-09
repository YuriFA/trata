package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// Every mutation runs inside withinLockedTx (entity write + change_log append
// in one committed transaction). Deletes are tombstones guarded by the in-use
// check; the live-name uniqueness is enforced by the per-household partial
// unique index. householdID scopes every query; actorID is the acting member
// whose id lands on the change_log row as authorship.

func (r *Repository) CreateCategory(ctx context.Context, params domain.CreateCategoryParams) (*domain.Category, error) {
	const op = "repository.postgres.CreateCategory"

	id := newEntityID(params.ID)
	var row db.CreateCategoryRow
	err := r.withinLockedTx(ctx, params.HouseholdID, func(q *db.Queries) error {
		var err error
		row, err = q.CreateCategory(ctx, db.CreateCategoryParams{
			ID:          id,
			HouseholdID: params.HouseholdID,
			UserID:      params.UserID,
			Name:        params.Name,
			Type:        string(params.Type),
			Icon:        params.Icon,
			Color:       params.Color,
			ArchivedAt:  params.ArchivedAt,
		})
		if err != nil {
			if pgUniqueViolation(err) {
				// Either the live-name partial index or the PK (client id
				// duplicate); both are the same already-exists error.
				return domain.ErrCategoryAlreadyExists
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			params.HouseholdID,
			params.UserID,
			row.ID,
			domain.SyncEntityCategory,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return categoryFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Type,
		row.Icon,
		row.Color,
		row.ArchivedAt,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) UpdateCategory(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateCategoryParams,
) (*domain.Category, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.UpdateCategory"

	var typ *string
	if params.Type != nil {
		s := string(*params.Type)
		typ = &s
	}

	// Tri-state archive sentinel for the UPDATE: keep / archive / clear.
	archivedAction := "keep"
	if params.Archive != nil {
		if *params.Archive {
			archivedAction = "archive"
		} else {
			archivedAction = "clear"
		}
	}

	var row db.UpdateCategoryRow
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		// Archiving is blocked while a live planned payment references the
		// category (the same guard shape as the delete path).
		if archivedAction == "archive" {
			inUse, err := q.HasLivePlannedPaymentsForCategory(ctx, db.HasLivePlannedPaymentsForCategoryParams{
				HouseholdID: householdID,
				CategoryID:  id,
			})
			if err != nil {
				return err
			}
			if inUse {
				return domain.ErrCategoryHasPlannedPayments
			}
		}
		var err error
		row, err = q.UpdateCategory(ctx, db.UpdateCategoryParams{
			ID:             id,
			HouseholdID:    householdID,
			Name:           params.Name,
			Type:           typ,
			Icon:           params.Icon,
			Color:          params.Color,
			ArchivedAction: archivedAction,
			Version:        int32(params.Version), //nolint:gosec // optimistic version is a small positive int
		})
		if err != nil {
			if pgUniqueViolation(err) {
				return domain.ErrCategoryAlreadyExists
			}
			if errNoRows(err) {
				return classifyCategoryWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			row.ID,
			domain.SyncEntityCategory,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return categoryFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Type,
		row.Icon,
		row.Color,
		row.ArchivedAt,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) DeleteCategory(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	cascade bool,
) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeleteCategory"

	// Same rule as service.ValidateCategoryDelete (ADR-0005), enforced here
	// inside the locked transaction for REST atomicity.

	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		if !cascade {
			inUse, err := q.HasLiveTransactionsForCategory(ctx, db.HasLiveTransactionsForCategoryParams{
				HouseholdID: householdID,
				CategoryID:  &id,
			})
			if err != nil {
				return err
			}
			if inUse {
				return domain.ErrCategoryHasTransactions
			}
		}
		// Live planned payments block the delete in both modes: a cascade
		// removes transactions, never future obligations.
		plansInUse, err := q.HasLivePlannedPaymentsForCategory(ctx, db.HasLivePlannedPaymentsForCategoryParams{
			HouseholdID: householdID,
			CategoryID:  id,
		})
		if err != nil {
			return err
		}
		if plansInUse {
			return domain.ErrCategoryHasPlannedPayments
		}
		version, err := q.SoftDeleteCategory(ctx, db.SoftDeleteCategoryParams{ID: id, HouseholdID: householdID})
		if err != nil {
			if errNoRows(err) {
				return classifyCategoryWrite(ctx, q, householdID, id)
			}
			return err
		}
		if err := appendChangeLog(
			ctx, q, householdID, actorID, id, domain.SyncEntityCategory, domain.SyncChangeTombstone, int(version),
		); err != nil {
			return err
		}
		if !cascade {
			return nil
		}
		// Cascade: tombstone every live referencing transaction with its own
		// change_log row (one committed transaction - invariant #17).
		rows, err := q.SoftDeleteTransactionsForCategory(ctx, db.SoftDeleteTransactionsForCategoryParams{
			HouseholdID: householdID,
			CategoryID:  &id,
		})
		if err != nil {
			return err
		}
		for _, tx := range rows {
			if err := appendChangeLog(
				ctx,
				q,
				householdID,
				actorID,
				tx.ID,
				domain.SyncEntityTransaction,
				domain.SyncChangeTombstone,
				int(tx.Version),
			); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// classifyCategoryWrite distinguishes the zero-row outcomes of a CAS write for
// the REST surface (deleted == not found; live mismatch == version conflict).
func classifyCategoryWrite(ctx context.Context, q *db.Queries, householdID, id uuid.UUID) error {
	row, err := q.GetCategoryAny(ctx, db.GetCategoryAnyParams{ID: id, HouseholdID: householdID})
	if err != nil || row.DeletedAt != nil {
		return domain.ErrCategoryNotFound
	}
	return domain.ErrCategoryVersionConflict
}

func (r *Repository) GetCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetCategory"

	row, err := r.q.GetCategory(ctx, db.GetCategoryParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrCategoryNotFound
		}
		return nil, opWrap(op, err)
	}
	return categoryFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Type,
		row.Icon,
		row.Color,
		row.ArchivedAt,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) GetCategories(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetCategoriesParams,
) ([]domain.Category, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetCategories"

	var typ *string
	if params.Type != nil {
		s := string(*params.Type)
		typ = &s
	}

	rows, err := r.q.GetCategories(ctx, db.GetCategoriesParams{
		HouseholdID:     householdID,
		IncludeArchived: params.IncludeArchived,
		Type:            typ,
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.Category, 0, len(rows))
	for _, row := range rows {
		out = append(
			out,
			*categoryFromFields(row.ID, row.UserID, row.Name, row.Type, row.Icon, row.Color, row.ArchivedAt, row.CreatedAt, row.UpdatedAt, int(row.Version)),
		)
	}
	return out, nil
}

// categoryFromFields assembles a domain.Category; the category queries return
// structurally-identical generated Row types, so the construction is
// centralized here.
func categoryFromFields(
	id, userID uuid.UUID,
	name, typ, icon, color string,
	archivedAt *time.Time,
	createdAt, updatedAt time.Time,
	version int,
) *domain.Category {
	return &domain.Category{
		ID:         id,
		UserID:     userID,
		Name:       name,
		Type:       domain.TransactionType(typ),
		Icon:       icon,
		Color:      color,
		ArchivedAt: archivedAt,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		Version:    version,
	}
}
