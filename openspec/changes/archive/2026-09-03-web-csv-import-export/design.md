# Design: web CSV import/export

## Context

No import/export exists anywhere in the repo (greenfield; nothing CSV- or
spreadsheet-related installed). The web app is local-first: every write
goes through the worker-side `@trata/local-data` repositories
(atomic row + outbox operation), and the sync engine pushes queued
operations in batches of 50 with idempotent-create semantics (client
supplied id + baseVersion 0). Reads go through the same repositories.
`apps/web/docs/ARCHITECTURE.md` pre-places CSV export as a Fractal-FSD
feature and says a feature used by 2+ pages belongs in global `features/`.

## Goals / Non-Goals

- Goal: spreadsheet round-trip for transactions — export what you see
  (filters) or everything; import from a simple documented template.
- Goal: import is safe by construction: preview, per-row validation,
  auto-created categories are visible before commit, re-import is a no-op.
- Goal: fully client-side; anonymous mode works, data syncs after login.
- Non-goal: XLSX (CSV first; pretty formatting is the spreadsheet's job).
- Non-goal: generic column-mapping wizard or pivot-table parsing — the
  legacy per-day pivot table is converted to the template offline, once.
- Non-goal: exporting/importing accounts or categories as entities
  (categories are auto-created on import by name; accounts are matched by
  name and must exist).
- Non-goal: mobile import/export.

## Decisions

### D1. Client-side only, through the repository seam

Import writes each row via the transaction repository `create` (client
supplied id), categories via the category repository; export reads via the
transaction query. This preserves cache invalidation (queries keyed
`['transactions']`, `['categories']`, `['accounts']`), outbox atomicity,
and sync — and requires zero backend/OpenAPI work. No bulk repository
method is added: ~a few hundred rows import fine as per-row writes (each
an atomic SQLite transaction), and the sync engine already batches push.

### D2. Template: flat, RU-locale-friendly CSV

Columns: `дата;тип;категория;сумма;примечание;счёт` — `;`-separated,
decimal comma, dates `DD.MM.YYYY`, type `доход`/`расход` (both locales
accept the English forms too). Rationale: the file is hand-edited in a
RU-locale spreadsheet; matching the export format means an exported file is
re-importable as-is (round-trip). Amount is major units with an optional
sign (income rows take the absolute value; a leading `-` on a расход is
accepted and stored positive — the type carries the direction). Empty
`счёт` → «Без счета». Account names must match an existing account
(case-insensitive); unknown account = row error, not auto-creation
(accounts carry balances; silently creating them is a foot-gun).

### D3. Deterministic ids make re-import idempotent

Each row's id is a UUID derived (SHA-256 of the normalized row key:
date|type|category-name|amount-minor|note, formatted as a v4-shaped uuid)
— stable across imports of the same file. The repository rejects a
duplicate id with `TRANSACTION_ALREADY_EXISTS`, which the import wizard
reports as "skipped (already imported)". Editing a row after import and
re-importing the file skips the original (same id) — the edit survives.
A row changed in the file after import (different note/amount) yields a
different key → a new transaction (the old one stays); this is documented
behavior, not deduplication of content.

### D4. Export format mirrors the import template

One column set for both directions: `дата;тип;категория;счёт;сумма;
примечание` (export orders account before amount for readability; import
accepts columns by header name, not position — see D5). UTF-8 BOM + `;` +
decimal comma so RU Excel opens it without an import wizard. Amounts are
signed by type semantics (доход positive) but written unsigned like the
template; transfers export as `перевод` rows with both accounts in the
`счёт` column (`Наличка → Тинькофф`) and are not importable (the template
has no transfer columns) — they round-trip visually, not structurally.
Adjustments export as `корректировка`. File name:
`transactions_YYYY-MM-DD.csv`.

### D5. Import parses by header names, not positions

Rows map fields by the header row (Russian or English column names), so
column order and extra columns don't matter. A missing header → file-level
error before preview. This costs nothing and makes hand-edited files
robust.

### D6. UX: dialog wizard over a screen-length form

`/settings/data` is a thin screen (settings card pattern) hosting two
actions; the import wizard lives in a `ResponsiveDialog` (the canonical
modal, drawer on mobile) with three states: pick file → preview table →
result summary. The preview table lists every parsed row with its
validation outcome, the categories that will be created (with type), and a
per-row exclude toggle for valid rows. Commit is one button; progress is
the button's loading state; the result is a summary (created X, skipped Y,
rejected Z) plus toasts. No stepper primitive is introduced — plain dialog
content swapping.

### D7. FSD placement

- Export logic (CSV building + download): `features/export-csv/` — global,
  two consumers (transactions screen button, settings screen button) per
  the architecture decision tree.
- Import wizard: `pages/settings/features/import-csv/` — page-local.
- Route `/settings/data` mirrors `/settings/categories`; a settings card
  links to it (anonymous users too — import/export are local-data
  features, not account features).

## Risks / Trade-offs

- *Hand-rolled CSV parser*: no new dependency; the parser handles quotes,
  `;`, CRLF, and BOM (~60 lines, property-tested against export output for
  the round-trip). Papaparse would add a dependency for a format we
  control end-to-end.
- *Large imports*: hundreds of rows are fine (per-row atomic writes);
  tens of thousands would want a bulk repository method — deferred until
  measured.
- *Encoding*: BOM + UTF-8 declared; a file in another encoding fails row
  validation legibly (unreadable dates/amounts) rather than corrupting
  data.

## Migration Plan

None (new feature). The legacy pivot spreadsheet is converted to the
template by a throwaway script outside the app; the converted file imports
through the product feature.

## Open Questions

None — settled in the grilling session: CSV only; filtered export from the
transactions screen + full export from settings; preview + category
auto-creation; one transaction per (day × category) cell for the legacy
table; balance rows of the legacy table are skipped.
