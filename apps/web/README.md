# Trata web

Vue 3 + Vite client of the Trata expense tracker: an installable, local-first
PWA (offline SQLite over OPFS, service-worker app shell) built with
Feature-Sliced Design, Tailwind CSS v4 on shared design tokens
(`@trata/tokens`), vue-i18n (ru default, en), and generated API
types from `@trata/api` (OpenAPI is the contract source of truth).

Read `AGENTS.md` in this directory before changing code, and
`docs/ARCHITECTURE.md` for the FSD layout. Root `README.md` covers the whole
monorepo.

## Commands

```bash
pnpm dev            # dev server on :5173 (proxies /api to :8080)
pnpm build          # type-check + production build
pnpm preview        # serve the production build on :4173

pnpm test:unit      # Vitest unit tests
pnpm test:coverage  # unit tests with v8 coverage report
pnpm test:e2e       # Playwright e2e (auto-starts the dev server)
pnpm test:e2e:pwa   # Playwright against the built PWA (service worker)

pnpm lint           # oxlint + eslint
pnpm lint:fsd       # steiger (FSD layer rules)
pnpm lint:design    # design-system guard tests
pnpm i18n:lint      # strict i18n usage check
pnpm gen:api        # regenerate the API schema after an OpenAPI change
```

## Notes

- E2E runs need the backend on `:8080` only for sync-specific specs; most
  suites are backendless (anonymous local mode, fresh profile per test).
  WebKit is excluded from local projects: Playwright's bundled WebKit has no
  OPFS, which the local-first core requires.
- Icons come from lucide (`@lucide/vue`); category identity is an emoji on a
  pre-paired pastel color, defined in `src/entities/category/config/`.
- The service worker is a custom Workbox `injectManifest` build (`src/sw.ts`):
  app-shell precache only, no runtime caching, prompted updates.
