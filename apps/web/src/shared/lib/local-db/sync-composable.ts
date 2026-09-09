// The sync controller adapter: the run-policy (@trata/local-data)
// owns WHEN the engine runs - the post-mutation debounce, the gate order
// (authenticated → household-current → run), and the post-cycle
// invalidation; this main-thread composable only adapts platform sources
// (visibility, reconnect, the colada mutation watch, pinia auth), publishes
// the engine state over the RPC `subscribe`, and exposes `runNow`.
//
// FSD placement: shared/lib must not import entities, so the app layer
// injects the auth getter and the household resolver
// (`provideSyncController({ isAuthenticated, ensureHouseholdCurrent })` in
// AppShell); widgets/features consume the controller via `useSyncController`.

import { onScopeDispose, provide, inject, ref, watch, type InjectionKey, type Ref } from 'vue'
import { proxy } from 'comlink'
import { useMutationCache, useQueryCache, type EntryKey } from '@pinia/colada'
import { createSyncRunPolicy, type SyncEngineState } from '@trata/local-data'
import { getLocalDbApi, onSyncRunComplete } from '@/shared/lib/local-db'

interface SyncControllerOptions {
  /** Auth gate supplied by the app layer: sync runs only while true. */
  isAuthenticated: () => boolean
  /**
   * Household gate (household-join design D7), injected by the app layer
   * because shared/lib must not import entities: resolves once the local
   * bookkeeping matches the server-reported household (a stale second device
   * picks the carry/clean choice first through the pending dialog). Rejects
   * when the check cannot complete (offline) - the policy then SKIPS the run
   * instead of synchronizing without the check.
   */
  ensureHouseholdCurrent?: () => Promise<void>
}

export interface SyncController {
  engineState: Readonly<Ref<SyncEngineState>>
  /** Manual refresh: bypasses backoff and runs a full cycle now. */
  runNow(force?: boolean): void
  /** Whether the global conflict center dialog is open (the badge toggles it). */
  conflictsOpen: Ref<boolean>
}

const SYNC_CONTROLLER_KEY: InjectionKey<SyncController> = Symbol('sync-controller')

/** Creates the app's single sync controller and provides it down the tree. */
export function provideSyncController(options: SyncControllerOptions): SyncController {
  const queryCache = useQueryCache()
  const mutationCache = useMutationCache()

  const engineState = ref<SyncEngineState>({ running: false, paused: false, lastRunAt: null })
  const conflictsOpen = ref(false)

  const policy = createSyncRunPolicy({
    // The engine lives in the local-db worker behind the Comlink bridge whose
    // signature is run(force?) - normalize to the policy's options object.
    engine: {
      run: (runOptions) => getLocalDbApi().then((api) => api.sync.run(runOptions?.force === true)),
      resume: () => {
        void getLocalDbApi().then((api) => api.sync.resume())
      },
    },
    isAuthenticated: options.isAuthenticated,
    ensureHouseholdCurrent: options.ensureHouseholdCurrent,
    invalidateKeys: (keys) => {
      for (const key of keys) {
        void queryCache.invalidateQueries({ key: [...key] as EntryKey })
      }
    },
    onRunComplete: (cb) => onSyncRunComplete((wroteLocalData) => cb({ wroteLocalData })),
  })

  // Auth watch with `immediate` also carries the restored-session startup
  // into the policy (login resumes + kicks the engine; anonymous never runs).
  const stopAuthWatch = watch(
    options.isAuthenticated,
    (authenticated) => policy.notifyAuthChange(authenticated),
    { immediate: true },
  )

  // Foreground / reconnect session boundaries.
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') policy.notifySessionBoundary()
  }
  function onOnline() {
    policy.notifySessionBoundary()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)

  // A successfully settled colada mutation means local data changed. Bridges
  // the mutation cache (an external store) into the policy, hence a watch.
  // Pinia unwraps the state ref, so `caches` is the reactive Map itself.
  const stopMutationWatch = watch(
    () => {
      let successful = 0
      for (const entry of mutationCache.caches.values()) {
        if (entry.state.value.status === 'success') successful += 1
      }
      return successful
    },
    (successful, previous) => {
      if (successful > (previous ?? 0)) policy.notifyLocalMutation()
    },
  )

  // Engine state over the RPC bridge: Comlink delivers the listener as a
  // proxy, so each notification pulls the fresh snapshot.
  const cleanups: Array<() => void> = [
    stopAuthWatch,
    stopMutationWatch,
    policy.dispose,
    () => document.removeEventListener('visibilitychange', onVisibilityChange),
    () => window.removeEventListener('online', onOnline),
  ]

  let disposed = false
  void getLocalDbApi().then(async (api) => {
    const unsubscribe = await api.sync.subscribe(
      proxy(() => {
        void api.sync.getState().then((state) => {
          engineState.value = state
        })
      }),
    )
    if (disposed) {
      void unsubscribe()
      return
    }
    engineState.value = await api.sync.getState()
    cleanups.push(() => void unsubscribe())
  })

  // AppShell hosts the controller for the app's whole lifetime, but stay
  // correct if the hosting scope is ever disposed: flagging first lets the
  // pending subscription unsubscribe itself instead of leaking.
  onScopeDispose(() => {
    disposed = true
    for (const cleanup of cleanups) cleanup()
  })

  const controller: SyncController = {
    engineState,
    runNow: (force = false) => policy.runNow(force),
    conflictsOpen,
  }
  provide(SYNC_CONTROLLER_KEY, controller)
  return controller
}

/** Injects the app's sync controller; throws when the provider is missing. */
export function useSyncController(): SyncController {
  const controller = inject(SYNC_CONTROLLER_KEY)
  if (!controller) {
    throw new Error('useSyncController requires provideSyncController in AppShell')
  }
  return controller
}
