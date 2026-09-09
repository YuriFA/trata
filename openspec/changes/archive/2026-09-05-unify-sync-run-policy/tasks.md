## 1. Package: run-policy module (nothing consumes it yet)

- [x] 1.1 Create `packages/local-data/src/sync/run-policy.ts`: `createSyncRunPolicy` per design D3 (adapter surface: `engine`, `isAuthenticated`, `onSessionBoundary`, `onLocalMutation`, `ensureHouseholdCurrent?`, `invalidateKeys`; returns `{ runNow(), dispose() }`); owns the 2 500 ms debounce, gate order authenticated → household-current → run, resume-on-auth, and the invalidation rule (`['sync']` always, entity roots only when `wroteLocalData`), per D4/D6
- [x] 1.2 Move `LOCAL_DATA_QUERY_KEY_ROOTS` (six entity roots) into `run-policy.ts`; re-export `createSyncRunPolicy` and the roots from the package index
- [x] 1.3 Package tests (`run-policy.test.ts`, fake engine + fake adapters + fake timers, per design D4): debounce coalesces N mutations into one run; a new mutation after a completed run schedules a new one; unauthenticated boundary → no run; auth flip → `resume()` → `ensureHouseholdCurrent()` → `run()`; pending resolver parks runs; rejecting resolver skips the run (never runs un-gated) and retries at the next boundary; `wroteLocalData=true` → `['sync']` + 6 roots, `false` → only `['sync']`; `dispose()` cancels timers and subscriptions
- [x] 1.4 Document the run-policy surface in `packages/local-data/README.md` next to the ownership-gate entry; run `pnpm --filter @trata/local-data type-check && test`

## 2. Web: thin adapter over the policy

- [x] 2.1 Rewrite `apps/web/src/shared/lib/local-db/sync-composable.ts` as the adapter: visibilitychange/online → `onSessionBoundary`, the colada success-count watch → `onLocalMutation`, pinia auth state → `isAuthenticated`, AppShell's `ensureHouseholdCurrent` injection unchanged, `invalidateKeys` → vue-query invalidation; delete the inline debounce, gate logic, key-root copy, and `onSyncRunComplete` fan-out wiring that the policy now owns
- [x] 2.2 Point the web entity model composables at `LOCAL_DATA_QUERY_KEY_ROOTS` from `@trata/local-data`; remove the local constant and its "Keep in sync" comment
- [x] 2.3 Verify web: boundary runs (visibility/online/auth flip) now wait for the household gate; manual refresh stays ungated; no screen-flicker regression (`wroteLocalData` contract intact); `pnpm --filter web type-check && test` (and `lint:design` if UI files moved)

## 3. Mobile: thin adapter + guard absorption

- [x] 3.1 Rewrite the `SyncProvider` policy block in `apps/mobile/src/app/_layout.tsx` as the adapter: AppState/NetInfo → `onSessionBoundary`, react-query `mutationCache.subscribe` → `onLocalMutation`, auth context → `isAuthenticated`, `invalidateKeys` → react-query invalidation; delete the inline debounce, `LOCAL_DATA_QUERY_KEY_ROOTS` copy, and auth-flip effect
- [x] 3.2 Absorb `HouseholdRebaseGuard` per design D5: its `checkHousehold` becomes the `ensureHouseholdCurrent` resolver (carry/clean Alert stays in `use-household-join`); delete the guard component, its second AppState listener, and the "slipping in before the choice is acceptable" header comment
- [x] 3.3 Point the mobile entity hooks at the shared roots; remove the local constant
- [x] 3.4 Verify mobile: the first run after auth no longer slips past the household choice; foreground is a gated boundary; headless background fetch untouched (design Non-Goal); `pnpm --filter mobile type-check && test`

## 4. Wrap-up

- [x] 4.1 Full workspace gates: `pnpm -r type-check`, `pnpm -r test` (or per-workspace equivalents), `pnpm arch:check` (package purity — no query-core/colada imports), `pnpm knip` (new exports consumed), `pnpm sync-catalog:gen-check` untouched
- [x] 4.2 Record the two known follow-ups in `docs/technical-debt.md`: the mobile headless background fetch remains without a household check; web `completeAuthentication` still uses the RPC pair instead of `adoptUnowned`
- [x] 4.3 Re-read the household spec delta against the implemented behavior and confirm every scenario (household changed on another device / runs within a session / check cannot complete) is exercised by the package tests or an app-level test
