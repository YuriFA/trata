# Design: household-join

## Context

`household-scoping` delivered the scoping key, the middleware
resolution, and `GET /api/household`; every user remains alone in a
personal household. ADR-0002 fixes the join semantics: membership swap
(no merging on the server), device-side union through the initial-sync
path, orphaned personal households. The sync protocol's idempotent
creates require base revision 0, so a device joining with previously
synchronized records (server versions > 0) must reset its bookkeeping
first — that reset is the rebase. The mailer exists
(`backend/internal/service/mailer.go`, used for verification/reset).
Local schemas carry no per-row authorship today (verified: zero
`userId` mentions in `packages/local-data/src/schema.ts` and none in
the sync shapes).

## Goals / Non-Goals

**Goals:**

- Both entry paths (email invitation, home code) with the decided UX:
  the joiner explicitly chooses «перенести данные / чистый лист».
- A package-level rebase helper making the join mechanically safe
  (no stale ops, idempotent, tombstones dropped).
- Authorship end-to-end at the data level (server stamps, pull carries,
  local rows store) — display is change 3.
- Both clients receive the same flow shape.

**Non-Goals:**

- Authorship display and household settings screens (change 3:
  `household-ux`).
- Ownership transfer (v1: owner cannot leave with members present;
  dissolution or removal are the exits).
- Multiple memberships / household switching UI (schema leaves room).

## Decisions

### D1. Invitation storage and endpoints

`household_invitations(id, household_id, email, token uuid, created_by,
expires_at, accepted_at, revoked_at)`; one pending invitation per
(household, email) — re-invite refreshes token/expiry (spec's
refresh-not-duplicate). Endpoints (owner-scoped where applicable):
`POST /api/household/invitations {email}`, `GET
/api/household/invitations`, `DELETE …/{id}` (revoke), and the acceptor
side: `GET /api/invitations/{token}` (preview: household name, inviter;
requires the matching authenticated email — wrong-account gets a clear
error, unauthenticated gets 401 → client routes to login/register with
a return path), `POST /api/invitations/{token}/accept`. TTL 7 days.
The mailer gains an invitation template with the accept link (web URL
base from config, like existing verification emails).

### D2. Home code

`household_codes(household_id PK, code, created_at, revoked_at)` —
exactly one active code per household; rotate = replace; revoke =
mark. Code format: 8 characters from an unambiguous alphabet (no
0/O/1/I), surfaced for copy/typing. `POST /api/household/code`
(generate/rotate), `DELETE /api/household/code` (revoke), `POST
/api/household/join {code}` (any authenticated user). Codes bind no
identity — that is their documented nature (family fallback), unlike
invitations.

### D3. Join transaction and orphaning

Both accept paths run one transaction: validate (pending unexpired
invitation + email match, or active code) → delete the user's current
membership row (their personal household becomes orphaned; its data and
change_log stay but are unreachable) → insert membership(target, user,
member) → mark invitation accepted. Idempotency: joining the current
household short-circuits to no-op before any write. Dissolution
(owner): explicit confirm-required endpoint cascading household data
deletion (entities, change_log, applied_operations, invitations, code).

### D4. Rebase helper in `@trata/local-data`

`rebaseLocalDataForHousehold(db)` — one transaction over the local
database:

1. `UPDATE` every entity table: `server_version = 0` (rows survive as
   user data);
2. `DELETE` tombstoned rows (`deleted_at IS NOT NULL`) — their deletes
   are meaningless in the new household, and dropping them avoids
   pushing never-seen deletes (the spec has no semantics for them by
   design);
3. clear `sync_outbox` wholesale — frozen in-flight ops from the old
   household can never leak (the spec's stale-operations guarantee);
4. regenerate the outbox: one `upsert` op (base_version 0) per
   surviving row;
5. reset the pull cursor meta to 0.

Idempotent by construction (re-running re-zeroes and regenerates).
Clients call it BEFORE letting the engine run as the new household; the
clean choice uses the existing `wipeLocalData` instead and then simply
syncs. The engine itself is untouched.

### D5. Authorship plumbing

Server: `change_log` rows already keep the author `user_id` (change 1);
the pull response's change items gain `userId` (author; absent for
pre-authorship rows). OpenAPI: additive optional field on the change
item envelope (not per-entity data) — one field, all entities. Local:
entity tables gain nullable `user_id` (package migration 0003);
pull-apply stores it; local creates stamp the device owner's user id
where known (anonymous rows stay null). Push payloads never include
authorship; the server stamps from the session regardless.

