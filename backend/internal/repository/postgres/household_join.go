// Household join lifecycle persistence (household-join change): email
// invitations, the home join code, and the membership-move transactions
// (join/leave/remove/dissolve). Like registration, these are procedural
// multi-statement flows over one transaction - sqlc stays for the
// single-step queries; the moves live here as explicit tx bodies so the
// ordering constraints of design D3 are visible in one place.

package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yurifa/trata/backend/internal/domain"
)

// invitationColumns is the shared SELECT list for household_invitations.
const invitationColumns = `
	id, household_id, email, token, created_by, created_at, expires_at, accepted_at, revoked_at`

type invitationScanner interface {
	Scan(dest ...any) error
}

func scanInvitation(row invitationScanner) (*domain.HouseholdInvitation, error) {
	var inv domain.HouseholdInvitation
	if err := row.Scan(
		&inv.ID, &inv.HouseholdID, &inv.Email, &inv.Token, &inv.CreatedBy,
		&inv.CreatedAt, &inv.ExpiresAt, &inv.AcceptedAt, &inv.RevokedAt,
	); err != nil {
		return nil, err
	}
	return &inv, nil
}

// UpdateHousehold sets or clears (name = nil) the household display name and
// optionally changes the base currency (nil = keep). A currency change only
// moves the presentation conversion target - no stored amount is rewritten.
func (r *Repository) UpdateHousehold(
	ctx context.Context,
	scope domain.Scope,
	name, currency *string,
) error {
	householdID := scope.HouseholdID
	const op = "repository.postgres.UpdateHousehold"
	_, err := r.pool.Exec(
		ctx,
		`UPDATE households SET name = $2, currency = COALESCE($3, currency) WHERE id = $1`,
		householdID,
		name,
		currency,
	)
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// CountHouseholdInvitationSends counts invitation sends (creates + refreshes,
// both bump created_at) within the last 24h - the per-household/day send
// budget enforced by the service.
func (r *Repository) CountHouseholdInvitationSends(
	ctx context.Context,
	scope domain.Scope,
) (int, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.CountHouseholdInvitationSends"
	var count int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM household_invitations
		WHERE household_id = $1 AND created_at >= now() - interval '24 hours'`,
		householdID,
	).Scan(&count)
	if err != nil {
		return 0, opWrap(op, err)
	}
	return count, nil
}

// CreateHouseholdInvitation inserts a fresh invitation, or - when a pending
// (not accepted, not revoked; expired still counts) invitation exists for the
// same email - refreshes it in place with a new token/expiry (the spec's
// refresh-not-duplicate). The partial unique index is the race guard.
func (r *Repository) CreateHouseholdInvitation(
	ctx context.Context,
	householdID uuid.UUID,
	email string,
	createdBy uuid.UUID,
	ttl time.Duration,
) (*domain.HouseholdInvitation, error) {
	const op = "repository.postgres.CreateHouseholdInvitation"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE household_invitations
		SET token = gen_random_uuid(), expires_at = now() + $3::interval,
		    created_by = $4, created_at = now()
		WHERE household_id = $1 AND email = $2
		  AND accepted_at IS NULL AND revoked_at IS NULL`,
		householdID, email, ttl.String(), createdBy,
	)
	if err != nil {
		return nil, opWrap(op, err)
	}
	if tag.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO household_invitations (household_id, email, created_by, expires_at)
			VALUES ($1, $2, $3, now() + $4::interval)`,
			householdID, email, createdBy, ttl.String(),
		); err != nil {
			return nil, opWrap(op, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, opWrap(op, err)
	}

	inv, err := r.GetPendingInvitationByEmail(ctx, householdID, email)
	if err != nil {
		return nil, opWrap(op, err)
	}
	if inv == nil {
		return nil, opWrap(op, errors.New("invitation write produced no pending invitation"))
	}
	return inv, nil
}

// GetPendingInvitationByEmail loads the household's pending invitation for an
// email (nil when none). Expired-but-unconsumed invitations count as pending.
func (r *Repository) GetPendingInvitationByEmail(
	ctx context.Context,
	householdID uuid.UUID,
	email string,
) (*domain.HouseholdInvitation, error) {
	const op = "repository.postgres.GetPendingInvitationByEmail"
	row := r.pool.QueryRow(ctx, `
		SELECT`+invitationColumns+`
		FROM household_invitations
		WHERE household_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		householdID, email,
	)
	inv, err := scanInvitation(row)
	if err != nil {
		if errNoRows(err) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
		}
		return nil, opWrap(op, err)
	}
	return inv, nil
}

