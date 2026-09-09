package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

const (
	defaultTransactionPageSize = 50
	maxTransactionPageSize     = 100
)

// TransactionService owns transaction business rules: reference validation
// (account/category ownership + type match), the cursor encode/decode, and the
// page-size +1 fetch logic. The repository handles the optimistic-concurrency
// version check (returns ErrTransactionVersionConflict on mismatch).
type TransactionService struct {
	transactions repository.TransactionRepository
	accounts     repository.AccountRepository
	categories   repository.CategoryRepository
}

func NewTransactionService(
	transactions repository.TransactionRepository,
	accounts repository.AccountRepository,
	categories repository.CategoryRepository,
) *TransactionService {
	return &TransactionService{transactions: transactions, accounts: accounts, categories: categories}
}

// refReads adapts the service's repositories to the write-rules seam.
func (s *TransactionService) refReads() RefReads {
	return repoRefReads{accounts: s.accounts, categories: s.categories}
}

func (s *TransactionService) Create(
	ctx context.Context,
	scope domain.Scope,
	params domain.CreateTransactionParams,
) (*domain.Transaction, error) {
	const op = "service.transaction.Create"

	if err := ValidateTransactionWrite(ctx, s.refReads(), scope, TransactionWriteState{
		Type:          params.Type,
		Amount:        params.Amount,
		AccountID:     params.AccountID,
		CategoryID:    params.CategoryID,
		FromAccountID: params.FromAccountID,
		ToAccountID:   params.ToAccountID,
		// fresh record: any archived category is rejected
		PrevCategoryID: nil,
	}); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	params.HouseholdID, params.UserID = scope.HouseholdID, scope.ActorID
	tx, err := s.transactions.CreateTransaction(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return tx, nil
}

func (s *TransactionService) Update(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateTransactionParams,
) (*domain.Transaction, error) {
	const op = "service.transaction.Update"

	if params.Amount == nil && params.Description == nil && params.OccurredAt == nil &&
		params.AccountID == nil && params.CategoryID == nil &&
		params.FromAccountID == nil && params.ToAccountID == nil {
		return nil, ErrNoFieldsToUpdate
	}

	current, err := s.transactions.GetTransaction(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	// Compute the effective reference set after applying the patch.
	effectiveAccountID := current.AccountID
	if params.AccountID != nil {
		effectiveAccountID = params.AccountID
	}
	effectiveCategoryID := current.CategoryID
	if params.CategoryID != nil {
		effectiveCategoryID = params.CategoryID
	}
	effectiveFromAccountID := current.FromAccountID
	if params.FromAccountID != nil {
		effectiveFromAccountID = params.FromAccountID
	}
	effectiveToAccountID := current.ToAccountID
	if params.ToAccountID != nil {
		effectiveToAccountID = params.ToAccountID
	}

	effectiveAmount := current.Amount
	if params.Amount != nil {
		effectiveAmount = *params.Amount
	}

	if err := ValidateTransactionWrite(ctx, s.refReads(), scope, TransactionWriteState{
		Type:          current.Type,
		Amount:        effectiveAmount,
		AccountID:     effectiveAccountID,
		CategoryID:    effectiveCategoryID,
		FromAccountID: effectiveFromAccountID,
		ToAccountID:   effectiveToAccountID,
		// unchanged assignment may keep an archived category
		PrevCategoryID: current.CategoryID,
	}); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	tx, err := s.transactions.UpdateTransaction(ctx, scope, id, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return tx, nil
}

func (s *TransactionService) Delete(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	const op = "service.transaction.Delete"
	if err := s.transactions.DeleteTransaction(ctx, scope, id); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *TransactionService) Get(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Transaction, error) {
	const op = "service.transaction.Get"
	tx, err := s.transactions.GetTransaction(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return tx, nil
}

// TransactionListPage is one page of listTransactions: the rows + an opaque
// cursor for the next page (nil when there are no more pages).
type TransactionListPage struct {
	Transactions []domain.Transaction
	NextCursor   *string
}

// TransactionListQuery is the service-facing input for List: the filters plus
// the opaque cursor string straight from the query string.
type TransactionListQuery struct {
	Type       *domain.TransactionType
	AccountID  *uuid.UUID
	CategoryID *uuid.UUID
	FromDate   *time.Time
	ToDate     *time.Time
	Limit      *int
	Cursor     *string // opaque
}

// List fetches a page of transactions. It asks the repository for pageSize+1
// rows; if more than pageSize came back, it encodes a nextCursor from the last
// item of the page and trims to pageSize.
func (s *TransactionService) List(
	ctx context.Context,
	scope domain.Scope,
	q TransactionListQuery,
) (*TransactionListPage, error) {
	const op = "service.transaction.List"

	pageSize := boundPageSize(q.Limit)

	var cursor *domain.TransactionCursor
	if q.Cursor != nil {
		decoded, err := DecodeTransactionCursor(*q.Cursor)
		if err != nil {
			return nil, ErrInvalidCursor
		}
		cursor = decoded
	}

	fetchLimit := pageSize + 1
	rows, err := s.transactions.GetTransactions(ctx, scope, domain.GetTransactionsParams{
		Type:       q.Type,
		AccountID:  q.AccountID,
		CategoryID: q.CategoryID,
		FromDate:   q.FromDate,
		ToDate:     q.ToDate,
		Limit:      &fetchLimit,
		Cursor:     cursor,
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	page := &TransactionListPage{Transactions: rows}
	if len(rows) > pageSize {
		encoded, err := EncodeTransactionCursor(rows[pageSize-1])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", op, err)
		}
		page.NextCursor = &encoded
		page.Transactions = rows[:pageSize]
	}

	return page, nil
}

// ErrInvalidCursor is returned when the cursor cannot be decoded. Alias of
// the domain sentinel (which owns the wire spec).
var ErrInvalidCursor = domain.ErrInvalidCursor

func boundPageSize(requested *int) int {
	size := defaultTransactionPageSize
	if requested != nil && *requested > 0 {
		size = *requested
	}
	return min(size, maxTransactionPageSize)
}

// cursorPayload is the JSON shape of the opaque keyset cursor.
type cursorPayload struct {
	OccurredAt time.Time `json:"occurredAt"`
	ID         uuid.UUID `json:"id"`
}

// EncodeTransactionCursor encodes a transaction's (occurredAt, id) as an opaque
// base64-URL string for nextCursor.
func EncodeTransactionCursor(t domain.Transaction) (string, error) {
	b, err := json.Marshal(cursorPayload{OccurredAt: t.OccurredAt, ID: t.ID})
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// DecodeTransactionCursor decodes an opaque cursor string back into the keyset.
func DecodeTransactionCursor(s string) (*domain.TransactionCursor, error) {
	b, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	var p cursorPayload
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	if p.ID == uuid.Nil {
		return nil, errors.New("invalid cursor payload")
	}
	return &domain.TransactionCursor{OccurredAt: p.OccurredAt, ID: p.ID}, nil
}
