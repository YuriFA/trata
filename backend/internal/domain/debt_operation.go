package domain

import (
	"time"

	"github.com/google/uuid"
)

// DebtDirection is the ledger a debt operation belongs to. The two directions
// are independent: balances are tracked per direction and never netted.
// Stored as TEXT with a CHECK constraint in Postgres.
type DebtDirection string

const (
	DebtDirectionReceivable DebtDirection = "receivable" // money owed to the user
	DebtDirectionPayable    DebtDirection = "payable"    // money the user owes
)

// DebtOperationKind is what an operation does to the direction's balance:
// debt grows the owed amount, repayment (списание) shrinks it. The balance is
// the sum of debt minus repayment over live operations and may be negative
// (over-repayment is data, not an error).
type DebtOperationKind string

const (
	DebtOperationKindDebt      DebtOperationKind = "debt"
	DebtOperationKindRepayment DebtOperationKind = "repayment"
)

// DebtOperation is one ledger record referencing a debtor. Direction and kind
// are immutable after creation. DeletedAt marks a tombstone (soft delete).
type DebtOperation struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	DebtorID   uuid.UUID
	Direction  DebtDirection
	Kind       DebtOperationKind
	Amount     int64
	OccurredAt time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
	Version    int
	DeletedAt  *time.Time
}

// Deleted reports whether the operation is tombstoned.
func (o *DebtOperation) Deleted() bool { return o.DeletedAt != nil }

type CreateDebtOperationParams struct {
	// ID is the optional client-generated id (offline-first clients). Zero
	// means "server generates".
	ID          uuid.UUID
	HouseholdID uuid.UUID
	// UserID is the authorship stamp (the acting member), never trusted from
	// the wire.
	UserID     uuid.UUID
	DebtorID   uuid.UUID
	Direction  DebtDirection
	Kind       DebtOperationKind
	Amount     int64
	OccurredAt time.Time
}

// UpdateDebtOperationParams holds optional PATCH fields plus the required
// optimistic-concurrency Version. Pointer fields are nil to "leave
// unchanged". DebtorID, Direction, and Kind are immutable and therefore
// absent.
type UpdateDebtOperationParams struct {
	Amount     *int64
	OccurredAt *time.Time
	Version    int
}

// GetDebtOperationsParams filters the operation list. Nil DebtorID means
// "all of the user's operations".
type GetDebtOperationsParams struct {
	DebtorID *uuid.UUID
}

// DebtOperationFullState is the complete mutable state of an operation (sync
// upserts carry the full record, not a PATCH). DebtorID, Direction, and Kind
// are immutable.
type DebtOperationFullState struct {
	DebtorID   uuid.UUID         `json:"debtorId"`
	Direction  DebtDirection     `json:"direction"`
	Kind       DebtOperationKind `json:"kind"`
	Amount     int64             `json:"amount"`
	OccurredAt time.Time         `json:"occurredAt"`
}

// FullState returns the operation's complete mutable state (for sync
// payloads).
func (o *DebtOperation) FullState() *DebtOperationFullState {
	return &DebtOperationFullState{
		DebtorID:   o.DebtorID,
		Direction:  o.Direction,
		Kind:       o.Kind,
		Amount:     o.Amount,
		OccurredAt: o.OccurredAt,
	}
}
