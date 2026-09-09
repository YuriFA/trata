# Proposal: mobile-offline-first

## Why

The mobile app must be a true offline-first application: fully usable with no
network — users view their data and create, edit, and delete transactions,
changes persist locally, the UI updates immediately, and local changes
synchronize with the REST backend when connectivity returns. Today the mobile
app is a UI shell over mock data with no data layer at all, and the existing
CRUD API cannot support reliable synchronization (no client-generated ids on
create, no versioning on categories/accounts, no incremental change feed, no
tombstones for deletes). The web app stays online-only and is not affected.

## What Changes

- **Mobile local data layer (source of truth).** A local SQLite database
  (expo-sqlite + Drizzle, both usable in Expo Go) becomes the source of truth
  for the mobile UI. Local repositories implement the existing shared
  repository interfaces from `@trata/api` unchanged; features never
  learn whether the device is online. TanStack Query is the UI cache layer and
  the single reactivity mechanism (no live-query duplication).
- **Outbox on every mutation.** Each local create/update/delete writes the
  entity row and a sync operation (opId, baseVersion, payload) to a persistent
  outbox in one database transaction. The outbox and sync metadata exist from
  day one so the sync engine later plugs in without schema or repository
  changes.
- **Version/dirty state model.** Every entity carries `version` (local logical
  revision) and `server_version` (last server-confirmed revision); records are
  CLEAN iff the two are equal and DIRTY iff the local revision is greater.
  Confirmed operations are removed from the outbox individually — never by
  entity.
- **Sync engine (mobile).** A separate engine pushes outbox operations
  (batched, coalesced per entity) and pulls server changes by cursor, never
  blocking user operations on the network. Conflicts go through a persistent
  conflict flow: edit×edit is resolved by the user; delete×edit is a conflict
  with default resolution delete-wins, always notified, with
  restore-as-new-record. Initial sync binds anonymous local data to an
  authenticated account (owner check included).
- **API/backend sync support.** Client-generated UUIDs accepted on create with
  idempotent create semantics (replay by opId, no silent overwrite);
  `version` added to categories and accounts (transactions already have it);
  soft deletes with tombstones plus a server-side change-log written in the
  same DB transaction as each mutation (monotonic seq under lock); new
  `POST /api/sync/push` and `GET /api/sync/pull` endpoints with per-item
  results; persistent `applied_operations` idempotency; new error codes
  (`SYNC_VERSION_CONFLICT`, `SYNC_ALREADY_EXISTS`).
- **Category seeding becomes optional.** The mobile product starts with an
  empty category list; the 24-on-registration seed set becomes opt-in rather
  than mandatory. **BREAKING** (product behavior): new registrations no longer
  receive seeded categories unless seeding is explicitly enabled.
- **Phased delivery.** Phase 1: fully working offline app on local data
  (dashboard, categories with predefined icon/color pickers, accounts,
  transactions, three balance modes). Phase 2: contract + backend sync layer.
  Phase 3: sync engine on mobile. No phase changes the web app.

## Capabilities

### New Capabilities

- `mobile-local-data`: local-first data layer on mobile — SQLite as source of
  truth, local repositories behind the shared repository interfaces,
  transactional outbox writes, version/CLEAN/DIRTY state model, offline CRUD
  with the shared error-code semantics, and dashboard data behavior (expenses
  by category per month, all expenses per month, three balance modes, empty
  category start).
- `sync-protocol`: synchronization between mobile local state and the REST
  backend — push/pull endpoints and lifecycle, change-log and tombstones,
  idempotency (client ids + opId), conflict detection and resolution flows,
  initial sync / anonymous→authenticated lifecycle, and sync behavior under
  auth expiry.

### Modified Capabilities

- `accounts`: client-generated id on create; optimistic-concurrency `version`
  on the Account resource; soft delete (tombstone) replacing hard delete while
  keeping the in-use deletion guard.
- `categories`: client-generated id on create; `version`; soft delete
  (tombstone); registration seeding becomes optional (empty start by default).
- `transactions`: client-generated id on create; soft delete (tombstone);
  existing `version` concurrency unchanged.

## Impact

- **apps/mobile**: new dependencies (`@trata/api`,
  `expo-sqlite`, `drizzle-orm`, `drizzle-kit`, `@tanstack/react-query`,
  `@react-native-community/netinfo`); new `shared/lib/db` and `shared/lib/sync`
  modules; entities gain local repositories and TanStack Query hooks; dashboard
  switches from mock data to repositories; RU error message mapping. All
  modules used are bundled with Expo Go — no dev build required.
- **packages/api**: regenerated `schema.ts` after the OpenAPI change; sync
  endpoint client functions and types; extended error mapping for the new sync
  codes. Stays platform-agnostic (fetch-family only).
- **backend**: spec-first contract change (`docs/api/openapi.yaml` → redocly
  lint → `make gen`); Postgres migrations (`change_log`, `deleted_at`,
  `version` on categories/accounts, `applied_operations`); `/api/sync/push` and
  `/api/sync/pull` handlers; idempotent create-by-client-id; sqlc queries
  filtered for tombstones; Go tests.
- **apps/web**: unaffected (API changes are additive; web keeps online CRUD).
- **Product**: new registrations start without seeded categories unless
  seeding is enabled — recorded here as an explicit product decision.