// ListHouseholdInvitations returns the household's invitations, freshest
// first.
func (r *Repository) ListHouseholdInvitations(
	ctx context.Context,
	scope domain.Scope,
) ([]domain.HouseholdInvitation, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.ListHouseholdInvitations"
	rows, err := r.pool.Query(ctx, `
		SELECT`+invitationColumns+`
		FROM household_invitations
		WHERE household_id = $1
		ORDER BY created_at DESC, id`,
		householdID,
	)
	if err != nil {
		return nil, opWrap(op, err)
	}
	defer rows.Close()

	invitations := make([]domain.HouseholdInvitation, 0)
	for rows.Next() {
		inv, err := scanInvitation(rows)
		if err != nil {
			return nil, opWrap(op, err)
		}
		invitations = append(invitations, *inv)
	}
	if err := rows.Err(); err != nil {
		return nil, opWrap(op, err)
	}
	return invitations, nil
}

// RevokeHouseholdInvitation marks the invitation revoked (idempotent: an
// already-revoked invitation is a silent success). Unknown id (or one from
// another household) -> domain.ErrInvitationNotFound.
func (r *Repository) RevokeHouseholdInvitation(
	ctx context.Context,
	scope domain.Scope, invitationID uuid.UUID,
) error {
	householdID := scope.HouseholdID
	const op = "repository.postgres.RevokeHouseholdInvitation"
	tag, err := r.pool.Exec(ctx, `
		UPDATE household_invitations SET revoked_at = now()
		WHERE id = $1 AND household_id = $2 AND revoked_at IS NULL`,
		invitationID, householdID,
	)
	if err != nil {
		return opWrap(op, err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := r.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM household_invitations WHERE id = $1 AND household_id = $2
			)`,
			invitationID, householdID,
		).Scan(&exists); err != nil {
			return opWrap(op, err)
		}
		if !exists {
			return domain.ErrInvitationNotFound
		}
	}
	return nil
}

// GetHouseholdInvitationByToken loads an invitation by its accept token in
// ANY state (nil when the token is unknown or rotated away) - the service
// maps the lifecycle states to their errors so revoked/consumed invitations
// report precisely instead of "not found".
func (r *Repository) GetHouseholdInvitationByToken(
	ctx context.Context,
	token uuid.UUID,
) (*domain.HouseholdInvitation, error) {
	const op = "repository.postgres.GetHouseholdInvitationByToken"
	row := r.pool.QueryRow(ctx, `
		SELECT`+invitationColumns+`
		FROM household_invitations
		WHERE token = $1`,
		token,
	)
	inv, err := scanInvitation(row)
	if err != nil {
		if errNoRows(err) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
		}
		return nil, opWrap(op, err)
	}
	return inv, nil
}

// markInvitationAccepted claims a pending invitation inside the join
// transaction (accepted_at = now). 0 rows updated means another accept
// consumed it first.
func markInvitationAccepted(ctx context.Context, tx pgx.Tx, invitationID uuid.UUID) error {
	tag, err := tx.Exec(ctx, `
		UPDATE household_invitations SET accepted_at = now()
		WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
		invitationID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrInvitationAlreadyAccepted
	}
	return nil
}