### D6. Client accept flow (both apps)

Deep links: web `/invite/<token>`, mobile route `/invite/[token]`.
Authenticated + matching email → accept screen: household name,
members count, the data choice («Перенести данные с этого устройства» /
«Начать с чистого листа», default carry) → join API → rebase or wipe →
engine run (union). Unauthenticated → login/register with return;
mismatched account → clear error. Join-by-code entry lives in settings
(«У меня есть код»), same choice dialog. Anonymous local users compose
exactly as ADR noted: register → accept → union.

### D7. What the sync engine must know

Nothing. Household detection for the client is cheap: after a join the
stored owner user id is unchanged (binding stays keyed by user), and
the client itself performed the rebase — there is no ambient
"household changed" event to misdetect. A stale second device of the
same user learns of the join by household data changing under its
cursor (records it does not know appear; its own records already exist
server-side with the same ids → union converged during its own
earlier push? No — second device never joined)…

…correction, this is the one real edge: a user's OTHER device (never
opened during the join) still holds old-household state and will push
its outbox into the NEW household with stale base versions. Resolution:
the pull channel now returns the new household's stream; the engine's
existing version-conflict paths (already-sent/already-exists conflicts)
surface it, and the client offers the same rebase/wipe choice when the
household endpoint reports a household the device hasn't rebased to
(the package stores the last rebased household id in sync_meta; a
mismatch on startup/foreground → the choice dialog). This
`last_household` marker is part of D4's meta writes.

## Risks / Trade-offs

- [Rebase wipes pending tombstones → a delete made moments before
  joining is lost] → the record survives in the old (orphaned) household
  only; accepted consequence of the join choice, stated in the dialog
  copy.
- [Second-device staleness] → handled by the `last_household` marker
  (D7); covered by sync integration tests with two devices.
- [Invitation emails as spam surface] → rate-limit per household/day;
  reuse the existing mailer's operational posture.
- [Code leaking outside the family] → multi-use by design; revocation +
  rotation are one action; family threat model accepted.
- [Author field on the envelope vs per-entity data] → envelope chosen:
  one field, uniform semantics, no per-entity schema churn.

## Migration Plan

Backend migration 000006 (invitations, codes, household `name`
nullable + backfill default from owner email prefix), additive OpenAPI,
package migration 0003 (local `user_id` columns). Deploys
independently of clients; clients ship the flows when ready. Rollback =
revert (orphans remain harmless).

## Open Questions

- Invitation email copy/wording and the accept-link URL config —
  implementation detail, resolvable in-task.

## Deviations during implementation

Three issues surfaced by the two-household integration suite, all fixed
in-change:

- **Adopt-orphaned-id semantics added to the union push** (extends D4's
  story server-side): rebased creates reuse ids that still exist in the
  joiner's orphaned old household, hitting the global record PK. A base-0
  create whose id lives in a memberless household now moves the row into
  the new household (same id, per the spec delta added alongside this
  deviation); a live household's records yield an already-exists
  conflict with no state revealed. The server behavior is captured as a
  sync-protocol requirement in this change's delta.
- **Union-convergence conflicts silenced**: a base-0 push answered with
  already-exists (the same record already delivered by the user's other
  device) now adopts the server record instead of parking a manual
  conflict — same lineage, not an edit-versus-edit dispute. App flows
  invalidate queries after the sync run so pulled data shows
  immediately.
- **Client normalizers rejected server-omitted nulls**: Go's `omitempty`
  omits `name`/`displayName`/`acceptedAt`, and the household normalizers
  treated absence as malformed; nullable fields now accept both.

Known wart deferred to household-ux: **leave-then-carry** — the leaver's
fresh personal household cannot same-id-union records that still belong
to the left (live) household, so carry after leave produces per-item
already-exists errors. The model answer (ADR-0002: contributions stay
with the household) is that leave offers a clean start only; the UX task
lands in household-ux.
