# Assumptions & Open Decisions

Two different kinds of entries live here, kept strictly separate:

- **Assumption** — what we currently rely on that is not backed by a decided
  target architecture; implementation undefined. Do not treat it as
  implemented, do not build on it as if it were a requirement, and do not
  invent the missing behavior.
- **Decided direction (implementation pending)** — accepted target
  architecture whose implementation has not landed. The decision itself is
  recorded either in a cited canonical doc (ADR / invariant / spec) or in
  the entry itself, where the entry is explicitly marked as the canonical
  record; this file also tracks that it is pending. When one becomes real
  work, record it in the OpenSpec change that implements it and prune it
  here. If a decided direction grows cross-cutting or its rationale needs
  preserving, promote it to an ADR — this file must not become a second
  ADR system.

Only behavior confirmed by code or by authoritative documentation (OpenAPI
spec, ADRs, invariants, openspec specs) is established.

## Assumptions

- **Deployment is single-replica** (accepted constraint, decided
  2026-08-20). The backend runs as one replica, which makes the in-memory
  per-IP rate limiter (`middleware/ratelimit.go`) sufficient. Revisit
  (distributed or proxy-level limiting) before ever scaling horizontally.
- **OAuth (Google/VK/Yandex)** is planned.

## Decided directions (implementation pending)

- **Web migrates onto `@expense-tracker/dates`** as the canonical date
  layer — decided 2026-08-20; the app-local `@internationalized/date`
  adapter is the sanctioned temporary exception (invariant #14). Extend
  the package when web needs more; don't grow a permanent parallel adapter.
- **Periodic Background Sync remains deferred; Web Push is decided**
  (push un-deferred 2026-09-06, change `web-push-planned-payment-reminders`,
  ADR-0007). The shipped PWA posture stays settled and spec'd
  (`openspec/specs/web-pwa`): an app-shell-only service worker with
  prompted updates (never auto-reload) and NO runtime caching — API
  responses are never served from cache; offline behavior comes from the
  local-first data layer. Web Push reminder delivery is implemented per
  ADR-0007; Periodic Background Sync remains possible future work.
- **Mobile i18n wiring** — react-i18next over the shared
  `@expense-tracker/i18n` bundle with mobile-local wiring (mobile already
  consumes api/dates/money/tokens); RU strings stay hardcoded with
  `TODO(i18n)` markers until the wiring lands. This entry is the
  canonical record of the decision.
- **Multi-currency direction** — decided 2026-08-28 (change
  `currency-rub-only`); this entry is the canonical record until the
  implementing change lands. Both apps are ruble-only over a
  multi-currency-ready contract (`openspec/specs/app-currency`); no
  exchange rates exist, and currency-less aggregates (debts, plans,
  analytics totals) are plain minor-unit sums. The decided direction:
  transfers carry two amounts (one per account currency) plus a
  snapshot of the exchange rate used; aggregates are computed per
  currency and converted into a single display currency for
  presentation. Rates are sourced externally; the rate source and its
  storage/precision model are undecided. Whether debts and planned
  payments stay currency-less or gain a currency of their own is an
  open question. The undecided points belong to the implementing
  change (with its own ADR if the rationale needs preserving).