// JoinHousehold performs the D3 membership swap in ONE transaction: the
// user's current membership row is deleted (their former personal household
// is orphaned - retained server-side, access lost) and a member membership is
// inserted for the target household. Joining the household the user already
// belongs to is a no-op BEFORE any write (spec: repeated accept changes
// nothing; an outstanding invitation expires on its own). A pending
// invitationID is claimed in the same transaction.
func (r *Repository) JoinHousehold(
	ctx context.Context,
	userID, targetHouseholdID uuid.UUID,
	invitationID *uuid.UUID,
) (*domain.Household, error) {
	const op = "repository.postgres.JoinHousehold"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var current uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT household_id FROM household_members WHERE user_id = $1`,
		userID,
	).Scan(&current)
	if err != nil {
		if errNoRows(err) {
			return nil, opWrap(op, domain.ErrMembershipNotFound)
		}
		return nil, opWrap(op, err)
	}
	if current == targetHouseholdID {
		return r.GetHouseholdWithMembers(ctx, domain.Scope{HouseholdID: targetHouseholdID})
	}

	if invitationID != nil {
		if err := markInvitationAccepted(ctx, tx, *invitationID); err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM household_members WHERE user_id = $1`, userID); err != nil {
		return nil, opWrap(op, err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO household_members (household_id, user_id, role)
		VALUES ($1, $2, 'member')`,
		targetHouseholdID, userID,
	); err != nil {
		return nil, opWrap(op, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, opWrap(op, err)
	}
	return r.GetHouseholdWithMembers(ctx, domain.Scope{HouseholdID: targetHouseholdID})
}

// householdCodeAlphabet is the unambiguous 8-char code alphabet (no 0/O/1/I).
const householdCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// householdCodeLength matches the contract's 8-char join code.
const householdCodeLength = 8

func generateHouseholdCode() (string, error) {
	out := make([]byte, householdCodeLength)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(householdCodeAlphabet))))
		if err != nil {
			return "", err
		}
		out[i] = householdCodeAlphabet[n.Int64()]
	}
	return string(out), nil
}

// GenerateHouseholdCode issues (or rotates) the household's single join code:
// one row per household - rotate overwrites code/created_at in place, a
// previously revoked row is reactivated. Collisions with another household's
// active code retry with a fresh draw.
func (r *Repository) GenerateHouseholdCode(
	ctx context.Context,
	scope domain.Scope,
) (*domain.HouseholdCode, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GenerateHouseholdCode"
	for range 5 {
		code, err := generateHouseholdCode()
		if err != nil {
			return nil, opWrap(op, err)
		}
		var hc domain.HouseholdCode
		err = r.pool.QueryRow(ctx, `
			INSERT INTO household_codes (household_id, code)
			VALUES ($1, $2)
			ON CONFLICT (household_id) DO UPDATE
			SET code = EXCLUDED.code, created_at = now(), revoked_at = NULL
			RETURNING household_id, code, created_at, revoked_at`,
			householdID, code,
		).Scan(&hc.HouseholdID, &hc.Code, &hc.CreatedAt, &hc.RevokedAt)
		if err != nil {
			if pgUniqueViolation(err) {
				// Another household holds this active code - redraw.
				continue
			}
			return nil, opWrap(op, err)
		}
		return &hc, nil
	}
	return nil, opWrap(op, errors.New("could not allocate a unique household code"))
}

// RevokeHouseholdCode deactivates the household's code (idempotent).
func (r *Repository) RevokeHouseholdCode(ctx context.Context, scope domain.Scope) error {
	householdID := scope.HouseholdID
	const op = "repository.postgres.RevokeHouseholdCode"
	_, err := r.pool.Exec(ctx, `
		UPDATE household_codes SET revoked_at = now()
		WHERE household_id = $1 AND revoked_at IS NULL`,
		householdID,
	)
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// FindHouseholdByActiveCode resolves an active code to its household id
// (uuid.Nil when the code is unknown, revoked, or rotated out).
func (r *Repository) FindHouseholdByActiveCode(
	ctx context.Context,
	code string,
) (uuid.UUID, error) {
	const op = "repository.postgres.FindHouseholdByActiveCode"
	var householdID uuid.UUID
	err := r.pool.QueryRow(ctx, `
		SELECT household_id FROM household_codes
		WHERE code = $1 AND revoked_at IS NULL`,
		code,
	).Scan(&householdID)
	if err != nil {
		if errNoRows(err) {
			return uuid.Nil, nil
		}
		return uuid.Nil, opWrap(op, err)
	}
	return householdID, nil
}

// createPersonalHouseholdTx inserts a fresh EMPTY personal household with the
// user as owner. No starter categories: a device that carries its local data
// across a leave/join pushes its own categories, and the per-household unique
// live-name index would collide with seeds.
func createPersonalHouseholdTx(
	ctx context.Context,
	tx pgx.Tx,
	userID uuid.UUID,
) (uuid.UUID, error) {
	householdID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO households (id) VALUES ($1)`, householdID); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO household_members (household_id, user_id, role)
		VALUES ($1, $2, 'owner')`,
		householdID, userID,
	); err != nil {
		return uuid.Nil, err
	}
	return householdID, nil
}

// LeaveHousehold removes the user's membership and hands them a fresh empty
// personal household (the exactly-one-membership invariant). The old
// household and its data stay, untouched and inaccessible to the leaver.
// Caller validates the owner-with-members guard first.
func (r *Repository) LeaveHousehold(
	ctx context.Context,
	userID uuid.UUID,
) (*domain.Household, error) {
	const op = "repository.postgres.LeaveHousehold"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Drop the old membership first: the unique index on user_id forbids a
	// second row even mid-transaction. One tx = no membership-less window.
	if _, err := tx.Exec(ctx, `DELETE FROM household_members WHERE user_id = $1`, userID); err != nil {
		return nil, opWrap(op, err)
	}
	householdID, err := createPersonalHouseholdTx(ctx, tx, userID)
	if err != nil {
		return nil, opWrap(op, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, opWrap(op, err)
	}
	return r.GetHouseholdWithMembers(ctx, domain.Scope{HouseholdID: householdID})
}

// RemoveHouseholdMember deletes the target's membership and hands them a
// fresh personal household in one transaction. The household's data is not
// touched. The owner cannot be removed (dissolve instead).
func (r *Repository) RemoveHouseholdMember(
	ctx context.Context,
	householdID, targetUserID uuid.UUID,
) error {
	const op = "repository.postgres.RemoveHouseholdMember"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var role domain.HouseholdRole
	err = tx.QueryRow(ctx, `
		SELECT role FROM household_members WHERE household_id = $1 AND user_id = $2`,
		householdID, targetUserID,
	).Scan(&role)
	if err != nil {
		if errNoRows(err) {
			return domain.ErrHouseholdMemberNotFound
		}
		return opWrap(op, err)
	}
	if role == domain.HouseholdRoleOwner {
		return domain.ErrHouseholdMemberIsOwner
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM household_members WHERE household_id = $1 AND user_id = $2`,
		householdID, targetUserID,
	); err != nil {
		return opWrap(op, err)
	}
	if _, err := createPersonalHouseholdTx(ctx, tx, targetUserID); err != nil {
		return opWrap(op, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// DissolveHousehold deletes the household WITH all of its data in one
// transaction, then hands every member a fresh empty personal household.
// Runs under the household's change-log lock so a concurrent sync push
// cannot interleave writes into the sweep.
func (r *Repository) DissolveHousehold(ctx context.Context, scope domain.Scope) error {
	householdID := scope.HouseholdID
	const op = "repository.postgres.DissolveHousehold"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(
		ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
		householdID.String(),
	); err != nil {
		return opWrap(op, err)
	}

	rows, err := tx.Query(
		ctx,
		`SELECT user_id FROM household_members WHERE household_id = $1`,
		householdID,
	)
	if err != nil {
		return opWrap(op, err)
	}
	memberIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return opWrap(op, err)
		}
		memberIDs = append(memberIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return opWrap(op, err)
	}

	// Entity tables first (referencing rows), then the sync plumbing and the
	// join-lifecycle rows, then the household itself. FKs would catch a miss,
	// but the order keeps deletes cheap and readable.
	for _, table := range []string{
		"transactions", "planned_payments", "categories", "accounts",
		"debt_operations", "debtors",
		"applied_operations", "change_log",
		"household_invitations", "household_codes", "household_members",
	} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE household_id = $1`, householdID); err != nil {
			return opWrap(op, err)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM households WHERE id = $1`, householdID); err != nil {
		return opWrap(op, err)
	}

	for _, memberID := range memberIDs {
		if _, err := createPersonalHouseholdTx(ctx, tx, memberID); err != nil {
			return opWrap(op, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}
