// Package postgres owns the PostgreSQL connection (pgxpool) and the
// golang-migrate runner. It replaces the retired internal/storage/sqlite
// package: there is no SQLite, no CGO, no SetMaxOpenConns(1).
package postgres

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"time"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx/v5" database/sql driver

	"github.com/yurifa/trata/backend/internal/config"
)

// migrationsFS holds the embedded Postgres migration files
// (internal/repository/postgres/migrations/*.sql).
//
//go:embed migrations/*.sql
var migrationsFS embed.FS

// pingTimeout caps how long New waits for the first connectivity check.
const pingTimeout = 5 * time.Second

// New builds and configures a pgxpool.Pool from the given DSN and pool config,
// and verifies connectivity before returning.
func New(ctx context.Context, databaseURL string, cfg config.DatabaseConfig) (*pgxpool.Pool, error) {
	const op = "repository.postgres.New"

	pcfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%s: parse database url: %w", op, err)
	}

	if cfg.MaxConns > 0 {
		pcfg.MaxConns = cfg.MaxConns
	}
	if cfg.MinConns > 0 {
		pcfg.MinConns = cfg.MinConns
	}
	if cfg.MaxConnIdleTime > 0 {
		pcfg.MaxConnIdleTime = cfg.MaxConnIdleTime
	}
	if cfg.MaxConnLifetime > 0 {
		pcfg.MaxConnLifetime = cfg.MaxConnLifetime
	}

	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("%s: create pool: %w", op, err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("%s: ping database: %w", op, err)
	}

	return pool, nil
}

// RunMigrations applies all embedded up-migrations against the database at
// databaseURL. It opens its own short-lived *[sql.DB] (pgx stdlib) separate from
// the application pool: migrations run once at startup and never need the pool.
// migrate.ErrNoChange (DB already current) is treated as success.
func RunMigrations(databaseURL string) error {
	const op = "repository.postgres.RunMigrations"

	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("%s: iofs source: %w", op, err)
	}

	db, err := sql.Open("pgx/v5", databaseURL)
	if err != nil {
		_ = src.Close()
		return fmt.Errorf("%s: open migrate connection: %w", op, err)
	}
	defer db.Close()

	drv, err := pgxmigrate.WithInstance(db, &pgxmigrate.Config{})
	if err != nil {
		_ = src.Close()
		return fmt.Errorf("%s: migrate driver: %w", op, err)
	}

	m, err := migrate.NewWithInstance("iofs", src, "pgx5", drv)
	if err != nil {
		_ = src.Close()
		return fmt.Errorf("%s: new migrate instance: %w", op, err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("%s: apply migrations: %w", op, err)
	}

	return nil
}
