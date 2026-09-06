# Web Push reminders for planned payments

## Why

The PWA is the primary - and currently only - interface, yet plan reminders
are delivered nowhere: the reminder setting on a plan is stored and synced
but inert on web, and the only implementation (mobile expo-notifications)
is dormant along with the mobile app. Time-sensitive planned payments
("пора заплатить за квартиру" the day it is due, "завтра спишется" before
an auto charge) are invisible outside the plans screen, so a user who does
not visit it can silently miss them.

## What Changes

- New **Web Push channel** for plan reminders (VAPID):
  - Per-device push subscription API: create (upsert by endpoint) and
    delete, authenticated under the session cookie; subscriptions are NOT
    sync entities (no change-log, no pull/push).
  - The subscription record carries the device timezone (IANA name,
    reported by the client); reminder pushes are sent at 10:00 local time
    of each subscriber.
  - Server-side reminder dispatch job: for every live plan with
    `reminder != off`, one notification per occurrence (`day_before` fires
    the day before, `on_day` on the due day) to ALL registered devices of
    ALL members of the household owning the plan (household parity).
    Manual plans say "пора подтвердить", auto plans say "сегодня
    спишется <сумма>". No catch-up pushes for long-overdue occurrences.
  - Subscriptions are pruned when the push service reports them gone
    (410/404).
- **Service worker** gains a push handler that displays the notification
  and a notificationclick handler that opens the app at the plan confirm
  flow; the no-runtime-caching posture is untouched.
- **Dashboard "attention card"**: overdue plans plus plans due today or
  tomorrow, with a one-tap confirm action; hidden when empty. It is an
  action surface, not a forecast.
- **Device opt-in UX**: the notification permission prompt is requested
  only when the app runs standalone (installed PWA); in a regular tab the
  UI shows an "add to home screen" hint instead. An unobtrusive "enable
  reminders on this device" entry appears on the plans screen and in the
  attention card whenever the household has plans with reminders enabled
  but this device has no subscription. No prompts on app open.
- **ADR-0007** records the push architecture (per-device subscriptions
  without sync, dispatch semantics, subscription lifecycle threat model);
  the "PWA background sync and push notifications are deferred" entry is
  pruned from `docs/assumptions.md` in this change.

The `planned-payments` domain, the sync protocol, and the mobile app are
deliberately untouched; the reminder setting stays household state on the
plan, and confirm amounts remain editable in the confirm dialog (covering
plans whose real amount varies, e.g. utilities).

## Capabilities

### New Capabilities

- `web-push`: the Web Push channel for planned payment reminders -
  subscription lifecycle API and client behavior, dispatch semantics
  (timing, recipients, content, no catch-up), and notification
  interaction.

### Modified Capabilities

- `web-pwa`: the service worker gains push event handling and
  notification display/click routing (new requirements; existing
  requirements unchanged).
- `web-screens`: the dashboard gains the overdue-and-due attention card
  (hidden when empty), and the plans screen and attention card gain the
  device-level "enable reminders" entry with the standalone install hint.

## Impact

- `docs/api/openapi.yaml`: new push-subscription endpoints and schemas;
  regenerations (`make gen`, `pnpm gen:api`) and drift gates.
- `backend/`: new push-subscription domain entity + storage, dispatch job
  (alongside `plannedconfirm`), VAPID key config, subscription pruning;
  e2e coverage.
- `apps/web/`: service worker push/notificationclick handlers,
  subscription client (upsert on open, tz reporting), permission UX with
  standalone guard, dashboard attention card, plans-screen opt-in row.
- `packages/api`: regenerated types.
- `docs/adr/0004-*`, `docs/assumptions.md` (prune the deferral entry).
- No changes: `openspec/specs/planned-payments`, `sync-protocol`,
  `apps/mobile/`, money/timestamp/ID invariants.
