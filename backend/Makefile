-include .env
export CONFIG_PATH
export DATABASE_URL

# --- Tooling --------------------------------------------------------------
# Codegen tools must be on PATH. Versions are pinned via go.mod (see tools.go);
# install the pinned versions with plain `go install` (no @latest):
#   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen
#   go install github.com/sqlc-dev/sqlc/cmd/sqlc
OAPI_CODEGEN := $(shell command -v oapi-codegen 2>/dev/null)
SQLC := $(shell command -v sqlc 2>/dev/null)

# Canonical OpenAPI contract lives at the repo root.
OPENAPI_SPEC := ../docs/api/openapi.yaml

# Files produced by codegen. `gen-check` verifies these are committed and
# in sync with their inputs.
GENERATED := internal/api/api.gen.go internal/repository/db

.PHONY: run build tidy test gen gen-check gen-openapi gen-sqlc migrate-up migrate-down migrate-create dev

run:
	@echo "Starting Trata API..."
	go run ./cmd/trata-api

build:
	@echo "Building binary..."
	go build -o bin/trata-api ./cmd/trata-api

tidy:
	go mod tidy

dev: tidy run

test:
	go test -race ./...

# --- Codegen --------------------------------------------------------------
# Regenerate all generated code after changing the spec or the sqlc queries.
# sqlc is wired in once its config + queries land (Phase 4).
gen: gen-openapi gen-sqlc

gen-openapi:
	@test -n "$(OAPI_CODEGEN)" || { echo "oapi-codegen not installed; run: go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest"; exit 1; }
	$(OAPI_CODEGEN) --config internal/api/oapi-codegen.yaml $(OPENAPI_SPEC)

gen-sqlc:
	@test -n "$(SQLC)" || { echo "sqlc not installed; run: go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest"; exit 1; }
	@if [ -f sqlc.yaml ]; then $(SQLC) generate; else echo "sqlc.yaml not present yet; skipping sqlc"; fi

# CI drift gate: regenerate and fail if any generated file is not committed
# in its regenerated form. Run from backend/.
gen-check: gen
	@if ! git diff --exit-code -- $(GENERATED); then \
		echo "ERROR: generated code is out of date. Run 'make gen' and commit the result."; \
		exit 1; \
	else \
		echo "generated code is in sync"; \
	fi

# --- Migrations (Postgres) ------------------------------------------------
# DATABASE_URL is a Postgres DSN, e.g.
#   postgres://expense:expense@localhost:5432/expense?sslmode=disable
migrate-up:
	@test -n "$(DATABASE_URL)" || { echo "DATABASE_URL not set"; exit 1; }
	migrate -path ./internal/repository/postgres/migrations/ -database "$(DATABASE_URL)" up

migrate-down:
	@test -n "$(DATABASE_URL)" || { echo "DATABASE_URL not set"; exit 1; }
	migrate -path ./internal/repository/postgres/migrations/ -database "$(DATABASE_URL)" down

migrate-create:
	@test -n "$(name)" || { echo "Usage: make migrate-create name=add_xxx"; exit 1; }
	@migrate create -ext sql -dir ./internal/repository/postgres/migrations/ -seq $(name)
