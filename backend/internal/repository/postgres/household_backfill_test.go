package postgres_test

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/yurifa/trata/backend/internal/domain"
	postgres "github.com/yurifa/trata/backend/internal/repository/postgres"
)

// The household backfill (household-scoping change, migration 000005) upgrades
// a PRE-household database: every existing user must end up as the owner of
// exactly one household whose id equals their user id, and every existing row
// (entities, change_log, applied_operations) must be stamped with it. The test
// replays the real migration sequence on a dedicated container: apply
// 000001-000004, seed legacy-shaped data, run 000005 up, assert, run the down
// migration, and assert the schema reverted to user scoping.
func TestMigration_HouseholdBackfill(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	t.Parallel()

	ctx := context.Background()

	container, err := tcpostgres.Run(ctx,
		"postgres:17-alpine",
		tcpostgres.WithDatabase("expense"),
		tcpostgres.WithUsername("expense"),
		tcpostgres.WithPassword("expense"),
		tcpostgres.BasicWaitStrategies(),
	)
	require.NoError(t, err, "start postgres container")
	defer func() { _ = container.Terminate(context.Background()) }()

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	pool, err := pgxpool.New(ctx, connStr)
	require.NoError(t, err)
	defer pool.Close()

	// Pre-household schema: the first four migration pairs only.
	for _, f := range []string{
		"migrations/000001_init.up.sql",
		"migrations/000002_sync.up.sql",
		"migrations/000003_add_debts.up.sql",
		"migrations/000004_add_planned_payments.up.sql",
	} {
		sql, err := os.ReadFile(f)
		require.NoError(t, err, "read %s", f)
		_, err = pool.Exec(ctx, string(sql))
		require.NoError(t, err, "apply %s", f)
	}

	// Legacy-shaped data: two users, rows in every stamped table. Plain
	// literals (no bind parameters) keep pgx on the simple protocol, which
	// accepts the multi-statement script.
	userA, userB := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"

	legacy := `
		INSERT INTO users (id, email, password_hash) VALUES
			('11111111-1111-4111-8111-111111111111', 'a@x.example', 'h'),
			('22222222-2222-4222-8222-222222222222', 'b@x.example', 'h');
		INSERT INTO accounts (id, user_id, name, currency, opening_balance)
			VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'A', 'USD', 0);
		INSERT INTO categories (id, user_id, name, type, icon, color)
			VALUES ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Food', 'expense', 'i', '#fff');
		INSERT INTO transactions (id, user_id, type, amount, occurred_at, account_id, category_id)
			VALUES ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'expense', 100, now(),
			        'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001');
		INSERT INTO debtors (id, user_id, name) VALUES ('dddddddd-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Анна');
		INSERT INTO debt_operations (id, user_id, debtor_id, direction, kind, amount, occurred_at)
			VALUES ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'dddddddd-0000-4000-8000-000000000001',
			        'receivable', 'debt', 100, now());
		INSERT INTO planned_payments (id, user_id, type, amount, account_id, category_id, next_due, anchor_date, regularity, confirm_mode, reminder)
			VALUES ('ffffffff-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'expense', 100,
			        'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
			        current_date, current_date, 'monthly', 'manual', 'off');
		INSERT INTO change_log (user_id, entity, entity_id, action, version)
			VALUES ('11111111-1111-4111-8111-111111111111', 'account', 'aaaaaaaa-0000-4000-8000-000000000001', 'upsert', 1);
		INSERT INTO applied_operations (op_id, user_id, entity, entity_id, result)
			VALUES ('99999999-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'account',
			        'aaaaaaaa-0000-4000-8000-000000000001', '{}');
		-- Rows of the SECOND user: they must land in their own household.
		INSERT INTO accounts (id, user_id, name, currency, opening_balance)
			VALUES ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'B', 'USD', 0);`
	_, err = pool.Exec(ctx, legacy)
	require.NoError(t, err)

	// Run the household migration.
	upSQL, err := os.ReadFile("migrations/000005_household.up.sql")
	require.NoError(t, err)
	_, err = pool.Exec(ctx, string(upSQL))
	require.NoError(t, err, "apply 000005 up")

	// Every user: exactly one household, owned, id == user id (the documented
	// backfill mapping).
	rows, err := pool.Query(ctx, `
		SELECT u.id, m.household_id, m.role
		FROM users u
		JOIN household_members m ON m.user_id = u.id
		ORDER BY u.id`)
	require.NoError(t, err)
	var memberships []struct{ userID, householdID, role string }
	for rows.Next() {
		var m struct{ userID, householdID, role string }
		require.NoError(t, rows.Scan(&m.userID, &m.householdID, &m.role))
		memberships = append(memberships, m)
	}
	require.NoError(t, rows.Err())
	require.Len(t, memberships, 2, "one membership per user")
	assert.Equal(t, userA, memberships[0].householdID, "personal household id = user id")
	assert.Equal(t, "owner", memberships[0].role)
	assert.Equal(t, userB, memberships[1].householdID)
	assert.Equal(t, "owner", memberships[1].role)

	// No unstamped rows anywhere.
	for _, table := range []string{
		"accounts", "categories", "transactions", "debtors", "debt_operations",
		"planned_payments", "change_log", "applied_operations",
	} {
		var unstamped int
		err := pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE household_id IS NULL`).Scan(&unstamped)
		require.NoError(t, err, table)
		assert.Zero(t, unstamped, "%s rows must all be stamped", table)
	}

	// The stamps point at the right households: user A's rows at A's household
	// (8 rows incl. change_log + applied_operations), user B's at B's.
	var stampedA, stampedB int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM accounts WHERE household_id = $1`, userA).Scan(&stampedA))
	assert.Equal(t, 1, stampedA)
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM accounts WHERE household_id = $1`, userB).Scan(&stampedB))
	assert.Equal(t, 1, stampedB)

	// The household-scoped unique name index coexists with the backfill: two
	// live categories named "Food" in different households are both present.
	var liveNames int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM categories WHERE name = 'Food' AND deleted_at IS NULL`).Scan(&liveNames))
	assert.Equal(t, 1, liveNames)

	// The post-migration repository layer works over the migrated data.
	// The remaining migration pairs are applied first so the CURRENT queries'
	// schema exists at this point in history (e.g. the account_with_balance
	// view of 000009 that GetAccounts reads).
	for _, f := range migrationFilesAfter(t, "000005_household.up.sql") {
		sql, err := os.ReadFile(f)
		require.NoError(t, err, "read %s", f)
		_, err = pool.Exec(ctx, string(sql))
		require.NoError(t, err, "apply %s", f)
	}
	repo := postgres.NewRepository(pool)
	hhA, err := repo.GetMembershipByUser(ctx, mustUUID(userA))
	require.NoError(t, err)
	assert.Equal(t, domain.HouseholdRoleOwner, hhA.Role)
	accounts, err := repo.GetAccounts(ctx, domain.Scope{HouseholdID: hhA.HouseholdID})
	require.NoError(t, err)
	require.Len(t, accounts, 1)
	assert.Equal(t, "A", accounts[0].Name)
	changes, err := repo.PullChanges(ctx, domain.Scope{HouseholdID: hhA.HouseholdID}, 0, 100)
	require.NoError(t, err)
	require.Len(t, changes, 1, "legacy change_log rows pull for the household")

	// Down migration: reverts to user scoping (records keep their user_id).
	// Every later pair walks back first (their downs must be clean), then
	// 000005 down drops the households table.
	for _, f := range migrationDownsAfter(t, "000005_household.down.sql") {
		sql, err := os.ReadFile(f)
		require.NoError(t, err, "read %s", f)
		_, err = pool.Exec(ctx, string(sql))
		require.NoError(t, err, "apply %s", f)
	}
	downSQL, err := os.ReadFile("migrations/000005_household.down.sql")
	require.NoError(t, err)
	_, err = pool.Exec(ctx, string(downSQL))
	require.NoError(t, err, "apply 000005 down")

	var householdsGone int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.tables WHERE table_name = 'households'`).Scan(&householdsGone))
	assert.Zero(t, householdsGone, "households table dropped")

	var accountsKept int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM accounts`).Scan(&accountsKept))
	assert.Equal(t, 2, accountsKept, "records survive the down migration")
}

func mustUUID(s string) uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		panic(err)
	}
	return id
}

// migrationFilesAfter lists the up-migration files whose numbered prefix
// sorts after the given one (lexicographic order = numeric order for the
// zero-padded four-digit prefixes).
func migrationFilesAfter(t *testing.T, after string) []string {
	t.Helper()
	entries, err := os.ReadDir("migrations")
	require.NoError(t, err, "list migrations")
	var out []string
	for _, e := range entries {
		if name := e.Name(); strings.HasSuffix(name, ".up.sql") && name > after {
			out = append(out, "migrations/"+name)
		}
	}
	return out
}

// migrationDownsAfter lists the down-migration files whose numbered prefix
// sorts after the given one, in REVERSE order (the rollback sequence).
func migrationDownsAfter(t *testing.T, after string) []string {
	t.Helper()
	entries, err := os.ReadDir("migrations")
	require.NoError(t, err, "list migrations")
	var out []string
	for _, e := range entries {
		if name := e.Name(); strings.HasSuffix(name, ".down.sql") && name > after {
			out = append(out, "migrations/"+name)
		}
	}
	slices.Reverse(out)
	return out
}
