# Tasks: household-join

## 1. Contract first

- [x] 1.1 OpenAPI: invitation endpoints (create/list/revoke owner-side; preview/accept by token), home-code endpoints (generate/rotate, revoke, join), leave/remove/dissolve, household `name` (GET/PATCH), additive `userId` on the sync change item; lint + `pnpm gen:api` + `make gen`
- [x] 1.2 Extend `@trata/api` clients for the new endpoints and the authorship field

## 2. Backend: invitations and codes

- [x] 2.1 Migration `000006_household_join`: `household_invitations`, `household_codes`, `households.name` nullable + backfill default from owner email prefix; matching down
- [x] 2.2 Invitation service + endpoints: create (refresh-not-duplicate for pending same-email), list, revoke; preview (matching-email auth) and accept with the join transaction (D3); 7-day expiry; per-household/day rate limit on sends
- [x] 2.3 Mailer: invitation template with the accept link (URL base from config, mirroring verification emails); test coverage
- [x] 2.4 Home code service + endpoints: one active code per household (8-char unambiguous alphabet), rotate/revoke, join-by-code (same transaction and idempotency as invitations)

## 3. Backend: leave/remove/dissolve + name

- [x] 3.1 Leave (member; owner-with-members rejected with a clear error), remove member (owner), dissolution (owner, explicit confirm, cascading delete of household data)
- [x] 3.2 Household name: PATCH by owner; included in GET /api/household and the invitation preview
- [x] 3.3 Backend tests: invitation lifecycle (accept happy path, wrong email, expiry, revoke, refresh), code rotate/revoke/join, join idempotency, orphaning (old household inaccessible), leave/remove/dissolve guards, authorship stamped on change_log and returned in pull

## 4. Package: rebase + authorship

- [x] 4.1 Local schema migration 0003: nullable `user_id` on all entity tables; pull-apply stores the author; local creates stamp the device owner when known
- [x] 4.2 Implement `rebaseLocalDataForHousehold(db)` per design D4 (zero versions, drop tombstones, wholesale outbox regen as creates, cursor 0) + store the `last_household` marker in sync_meta; expose over the app seams (web worker RPC, mobile direct)
- [x] 4.3 Package tests: rebase idempotency, tombstone drop, stale-outbox replacement, union end-to-end (rebase → push-as-creates → pull merge without duplicates), `last_household` mismatch detection helper

## 5. Mobile flow

- [x] 5.1 `/invite/[token]` route: unauthenticated → login/register with return; mismatched account error; accept screen (household name, data choice with carry default)
- [x] 5.2 Settings «У меня есть код» entry with the same choice dialog; leave flow with confirm
- [x] 5.3 Startup/foreground `last_household` check → the same choice dialog for a second device (D7)
- [x] 5.4 Tests: accept flow states, choice wiring (carry → rebase + run; clean → wipe + run), second-device rebas

## 6. Web flow

- [x] 6.1 `/invite/:token` route mirroring mobile (public page, auth composition with the anonymous-first shell)
- [x] 6.2 Settings: join-by-code entry, leave flow; household name display
- [x] 6.3 Worker RPC: expose rebase/`last_household`; startup `db-busy`-style gate composes with the rebase choice
- [x] 6.4 Unit tests (choice wiring, RPC surface) + backendless e2e for the invitation preview states where possible

## 7. Integration and gates

- [x] 7.1 Sync integration suite (env-gated, two households): join + carry (union, no duplicates by id), join + clean, second-device rebase, authorship round-trip
- [x] 7.2 Docs: `apps/mobile` + `apps/web` AGENTS pointers for the new flows; overview sync section mentions rebase
- [x] 7.3 Gates: backend suite + `make gen-check`, package vitest, mobile jest, web type-check/unit/e2e, `ts-gen-check`, arch:check, lint, knip
- [x] 7.4 `openspec validate household-join --strict` passes
