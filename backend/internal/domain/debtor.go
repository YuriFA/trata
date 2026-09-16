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
	// Ledger currency; nil means the household's base currency. Ignored after
	// creation (immutable).
	Currency *string
}

// UpdateDebtorParams holds the rename plus the required optimistic-concurrency
// Version. The name is the only updatable debtor field; nil means "leave
// unchanged" (the service rejects a no-op).
type UpdateDebtorParams struct {
	Name    *string
	Version int
}

// DebtorFullState is the complete mutable state of a debtor (sync upserts
// carry the full record, not a PATCH).
type DebtorFullState struct {
	Name     string `json:"name"`
	Currency string `json:"currency"`
}

// FullState returns the debtor's complete mutable state (for sync payloads).
func (d *Debtor) FullState() *DebtorFullState {
	return &DebtorFullState{
		Name:     d.Name,
		Currency: d.Currency,
	}
}
