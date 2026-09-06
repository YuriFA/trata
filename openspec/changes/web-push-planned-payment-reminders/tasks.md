# Tasks: Web Push reminders for planned payments

## 1. Contract first

- [x] 1.1 Extend `docs/api/openapi.yaml`: `POST /api/push/subscriptions` (create/upsert by endpoint; body `endpoint`, `keys{p256dh,auth}`, `timeZone` IANA), `DELETE /api/push/subscriptions/{endpointId}`, `GET /api/config/push` (public VAPID key, authenticated), response schemas and error codes per house conventions; lint with redocly
- [x] 1.2 Regenerate: `make gen` (backend) and `pnpm gen:api` (packages/api), commit both; drift gates green

## 2. Backend: storage and endpoints

- [x] 2.1 Migration: `push_subscriptions` table (`id` uuid pk, `user_id` fk, `endpoint` text unique not null, `p256dh`, `auth`, `time_zone` text, timestamps) and `push_reminders_sent` (`plan_id`, `occurrence_date`, `subscription_id`, `sent_at`, unique on the triple); sqlc queries (upsert-by-endpoint, delete-by-id, list-by-household-members, insert/delete sent markers)
- [x] 2.2 Domain type + repository for push subscriptions (no soft delete, no version, no change-log - plain CRUD, per design D1); unit tests for validation (endpoint URL shape, IANA tz name)
- [x] 2.3 Handler + routing: POST/DELETE under session auth and the ADR-0001 CSRF posture (same middleware allowlist treatment as other mutations); upsert semantics (same endpoint refreshes keys/tz); anonymous rejected; e2e tests: create, upsert, delete, not-found, auth-rejected; verify no change-log entries appear in sync pull
- [x] 2.4 `GET /api/config/push` returning the VAPID public key from env; e2e test

## 3. Backend: dispatch job

- [x] 3.1 Pick and vendor the Web Push sending library (maintained Go Web Push/VAPID implementation); wrap it behind a small `Sender` interface so tests use a fake; VAPID keys from config (`PUSH_VAPID_PRIVATE_KEY`/`_PUBLIC_KEY`, `PUSH_REMIND_INTERVAL` default 1m); empty keys = job logs a warning and no-ops (env-gated deploy safety)
- [x] 3.2 `pushremind` job (design D3): minute-tick scan `(last, now]`; for each live plan with reminder != off, per distinct subscription tz compute the 10:00-local reminder instant (day_before = due-1, on_day = due date, `time/tzdata` embedded); skip passed instants; auto plans whose occurrence was already executed (next_due advanced past today) skip the on_day push; send once per occurrence+subscription guarded by the sent-marker table; payload `{planId, planName, kind, amountMinor}`
- [x] 3.3 Recipients join: plans -> household -> members -> their subscriptions (household parity, all members); unit tests: multi-member delivery, one-push-per-occurrence-per-subscription across restarts (marker durability), no catch-up when the window was missed, deleted plans skipped
- [x] 3.4 Pruning (design D8): push-service 404/410 deletes the subscription in the same transaction; 429/5xx leaves no marker (retried next tick); unit tests with the fake sender
- [x] 3.5 Wire the job in `cmd/expense-tracker-api/main.go` alongside plannedconfirm; config plumbing + README/env docs

## 4. Docs: decision records

- [x] 4.1 Write `docs/adr/0007-web-push-reminders.md`: per-device subscriptions without sync, household-parity recipients, tz-on-subscription, reminder-only channel, threat model (endpoint as bearer capability, VAPID key handling/rotation, auth-gated subscription management, no cross-household leak), relation to ADR-0001/0002
- [x] 4.2 Prune the "PWA background sync and push notifications are deferred" entry in `docs/assumptions.md` (push un-deferred via ADR-0007; background sync stays deferred)

## 5. Web: service worker

- [x] 5.1 Add `push` handler to the existing SW: parse payload, display notification (plan name + default amount, manual vs auto copy per i18n); no caching of API responses introduced
- [x] 5.2 Add `notificationclick` handler: focus existing window + postMessage navigate to `/plans?confirm=<planId>`, else `clients.openWindow` at that route; never reload an open window
- [x] 5.3 SW tests for both handlers (payload parsing, focus-vs-open, no cache API usage)

## 6. Web: subscription client and opt-in

- [x] 6.1 `usePushSubscription` composable: current state (permission, standalone, subscribed), re-registration on app open after auth when permission already granted (upsert POST with device tz), subscribe flow for the opt-in entry (standalone check via display-mode media query + iOS legacy flag, requestPermission, pushManager.subscribe with public key from `GET /api/config/push`, POST)
- [x] 6.2 Opt-in entry UI: unobtrusive row on the plans screen and in the attention card footer, visible only when the household has a live plan with reminder != off AND this device has no subscription; in a non-standalone tab it shows the install hint and never calls requestPermission; enabling a reminder in the plan form routes through the same helper; no prompts on app open/navigation; unit tests for visibility rules and standalone gating
- [x] 6.3 i18n keys (en + ru) for reminder copy, opt-in row, install hint, notification title/body; `pnpm --filter web type-check` and locale parity green

## 7. Web: dashboard attention card

- [x] 7.1 `PlannedPaymentsAttentionCard` widget: overdue + due today/tomorrow from the existing planned-payments query, overdue first, each row opens the existing confirm dialog (amount editable), card hidden entirely when empty, not month-scoped; embeds the opt-in footer per 6.2 rules
- [x] 7.2 Confirm-flow deep link: `/plans?confirm=<planId>` opens the confirm dialog (used by notification click); plans page + tests
- [x] 7.3 Dashboard integration + component tests: visibility scenarios (overdue, due tomorrow, empty hidden), period navigation does not affect the card, confirm advances the plan per planned-payments capability

## 8. Gates

- [x] 8.1 Backend: `make gen-check`, golangci-lint, unit + e2e suites green
- [x] 8.2 Web: `pnpm --filter web type-check`, unit tests, `pnpm arch:check`, `pnpm lint:design`, `pnpm knip` green
- [ ] 8.3 Manual E2E pass against a real push service (VAPID keys in dev env): subscribe from installed PWA, receive a day_before reminder at 10:00 local, click -> confirm with adjusted amount, verify single delivery and 410 pruning; verify regular-tab flow shows the install hint
