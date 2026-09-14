package domain

import (
	"time"

	"github.com/google/uuid"
)

// Debtor is a person the user tracks debts with. Balances are never stored:
// they are derived per direction from the debt operation history. Version is
// the optimistic-concurrency revision; DeletedAt marks a tombstone (soft
// delete): tombstoned rows are excluded from listings but retained for sync.
type Debtor struct {
	ID     uuid.UUID
	UserID uuid.UUID
	Name   string
	Note   string
	// Immutable ledger currency: every debt operation's amount is interpreted
	// in it. Defaults to the household's base currency at creation.
	Currency  string
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
	DeletedAt *time.Time
}

// Deleted reports whether the debtor is tombstoned.
func (d *Debtor) Deleted() bool { return d.DeletedAt != nil }

type CreateDebtorParams struct {
	// ID is the optional client-generated id (offline-first clients). Zero
	// means "server generates".
	ID          uuid.UUID
	HouseholdID uuid.UUID
	// UserID is the authorship stamp (the acting member), never trusted from
	// the wire.
	UserID uuid.UUID
	Name   string
	Note   string
	// Ledger currency; nil means the household's base currency. Ignored after
	// creation (immutable).
	Currency *string
}

// UpdateDebtorParams holds optional PATCH fields plus the required
// optimistic-concurrency Version. Nil means "leave unchanged"; a non-nil
// empty string clears the field (the transaction-description convention).
type UpdateDebtorParams struct {
	Name    *string
	Note    *string
	Version int
}

// DebtorFullState is the complete mutable state of a debtor (sync upserts
// carry the full record, not a PATCH).
type DebtorFullState struct {
	Name     string `json:"name"`
	Note     string `json:"note"`
	Currency string `json:"currency"`
}

// FullState returns the debtor's complete mutable state (for sync payloads).
func (d *Debtor) FullState() *DebtorFullState {
	return &DebtorFullState{
		Name:     d.Name,
		Note:     d.Note,
		Currency: d.Currency,
	}
}
