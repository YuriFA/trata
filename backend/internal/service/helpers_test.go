package service_test

import (
	"testing"
	"time"

	"github.com/yurifa/trata/backend/internal/service"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// services wires all services to a fresh in-memory fake store.
func services(
	t *testing.T,
) (*service.AccountService, *service.CategoryService, *service.TransactionService, *service.AuthService, *service.SessionService, *fakes.Store) {
	t.Helper()
	store := fakes.New()
	return service.NewAccountService(store),
		service.NewCategoryService(store),
		service.NewTransactionService(store, store, store),
		service.NewAuthService(
			store,
			store,
			store,
			store,
			service.NewLogMailer(testLogger()),
			service.AuthConfig{SessionTTL: time.Hour},
		),
		service.NewSessionService(store),
		store
}
