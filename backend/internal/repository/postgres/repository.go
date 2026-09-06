package postgres

import (
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yurifa/expense-tracker-api/internal/repository"
	db "github.com/yurifa/expense-tracker-api/internal/repository/db"
)

// Repository is the concrete Postgres implementation of the repository
// interfaces. It wraps the sqlc-generated Queries (over a pgxpool) and adds the
// few procedural, multi-statement flows (registration, email-verify, password
// reset) that sqlc cannot express.
type Repository struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

// NewRepository builds a Repository over the given pool. Migrations must have
// been applied already.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool, q: db.New(pool)}
}

// Compile-time guarantees that *Repository implements every repository
// interface. If a method signature drifts, the build breaks here.
var (
	_ repository.UserRepository              = (*Repository)(nil)
	_ repository.SessionRepository           = (*Repository)(nil)
	_ repository.AccountRepository           = (*Repository)(nil)
	_ repository.CategoryRepository          = (*Repository)(nil)
	_ repository.TransactionRepository       = (*Repository)(nil)
	_ repository.IdempotencyRepository       = (*Repository)(nil)
	_ repository.EmailVerificationRepository = (*Repository)(nil)
	_ repository.PasswordResetRepository     = (*Repository)(nil)
	_ repository.PushSubscriptionRepository  = (*Repository)(nil)
)

// pgUniqueViolation reports whether err is a Postgres unique_violation (the
// only constraint class the soft-delete schema can still raise: PK/client-id
// duplicates and the live-category-name partial index).
func pgUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgCodeUniqueViolation
}

const pgCodeUniqueViolation = "23505"

// errNoRows unwraps the pgx "no rows" case.
func errNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
