// Package plannedconfirm is the server-side executor of automatic planned
// payments: an hourly background job that, for every live plan with
// confirmation mode "auto" whose next occurrence date has arrived, creates
// the transaction and advances the plan. Devices receive both records
// through the ordinary sync pull - there is no push and no client
// involvement.
//
// Idempotency is structural: the next_due advancement commits in the SAME
// per-household transaction as the transaction it produces, so a rerun (crash
// recovery, overlapping schedule) finds nothing due and creates nothing.
// The per-household advisory lock taken by WithinHouseholdTx serializes the
// job against sync pushes for the same household, so an auto execution and a
// manual confirmation of the same plan can never both advance.
package plannedconfirm

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/repository"
)

// occurredAtTime is the canonical time-of-day of an auto-executed
// occurrence: mid-day UTC keeps the transaction inside its own calendar
// date for every user and sorts before manually created same-day evening
// entries.
const occurredAtTime = 12 * time.Hour

// hoursPerDay and daysPerWeek calendar constants (mnd).
const (
	hoursPerDay = 24
	daysPerWeek = 7
)

// Store is the repository surface the job needs: the per-household locked
// transaction (due scan, transaction create, plan advancement) and the
// household work list.
type Store interface {
	WithinHouseholdTx(ctx context.Context, scope domain.Scope, fn func(t repository.SyncTx) error) error
	HouseholdsWithDueAutoPlannedPayments(ctx context.Context, today time.Time) ([]uuid.UUID, error)
}

type Job struct {
	db       Store
	log      *slog.Logger
	interval time.Duration
}

func New(db Store, log *slog.Logger, interval time.Duration) *Job {
	return &Job{
		db:       db,
		log:      logger.WithComponent(log, "plannedconfirm"),
		interval: interval,
	}
}

// Run blocks until ctx is cancelled. It performs one sweep immediately
// (startup pass), then repeats on every interval tick. Per-user errors are
// logged and never stop the loop, so Run always returns nil.
func (j *Job) Run(ctx context.Context) error {
	j.log.InfoContext(ctx, "planned-confirm job started", slog.Duration("interval", j.interval))

	j.runOnce(ctx)

	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			j.log.InfoContext(ctx, "planned-confirm job stopped")
			return nil
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

func (j *Job) runOnce(ctx context.Context) {
	today := time.Now().UTC().Truncate(hoursPerDay * time.Hour)

	householdIDs, err := j.db.HouseholdsWithDueAutoPlannedPayments(ctx, today)
	if err != nil {
		j.log.WarnContext(ctx, "failed to list households with due auto plans", logger.Error(err))
		return
	}

	for _, householdID := range householdIDs {
		if err := j.executeHousehold(ctx, householdID, today); err != nil {
			j.log.WarnContext(
				ctx, "failed to execute due auto plans",
				logger.Error(err), slog.String("householdId", householdID.String()),
			)
		}
	}
}

// executeHousehold runs the due plans of one household inside its locked
// transaction: for every due plan, one transaction per missed occurrence
// (catch-up never skips or merges - missed charges are real money), each
// committed atomically with its plan advancement. Authorship of the
// auto-created records is the plan's author (the job acts on their behalf).
func (j *Job) executeHousehold(ctx context.Context, householdID uuid.UUID, today time.Time) error {
	var created int
	err := j.db.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: householdID}, func(t repository.SyncTx) error {
		plans, err := t.DueAutoPlannedPayments(ctx, domain.Scope{HouseholdID: householdID}, today)
		if err != nil {
			return err
		}
		for i := range plans {
			plan := &plans[i]
			for !plan.NextDue.After(today) {
				if err := executeOccurrence(ctx, t, householdID, plan); err != nil {
					return err
				}
				created++
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if created > 0 {
		j.log.InfoContext(
			ctx, "auto planned payments executed",
			slog.String("householdId", householdID.String()), slog.Int("count", created),
		)
	}
	return nil
}

// executeOccurrence creates the occurrence's transaction and advances the
// plan on the same transaction. The local plan.NextDue is updated from the
// persisted advancement so the caller's catch-up loop progresses even when
// AdvanceNextDue clamps (the stored anchor governs).
func executeOccurrence(
	ctx context.Context,
	t repository.SyncTx,
	householdID uuid.UUID,
	plan *domain.PlannedPayment,
) error {
	occurredAt := plan.NextDue.UTC().Add(occurredAtTime)
	accountID := plan.AccountID
	categoryID := plan.CategoryID
	if _, err := t.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: householdID,
		UserID:      plan.UserID,
		Type:        plan.Type,
		Amount:      plan.Amount,
		Description: plan.Name,
		OccurredAt:  occurredAt,
		AccountID:   &accountID,
		CategoryID:  &categoryID,
	}); err != nil {
		return err
	}

	next := domain.AdvanceNextDue(plan.NextDue, plan.AnchorDate, plan.Regularity)
	// The job is not a session: it acts on the plan's author's behalf.
	scope := domain.Scope{HouseholdID: householdID, ActorID: plan.UserID}
	advanced, err := t.AdvancePlannedPayment(ctx, scope, plan.ID, next)
	if err != nil {
		return err
	}
	plan.NextDue = advanced.NextDue
	return nil
}
