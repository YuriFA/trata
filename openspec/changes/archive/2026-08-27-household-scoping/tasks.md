# Tasks: household-scoping

## 1. Contract first

- [x] 1.1 OpenAPI: add `GET /api/household` (Household + HouseholdMember schemas), optional `displayName` on `User`, `PATCH /api/me` with `{ displayName }`; lint the spec; `pnpm gen:api` (packages/api + apps consumers) and commit regenerated types
- [x] 1.2 Extend `@trata/api`: household/me client functions and types following the existing client patterns

## 2. Database migration

- [x] 2.1 Write `000005_household.up.sql`: `households`, `household_members` (role owner|member, PK pair), `household_id NOT NULL` on the six entity tables + `change_log` + `applied_operations`, with the SQL backfill (household per user, owner memberships, row stamps); write the matching `.down.sql`
- [x] 2.2 Update `sqlc` queries: scoping `WHERE household_id` everywhere user-scoping exists today (11 query files), authorship `user_id` retained on inserts; advisory lock and seq allocation re-key to `household_id`; `make gen` regenerates

## 3. Backend re-key

- [x] 3.1 Auth middleware: resolve session → user → (single) membership, carry `householdID` in the request context; enforce membership on the household endpoints
- [x] 3.2 Services (`account`, `category`, `transaction`, `debtor`, `debt_operation`, `planned_payment`, `sync`): first parameter `userID` → `householdID`; writes stamp authorship `user_id` from the session
- [x] 3.3 Household read service + profile update: `GET /api/household` (members with email/displayName/role/joinedAt) and `PATCH /api/me` (display-name validation: non-empty trimmed, length cap)
- [x] 3.4 Registration: create user + household + owner membership in one transaction

## 4. Tests

- [x] 4.1 Service tests: two-household fixtures — member sees sibling's records, non-member gets not-found, household-unique names (categories, debtors) reject duplicates inside a household and allow equal names across households
- [x] 4.2 Sync tests: per-household `seq` monotonicity under the re-keyed advisory lock; pull isolation between households; push idempotency keys scoped by household
- [x] 4.3 Registration/backfill tests: new user auto-household; migration backfills every pre-existing user with all rows stamped

## 5. Docs and gates

- [x] 5.1 Generalize invariants #5 and #7 wording to household scoping (ADR-0002 is the recorded authority); update `docs/architecture/overview.md` pointers
- [x] 5.2 Gates: `make gen-check` + backend test suite + e2e, `ts-gen-check`, `pnpm arch:check`, `pnpm knip`, lint; fix fallout
- [x] 5.3 Verify clients untouched: mobile jest + web suites green without client-code changes
- [x] 5.4 `openspec validate household-scoping --strict` passes
