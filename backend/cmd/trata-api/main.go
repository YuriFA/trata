package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/yurifa/trata/backend/internal/config"
	"github.com/yurifa/trata/backend/internal/jobs/cleanup"
	"github.com/yurifa/trata/backend/internal/jobs/plannedconfirm"
	"github.com/yurifa/trata/backend/internal/jobs/pushremind"
	"github.com/yurifa/trata/backend/internal/jobs/retention"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/repository/postgres"
	"github.com/yurifa/trata/backend/internal/service"
	httptransport "github.com/yurifa/trata/backend/internal/transport/http"
)

// version is the build version reported by GET /api/health: the deployed
// image tag (sha-<short>), injected at image build time via
// -ldflags "-X main.version=..." (backend/Dockerfile ARG VERSION). Builds
// without the flag (go run, tests) keep the "dev" default.
var version = "dev"

// Version returns the build version string (see the version var).
func Version() string { return version }

func main() {
	cfg := config.MustLoad()
	log := logger.New(logger.Options{Environment: cfg.Env, AppName: "trata-api"})

	if err := run(cfg, log); err != nil {
		log.Error("fatal error", logger.Error(err))
		os.Exit(1)
	}
}

func run(cfg *config.Config, log *slog.Logger) error {
	log.Info("logger initialized", slog.String("env", cfg.Env))

	ctx := context.Background()

	if err := postgres.RunMigrations(cfg.DatabaseURL); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	log.Info("migrations applied")

	pool, err := postgres.New(ctx, cfg.DatabaseURL, cfg.Database)
	if err != nil {
		return fmt.Errorf("initialize db pool: %w", err)
	}
	defer func() {
		pool.Close()
	}()

	repo := postgres.NewRepository(pool)
	log.Info("database initialized")

	mailer, err := newMailer(cfg, log)
	if err != nil {
		return fmt.Errorf("init mailer: %w", err)
	}

	srv := newHTTPServer(cfg, repo, log, mailer)
	log.Info("starting server", slog.String("address", cfg.Address))

	serverErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	bgCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	waitJobs := startBackgroundJobs(bgCtx, repo, log, cfg)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	var runErr error
	select {
	case sig := <-quit:
		log.Info("shutting down server", slog.String("signal", sig.String()))
	case err := <-serverErr:
		runErr = fmt.Errorf("listen and serve: %w", err)
	}

	cancel()
	waitJobs()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.WriteTimeout)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		if runErr != nil {
			log.Error("server shutdown failed", logger.Error(err))
		} else {
			runErr = fmt.Errorf("server shutdown: %w", err)
		}
	}

	if runErr != nil {
		return runErr
	}

	log.Info("server exiting")
	return nil
}

// startBackgroundJobs launches the cleanup, retention, and planned-confirm
// jobs on bgCtx and returns a function that blocks until all of them have
// stopped (call it after cancelling bgCtx).
func startBackgroundJobs(
	bgCtx context.Context,
	repo *postgres.Repository,
	log *slog.Logger,
	cfg *config.Config,
) func() {
	cleanupJob := cleanup.New(repo, log, cfg.SessionConfig.CleanupInterval)
	cleanupDone := make(chan struct{})

	retentionJob := retention.New(repo, log, cfg.Retention.TombstoneWindow, cfg.Retention.Interval)
	retentionDone := make(chan struct{})

	plannedConfirmJob := plannedconfirm.New(repo, log, cfg.PlannedConfirm.Interval)
	plannedConfirmDone := make(chan struct{})

	// Web Push reminders: without VAPID keys the job never starts and the
	// config endpoint reports enabled=false, so a keys-less deploy simply
	// has no push channel (design D3, ADR-0004).
	pushRemindDone := make(chan struct{})
	if cfg.Push.Enabled() {
		sender := pushremind.NewWebPushSender(
			cfg.Push.VapidPrivateKey, cfg.Push.VapidPublicKey, cfg.Push.VapidSubject,
		)
		pushRemindJob := pushremind.New(repo, sender, log, cfg.Push.Interval)
		go func() {
			defer close(pushRemindDone)
			_ = pushRemindJob.Run(bgCtx)
		}()
	} else {
		log.InfoContext(bgCtx, "PUSH_VAPID_* keys not set: web push reminders disabled")
		close(pushRemindDone)
	}

	go func() {
		defer close(cleanupDone)
		_ = cleanupJob.Run(bgCtx)
	}()
	go func() {
		defer close(retentionDone)
		_ = retentionJob.Run(bgCtx)
	}()
	go func() {
		defer close(plannedConfirmDone)
		_ = plannedConfirmJob.Run(bgCtx)
	}()

	return func() {
		<-cleanupDone
		<-retentionDone
		<-plannedConfirmDone
		<-pushRemindDone
	}
}

