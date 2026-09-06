// Package e2e_test runs the full HTTP stack against a real PostgreSQL instance
// (testcontainers) to confirm the auth + data flows work end to end. Skipped
// under `go test -short`.
package e2e_test

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/yurifa/expense-tracker-api/internal/config"
	"github.com/yurifa/expense-tracker-api/internal/logger"
	"github.com/yurifa/expense-tracker-api/internal/repository/postgres"
	"github.com/yurifa/expense-tracker-api/internal/service"
	httptransport "github.com/yurifa/expense-tracker-api/internal/transport/http"
)

var (
	e2eEngine http.Handler
	e2eRepo   *postgres.Repository
	mailer    *captureMailer
)

// captureMailer is a service.Mailer that records issued codes/tokens so tests
// can drive the verify/reset flows without real email delivery.
type captureMailer struct {
	mu              sync.Mutex
	codes           map[string]string // email -> latest verification code
	tokens          map[string]string // email -> latest reset token
	invitationLinks map[string]string // email -> latest invitation accept link
}

func newCaptureMailer() *captureMailer {
	return &captureMailer{
		codes:           map[string]string{},
		tokens:          map[string]string{},
		invitationLinks: map[string]string{},
	}
}

func (m *captureMailer) SendVerificationCode(_ context.Context, email, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codes[email] = code
	return nil
}

func (m *captureMailer) SendHouseholdInvitation(_ context.Context, email, link string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.invitationLinks[email] = link
	return nil
}

func (m *captureMailer) SendPasswordResetToken(_ context.Context, email, token string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tokens[email] = token
	return nil
}

func (m *captureMailer) code(email string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.codes[email]
}
func (m *captureMailer) invitationLink(email string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.invitationLinks[email]
}

func (m *captureMailer) token(email string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tokens[email]
}

func TestMain(m *testing.M) {
	os.Exit(testMain(m))
}

// testMain does the container + stack setup so its defers run before the
// [os.Exit] called by TestMain. Returns the process exit code.
func testMain(m *testing.M) int {
	flag.Parse()
	if testing.Short() {
		return m.Run()
	}

	ctx := context.Background()
	container, err := tcpostgres.Run(ctx, "postgres:17-alpine",
		tcpostgres.WithDatabase("expense"), tcpostgres.WithUsername("expense"), tcpostgres.WithPassword("expense"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "e2e: failed to start postgres container: %v\n", err)
		return 1
	}
	defer func() { _ = container.Terminate(context.Background()) }()

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "e2e: connection string: %v\n", err)
		return 1
	}
	if err := postgres.RunMigrations(connStr); err != nil {
		fmt.Fprintf(os.Stderr, "e2e: migrations: %v\n", err)
		return 1
	}
	pool, err := postgres.New(ctx, connStr, config.DatabaseConfig{MaxConns: 5, MinConns: 1})
	if err != nil {
		fmt.Fprintf(os.Stderr, "e2e: pool: %v\n", err)
		return 1
	}
	defer pool.Close()

	e2eRepo = postgres.NewRepository(pool)
	mailer = newCaptureMailer()
	authSvc := service.NewAuthService(
		e2eRepo,
		e2eRepo,
		e2eRepo,
		e2eRepo,
		mailer,
		service.AuthConfig{SessionTTL: time.Hour},
	)
	accountSvc := service.NewAccountService(e2eRepo)
	categorySvc := service.NewCategoryService(e2eRepo)
	txnSvc := service.NewTransactionService(e2eRepo, e2eRepo, e2eRepo)
	debtorSvc := service.NewDebtorService(e2eRepo)
	debtOpSvc := service.NewDebtOperationService(e2eRepo, e2eRepo)
	planSvc := service.NewPlannedPaymentService(e2eRepo, e2eRepo, e2eRepo)
	sessionSvc := service.NewSessionService(e2eRepo)
	householdSvc := service.NewHouseholdService(
		e2eRepo,
		e2eRepo,
		mailer,
		logger.NewDiscardLogger(),
		service.HouseholdJoinConfig{
			WebAppBaseURL: "https://test-app.example.com",
		},
	)
	syncSvc := service.NewSyncService(e2eRepo)
	pushSvc := service.NewPushService(e2eRepo)

	server := httptransport.NewServer(
		testCfg(),
		discardLogger(),
		"dev",
		accountSvc,
		categorySvc,
		txnSvc,
		debtorSvc,
		debtOpSvc,
		planSvc,
		pushSvc,
		config.PushConfig{},
		authSvc,
		sessionSvc,
		householdSvc,
		syncSvc,
	)
	e2eEngine = httptransport.NewEngine(testCfg(), discardLogger(), server, e2eRepo, e2eRepo, e2eRepo, e2eRepo)

	return m.Run()
}

func testCfg() *config.HTTPServer {
	return &config.HTTPServer{
		Address: "127.0.0.1:0",
		CorsConfig: config.CORSConfig{
			AllowedOrigins: []string{"http://localhost:5173"},
			AllowedMethods: []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders: []string{"Content-Type"},
		},
		SessionConfig: config.SessionConfig{
			TTL:               time.Hour,
			CookieName:        "session_id",
			Secure:            false,
			SameSite:          "lax",
			SlidingExpiration: true,
		},
		FailureRateLimit:  config.FailureRateLimit{MaxAttempts: 100, LockoutDuration: time.Minute},
		RegisterRateLimit: config.RegisterRateLimit{MaxAttempts: 100, LockoutDuration: time.Minute},
	}
}

func discardLogger() *slog.Logger { return logger.NewDiscardLogger() }
