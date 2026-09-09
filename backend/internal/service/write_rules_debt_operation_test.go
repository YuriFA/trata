package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
)

// Table tests for the debt operation write rules (ADR-0005): the live-debtor
// reference rule both surfaces (REST create and sync push) delegate to, and
// the debtor/direction/kind immutability rule. The service and sync-engine
// suites cover the two real read styles end to end.

type stubDebtorRefReads struct {
	debtors map[uuid.UUID]bool
}

func (s stubDebtorRefReads) DebtorExists(_ context.Context, _ domain.Scope, id uuid.UUID) (bool, error) {
	return s.debtors[id], nil
}

func TestValidateDebtOperationWrite(t *testing.T) {
	t.Parallel()

	hh := uuid.New()
	live := uuid.New()
	reads := stubDebtorRefReads{debtors: map[uuid.UUID]bool{live: true}}

	t.Run("live debtor ok", func(t *testing.T) {
		t.Parallel()
		require.NoError(
			t,
			service.ValidateDebtOperationWrite(context.Background(), reads, domain.Scope{HouseholdID: hh}, live),
		)
	})

	t.Run("missing or tombstoned debtor is not found", func(t *testing.T) {
		t.Parallel()
		err := service.ValidateDebtOperationWrite(
			context.Background(),
			reads,
			domain.Scope{HouseholdID: hh},
			uuid.New(),
		)
		require.ErrorIs(t, err, domain.ErrDebtOperationDebtorNotFound)
	})
}

func TestValidateDebtOperationImmutable(t *testing.T) {
	t.Parallel()

	cur := &domain.DebtOperation{
		DebtorID: uuid.New(), Direction: domain.DebtDirectionReceivable, Kind: domain.DebtOperationKindDebt,
	}
	same := domain.DebtOperationFullState{
		DebtorID: cur.DebtorID, Direction: cur.Direction, Kind: cur.Kind,
	}
	require.NoError(t, service.ValidateDebtOperationImmutable(cur, same))

	changedDebtor := same
	changedDebtor.DebtorID = uuid.New()
	require.ErrorIs(t, service.ValidateDebtOperationImmutable(cur, changedDebtor), domain.ErrDebtOperationImmutable)

	changedDirection := same
	changedDirection.Direction = domain.DebtDirectionPayable
	require.ErrorIs(t, service.ValidateDebtOperationImmutable(cur, changedDirection), domain.ErrDebtOperationImmutable)

	changedKind := same
	changedKind.Kind = domain.DebtOperationKindRepayment
	require.ErrorIs(t, service.ValidateDebtOperationImmutable(cur, changedKind), domain.ErrDebtOperationImmutable)
}
