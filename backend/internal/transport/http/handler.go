// Package http is the transport layer: it implements the generated
// StrictServerInterface as thin handlers that extract the authenticated
// householdID (scoping) and userID (authorship) from the request context, call
// a service, and map domain results/errors to typed OpenAPI response objects.
// No business logic, no SQL lives here.
package http

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/yurifa/expense-tracker-api/internal/config"
	"github.com/yurifa/expense-tracker-api/internal/domain"
	"github.com/yurifa/expense-tracker-api/internal/logger"
	"github.com/yurifa/expense-tracker-api/internal/service"
	"github.com/yurifa/expense-tracker-api/internal/transport/http/httpctx"
)

// Server implements api.StrictServerInterface. It holds the services, the
// session config (needed to set/clear cookies on login/logout), and a logger
// for request telemetry (sync metrics events).
type Server struct {
	cfg        *config.HTTPServer
	log        *slog.Logger
	version    string
	accounts   *service.AccountService
	categories *service.CategoryService
	txn        *service.TransactionService
	debtors    *service.DebtorService
	debtOps    *service.DebtOperationService
	plans      *service.PlannedPaymentService
	push       *service.PushService
	pushCfg    config.PushConfig
	auth       *service.AuthService
	sessions   *service.SessionService
	households *service.HouseholdService
	sync       *service.SyncService
}

func NewServer(
	cfg *config.HTTPServer,
	log *slog.Logger,
	version string,
	accounts *service.AccountService,
	categories *service.CategoryService,
	txn *service.TransactionService,
	debtors *service.DebtorService,
	debtOps *service.DebtOperationService,
	plans *service.PlannedPaymentService,
	push *service.PushService,
	pushCfg config.PushConfig,
	auth *service.AuthService,
	sessions *service.SessionService,
	households *service.HouseholdService,
	sync *service.SyncService,
) *Server {
	return &Server{
		cfg:      cfg,
		log:      logger.WithComponent(log, "http"),
		version:  version,
		accounts: accounts, categories: categories, txn: txn,
		debtors: debtors, debtOps: debtOps,
		plans: plans,
		push:  push, pushCfg: pushCfg,
		auth: auth, sessions: sessions,
		households: households,
		sync:       sync,
	}
}

// ginCtx extracts the underlying *gin.Context. oapi-codegen passes the gin
// context as a [context.Context] to the strict handler; this type assertion
// recovers it so handlers can read auth context / set cookies.
func ginCtx(ctx context.Context) *gin.Context {
	c, _ := ctx.(*gin.Context)
	return c
}

// currentUser returns the authenticated user (guaranteed set by auth middleware
// on protected routes).
func (s *Server) currentUser(ctx context.Context) *domain.User {
	return httpctx.CurrentUser(ginCtx(ctx))
}

// currentHouseholdID returns the household id of the authenticated user's
// (single, v1) membership, resolved by the auth middleware. It is the scoping
// key passed to every service call.
func (s *Server) currentHouseholdID(ctx context.Context) uuid.UUID {
	return httpctx.CurrentHouseholdID(ginCtx(ctx))
}

// currentScope returns the authenticated request's write scope (household +
// acting member) as one domain.Scope value: the single construction point for
// every household-scoped service call (ADR-0006).
func (s *Server) currentScope(ctx context.Context) domain.Scope {
	return domain.Scope{
		HouseholdID: s.currentHouseholdID(ctx),
		ActorID:     s.currentUser(ctx).ID,
	}
}
