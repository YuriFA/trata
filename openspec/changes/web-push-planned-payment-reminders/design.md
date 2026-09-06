# Design: Web Push reminders for planned payments

## Context

The backend (Go + Gin + sqlc + Postgres) already runs the `plannedconfirm`
job (hourly, `PLANNED_CONFIRM_INTERVAL`) executing due auto plans; nothing
in the system can reach a user proactively. The web PWA's service worker is
app-shell-only with prompted updates and no runtime caching
(`openspec/specs/web-pwa`); push was explicitly deferred
(`docs/assumptions.md`, 2026-08-27) - this change revises that decision
(ADR-0007). Auth is a stateful session cookie with the ADR-0001
CSRF/transport posture; every new mutation endpoint inherits it. The web
app is local-first (SQLite-WASM), data flows through the Repository seam,
and the household model (ADR-0002) scopes plans: all members see all
plans, the reminder setting lives on the plan.

## Goals / Non-Goals

**Goals:**

- A minimal, honest Web Push channel that serves planned payment reminders
  and nothing else, without disturbing the settled PWA posture or the sync
  protocol.
- Dispatch semantics identical in spirit to the mobile model: 10:00
  device-local, day_before/on_day, one push per occurrence.

**Non-Goals:**

- No push for any other event class (transactions, debts, sync conflicts) -
  the channel is reminder-only; generalization is future work.
- No Periodic Background Sync, no notification actions beyond open/app
  routing, no per-user notification preferences (household parity chosen;
  personal opt-in is a cheap later upgrade).
- No mobile changes of any kind; the mobile reminder model stays as-is
  (device-local scheduling) for whenever the app revives.
- No user profile/settings storage; timezone lives on the subscription.

## Decisions

### D1: Web Push with VAPID, subscriptions as a plain table