// newMailer selects the Mailer from config: an SMTP relay when SMTP_HOST
// is set, else the log-only stub (local development default). A relay
// misconfiguration is fatal at boot - silently falling back to log-only
// delivery would recreate the launch gap this change closes.
func newMailer(cfg *config.Config, log *slog.Logger) (service.Mailer, error) {
	if cfg.SMTP.Host == "" {
		log.Info("SMTP_HOST not set: using log-only mailer (emails are logged, not sent)")
		return service.NewLogMailer(log), nil
	}
	mailer, err := service.NewSMTPMailer(log, service.SMTPMailerConfig{
		Host:     cfg.SMTP.Host,
		Port:     cfg.SMTP.Port,
		User:     cfg.SMTP.User,
		Password: cfg.SMTP.Password,
		From:     cfg.SMTP.From,
		TLSMode:  cfg.SMTP.TLSMode,
		// Same public origin the household service uses for invitation
		// links; the reset email builds its link from it too.
		WebAppBaseURL: cfg.Household.WebAppBaseURL,
	})
	if err != nil {
		return nil, err
	}
	log.Info("SMTP mailer configured",
		slog.String("host", cfg.SMTP.Host),
		slog.Int("port", cfg.SMTP.Port),
		slog.String("tls_mode", cfg.SMTP.TLSMode))
	return mailer, nil
}

// newHTTPServer wires every service to the single *postgres.Repository, builds
// the gin engine, and returns a configured *[http.Server] ready to serve.
func newHTTPServer(
	cfg *config.Config, repo *postgres.Repository, log *slog.Logger, mailer service.Mailer,
) *http.Server {
	accountSvc := service.NewAccountService(repo)
	categorySvc := service.NewCategoryService(repo)
	txnSvc := service.NewTransactionService(repo, repo, repo)
	debtorSvc := service.NewDebtorService(repo)
	debtOpSvc := service.NewDebtOperationService(repo, repo)
	planSvc := service.NewPlannedPaymentService(repo, repo, repo)
	authSvc := service.NewAuthService(repo, repo, repo, repo, mailer, service.AuthConfig{
		SessionTTL: cfg.SessionConfig.TTL,
	})
	sessionSvc := service.NewSessionService(repo)
	householdSvc := service.NewHouseholdService(repo, repo, mailer, log, service.HouseholdJoinConfig{
		InvitationTTL:            cfg.Household.InvitationTTL,
		MaxInvitationSendsPerDay: cfg.Household.MaxInvitationSendsPerDay,
		WebAppBaseURL:            cfg.Household.WebAppBaseURL,
	})
	syncSvc := service.NewSyncService(repo)
	pushSvc := service.NewPushService(repo)

	server := httptransport.NewServer(
		&cfg.HTTPServer,
		log,
		version,
		accountSvc,
		categorySvc,
		txnSvc,
		debtorSvc,
		debtOpSvc,
		planSvc,
		pushSvc,
		cfg.Push,
		authSvc,
		sessionSvc,
		householdSvc,
		syncSvc,
	)
	router := httptransport.NewEngine(&cfg.HTTPServer, log, server, repo, repo, repo, repo)

	return &http.Server{
		Addr:         cfg.Address,
		Handler:      router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}
}
