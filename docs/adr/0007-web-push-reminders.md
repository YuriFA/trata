# ADR-0007: Web Push reminders for planned payments - per-device subscriptions, no sync, household-parity dispatch

- **Status:** Accepted (2026-09-06)
- **Scope:** backend (new entity, job, endpoints), web PWA (service worker
  push handlers, opt-in UX); no planned-payments domain or sync-protocol change
- **Related:** `docs/assumptions.md` (push deferral pruned by this decision);
  ADR-0001 (session/CSRF posture the new endpoints inherit), ADR-0002
  (household model the recipient set derives from); `openspec/specs/web-pwa`
  (SW gains push handling; the no-runtime-caching rule is untouched)

## Context

The PWA is the product's primary (and currently only) interface, yet plan
reminders were delivered nowhere: the reminder setting on a plan
(`off` / `day_before` / `on_day`) is stored and synced but inert on web, and
the only implementation - mobile `expo-notifications` device-local
scheduling - is dormant along with the mobile app. `docs/assumptions.md`
had push explicitly deferred ("revisit after launch", decided 2026-08-27);
the deferral is now revised by this ADR: without any delivery channel the
reminder feature is dead UI.

Web platforms have no "schedule a local notification for tomorrow 10:00
while the app is closed" API. The only reliable cross-platform delivery is
Web Push (RFC 8030 + RFC 8291 encryption + RFC 8292 VAPID): the server
sends, the service worker displays. On iOS this works solely for PWAs
added to the home screen (16.4+), and iOS revokes delivery if the PWA is
not opened for ~30 days - acceptable for a daily-use expense tracker.
Periodic Background Sync was rejected as Chromium-only with no timing
guarantees and no iOS support.

## Decision

1. **Reminder-only channel.** The push infrastructure serves planned
   payment reminders and nothing else. Generalizing to other event classes
   (transaction pushes, conflict alerts) is future work with its own
   decisions; nothing in the storage design blocks it, but nothing
   optimizes for it either.
2. **Subscriptions are per-device records, not a synced entity.** A
   `push_subscriptions` row (endpoint URL, `p256dh`/`auth` keys, IANA
   timezone, owner user id) is created and deleted through authenticated
   REST endpoints. It never enters the change log, never appears in sync
   pull, and is invisible to other household members: a subscription is
   worthless on another device and ephemeral by nature, so sync
   participation (tombstones, versions, conflict semantics) would be pure
   protocol cost. Upsert is keyed by the endpoint URL, so a device
   re-registering refreshes its keys and timezone idempotently.
3. **Timezone lives on the subscription, not the user.** Reminders fire at
   10:00 subscriber-local time (parity with the dormant mobile model's
   device-local 10:00). The timezone is a property of the receiving
   device; storing it per subscription keeps `users` and `PATCH /api/me`
   free of a profile-settings surface this feature does not need. If
   personal notification preferences ever land, migrating tz to the user
   is a backfill plus a dispatch filter.
4. **Household-parity recipients.** A plan belongs to a household
   (ADR-0002) and its reminder setting is household state on the plan.
   Dispatch delivers to every registered device of EVERY member of the
   owning household, regardless of who edited the plan. A member without
   a subscription receives nothing. There is deliberately no per-user
   notification preference yet: the only push consumer today is a
   single-user household, and OS-level notification muting is the
   available opt-out; a server-side personal toggle is a cheap later
   addition (dispatch filter), not a schema change.
5. **At-most-once via durable markers, no catch-up.** Every successful
   send writes a `(plan, occurrence, subscription)` marker row; the
   candidate query anti-joins it. Failed deliveries write nothing and
   retry within the sweep window. Occurrences whose 10:00-local moment
   passed outside the window (job down, plan long overdue) are skipped
   permanently - overdue visibility belongs to the dashboard attention
   card, not to notification spam. `on_day` occurrences already handled
   (auto-executed by `plannedconfirm`, or manually confirmed early - both
   advanced `next_due` past today) are filtered out; the reliable
   informative setting for auto plans is `day_before`.
6. **Server initiativity is env-gated.** Without VAPID keys the job never
   starts and `GET /api/config/push` reports `enabled=false` (the web app
   hides the opt-in). Deploys without push configuration are first-class.
   The private key stays server-side (env); the public key is served
   authenticated and never inlined into the web bundle.

## Threat model

- **Endpoint URL is a bearer secret.** Anyone holding it can push to that
  device through the push service (Web Push's own model). Handling:
  never logged, never returned to other users, deleted when the push
  service reports it gone (404/410 pruning).
- **Subscription management is session-authenticated** and inherits the
  ADR-0001 posture: cookie session + server-side Origin check on
  mutations + spec validation. There is no anonymous push surface.
- **No cross-household leak.** Dispatch joins plans through households to
  members to their own subscriptions; REST delete is owner-scoped with
  foreign ids behaving as not-found (nothing revealed).
- **Payload secrecy/integrity** rides Web Push's RFC 8291 encryption; the
  payload is presentational anyway (plan name, kind, default amount) -
  activation re-reads plan state from local data, so a replayed or stale
  payload cannot misconfirm anything.
- **VAPID private key** compromise = ability to impersonate the sender to
  push services until rotated; rotation is re-issuing env keys (clients
  re-subscribe on next registration against the new key pair).

## Consequences

- The backend gains its first server-initiated channel and a second
  background job (`pushremind`, minute tick) next to `plannedconfirm`
  (hourly). They are separate deliberately: different cadence and failure
  domains - a push outage must never block money-critical execution.
- `docs/assumptions.md`'s "PWA background sync and push notifications are
  deferred" entry is pruned; the push half is decided here. Background
  sync (Periodic Background Sync) remains deferred - offline behavior
  stays the local-first data layer's job.
- The web service worker gains `push` / `notificationclick` handlers; the
  no-runtime-caching posture and prompted-update behavior are unchanged.
- iOS users must install the PWA via Safari to receive reminders; the
  opt-in UI detects non-standalone contexts and shows an install hint
  instead of a dead permission prompt.
