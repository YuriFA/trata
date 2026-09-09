package postgres_test

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/yurifa/trata/backend/internal/config"
	"github.com/yurifa/trata/backend/internal/domain"
	postgres "github.com/yurifa/trata/backend/internal/repository/postgres"
)

// These tests run against a real PostgreSQL container via testcontainers-go.
// They are skipped under `go test -short` so constrained CI still passes.
//
// Docker must be runnable on the host.

var (
	testRepo *postgres.Repository
	testPool *pgxpool.Pool
)

// TestMain starts one Postgres container for the whole package, applies the
// embedded migrations, and exposes a ready *postgres.Repository to all tests.
func TestMain(m *testing.M) {
	os.Exit(testMain(m))
}

// testMain does the container setup so its defers run before the [os.Exit]
// called by TestMain. Returns the process exit code.
func testMain(m *testing.M) int {
	flag.Parse() // required before testing.Short() in TestMain (Go 1.24+ guard)
	if testing.Short() {
		return m.Run()
	}

	ctx := context.Background()

	container, err := tcpostgres.Run(ctx,
		"postgres:17-alpine",
		tcpostgres.WithDatabase("expense"),
		tcpostgres.WithUsername("expense"),
		tcpostgres.WithPassword("expense"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start postgres container: %v\n", err)
		fmt.Fprintln(os.Stderr, "is Docker running? these tests need it (or run with -short)")
		return 1
	}
	defer func() {
		_ = container.Terminate(context.Background())
	}()

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to get connection string: %v\n", err)
		return 1
	}

	if err := postgres.RunMigrations(connStr); err != nil {
		fmt.Fprintf(os.Stderr, "failed to run migrations: %v\n", err)
		return 1
	}

	pool, err := postgres.New(ctx, connStr, config.DatabaseConfig{
		MaxConns:        5,
		MinConns:        1,
		MaxConnIdleTime: time.Minute,
		MaxConnLifetime: 5 * time.Minute,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create pool: %v\n", err)
		return 1
	}
	defer pool.Close()

	testPool = pool
	testRepo = postgres.NewRepository(pool)

	// Discard logs during tests.
	_ = slog.Default()

	return m.Run()
}

// newCtx returns a context with a short-ish timeout for a single test operation.
func newCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// seedUser creates and returns a fresh user (with a unique email) for scoping
// tests. Each test gets its own user so cross-user isolation is real, not mocked.
func seedUser(t *testing.T, suffix string) *domain.User {
	t.Helper()
	ctx := newCtx(t)
	u, err := testRepo.RegisterUser(ctx, domain.RegisterUserParams{
		Email:        fmt.Sprintf("user-%s-%d@example.com", suffix, time.Now().UnixNano()),
		PasswordHash: "$2a$10$dummyhashfortestxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
	})
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	return u
}