Standard Web Push (RFC 8030 delivery, VAPID JWT auth) with
`github.com/webpush-helpers/go-webpush-encryption`-class sending (exact
library per tasks; a maintained Web Push library, not a bespoke crypto
implementation). Subscriptions live in a `push_subscriptions` table:
`id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `time_zone`,
`created_at`, `updated_at`. No soft delete, no version, no tombstone -
dead subscriptions are deleted outright.

- Why not per-user tz: tz is a property of the receiving device, not the
  user; storing it on the subscription keeps `users` and `PATCH /api/me`
  untouched and preserves exact "10:00 device-local" parity with mobile.
  Migration to user-level tz later is a filter + backfill if personal
  preferences ever land.
- Why not a synced entity: subscriptions are worthless on another device
  and ephemeral by nature; change-log and sync participation would add
  protocol surface for zero value (grilling decision, ADR-0007).

### D2: OpenAPI surface - two endpoints

`POST /api/push/subscriptions` (create/upsert by endpoint: body carries
`endpoint`, `keys {p256dh, auth}`, `timeZone` IANA name; same endpoint
updates keys/tz; responds with the stored subscription) and
`DELETE /api/push/subscriptions/{endpointId}` (idempotent not-found-as-ok
is avoided: deleting a missing subscription behaves as not-found, matching
household REST conventions). Both under session auth + the existing CSRF
middleware posture. Spec-first: `docs/api/openapi.yaml` then `make gen` /
`pnpm gen:api`.

- Alternative considered: `DELETE /api/push/subscriptions` with endpoint in
  body (endpoint URLs contain keys-ish material). Path segment is fine -
  the endpoint URL is already a bearer secret held server-side; URL-encode
  it. Chosen for REST consistency with the rest of the API.

### D3: Dispatch job - separate small job, not inside plannedconfirm

A new `backend/internal/jobs/pushremind` job, tick every minute (config
`PUSH_REMIND_INTERVAL`), scans for reminder moments due in
`(last_ran, now]` per timezone bucket: for each live plan with
`reminder != off`, compute the 10:00-local instant of its next
occurrence's reminder (day_before → due-1, on_day → due date) in each
distinct subscription timezone; if that instant falls inside the scan
window and was not already sent (sent-marker table
`push_reminders_sent(plan_id, occurrence_date, subscription_id, sent_at)`
with a unique key), send and record. Missed instants outside the window
are skipped (no catch-up per spec). Auto plans whose occurrence was
already executed skip the on_day push by checking `next_due` advancement.

- Why separate from `plannedconfirm`: different cadence (hourly execution
  vs minute-level reminder punctuality), different failure domain; a push
  outage must not block money-critical execution and vice versa.
- Why a sent-marker table instead of computing idempotency from
  timestamps: the spec promises "at most one push per occurrence per
  subscription"; a durable marker survives job restarts and clock jitter
  without fuzzy reasoning.
- Alternative considered: a cron-less lazy dispatch on app open (pull
  reminders when the PWA opens) - rejected: the whole point is reaching
  the user who does NOT open the app.

### D4: Timezone and time handling

Reminder instants are computed in the subscription's IANA tz via Go's
`time.LoadLocation` (tzdata embedded via `time/tzdata` import for
container portability). The scan window is compared in UTC instants;
"10:00 local" per bucket is exact. `next_due` is a calendar date (spec),
so a due date's 10:00-local instant is `time.Date(y, m, d, 10, 0, 0, 0,
loc)`; the job never writes plan data, so no DST edge exists on the write
side.

### D5: Service worker - push handler added, posture untouched

The existing SW (app-shell precache, prompted updates, no runtime caching)
gains `push` and `notificationclick` handlers in the same worker file.
`push` parses the JSON payload `{planId, planName, kind, amountMinor}`
(encrypted by the server per Web Push; content is presentational only -
the client re-reads plan state from local data on activation, so a stale
payload cannot misconfirm anything) and shows the notification.
`notificationclick` focuses an existing client via
`clients.matchAll({type: 'window'})` and postMessages a navigation intent,
or opens `/plans?confirm=<planId>` - the confirm flow itself is the
existing web confirm dialog, not a new screen. No fetch-through-cache is
introduced; the API-bypass rule is untouched.

- Why payload carries presentational data only + client re-reads state:
  push payloads are unreliable/stale by design; correctness comes from
  local data + sync, consistent with the local-first architecture.

### D6: Client subscription lifecycle (web)

A small `use-push-subscription` composable at the shared/services-ish
layer of `apps/web`: on app open (after auth), if permission is already
granted and a `pushManager` subscription exists, upsert it to the server
(cheap idempotent POST refreshing tz) - this is re-registration, not a
permission prompt, so it violates nothing in the spec (no prompt on
open). The opt-in entry (plans screen + attention card) performs the
prompt: standalone check via `matchMedia('(display-mode: standalone)')`
(+ iOS `navigator.standalone` legacy), then
`Notification.requestPermission()` → `pushManager.subscribe` (VAPID
public key served by the app config/env, not inlined in the bundle)
→ POST. In a non-standalone tab the entry shows the install hint instead
(no requestPermission call - it is unavailable/no-op there). Reminder
enablement in the plan form uses the same helper (parity with mobile).

### D7: Attention card

A `PlannedPaymentsAttentionCard` on the dashboard (widgets layer),
period-independent, fed from the existing planned-payments local data
query: overdue (next_due < today) or due today/tomorrow, sorted overdue
first; each row opens the existing confirm dialog; card hidden when the
filtered list is empty. The device opt-in entry is embedded in the card
footer when the spec's opt-in preconditions hold. No new screens, no
routes.

### D8: Pruning

Send failures with 404/410 from the push service delete the subscription
row immediately (in the dispatch transaction); 429/5xx retry on the next
tick via the natural scan window without a sent marker (marker written
only on success).

### D9: ADR-0007 + assumptions prune

`docs/adr/0007-web-push-reminders.md`: per-device subscriptions without
sync, household-parity recipients, tz-on-subscription, reminder-only
channel, threat model (endpoint secrecy = bearer capability, VAPID key
handling, subscription enumeration under session auth, no cross-household
leak: dispatch joins plans → household → members → subscriptions). The
`docs/assumptions.md` "PWA background sync and push notifications are
deferred" entry is replaced by a pointer to ADR-0007 in the same change.
Background sync remains deferred - only push is un-deferred.

## Risks / Trade-offs

- [Push requires installed PWA on iOS] → The opt-in entry detects
  non-standalone and shows the install hint instead of a dead prompt
  (spec scenario). Documented in ADR-0007.
- [Server clock/tz drift sends reminders late or twice] → Minute-tick scan
  window with half-open interval `(last, now]` + durable sent markers;
  worst case is a late reminder, never a duplicate.
- [plannedconfirm races the on_day reminder for auto plans] → Accepted
  behavior, spec'd: executed occurrences skip the push; day_before is the
  reliable setting for auto plans. Rationale in the spec scenario.
- [VAPID private key leakage] → Server-side env var only, never shipped to
  the client; public key exposed via a small authenticated config
  endpoint. Rotation procedure in ADR-0007.
- [Subscription table growth from abandoned devices] → Pruning on 410/404
  (D8); an occasional manual cleanup SQL is acceptable at single-replica
  scale.
- [Payload staleness (plan edited between send and click)] → Payload is
  presentational; activation re-reads plan state from local data (D5).

## Migration Plan

Additive only: new table + job + endpoints + SW handlers behind an
env-gated VAPID config (job no-ops when keys are absent, so deploys
without push config are safe). Rollback = stop the job / unset keys; the
subscription table and endpoints can remain harmlessly.

## Open Questions

- Notification copy details (exact RU/EN strings) - resolvable during
  implementation against `packages/i18n` keys; no behavioral impact.
- Whether the attention card also lists plans due in 3+ days later -
  explicitly out of scope now (forecast rejected in grilling); revisit by
  editing `web-screens` only.
