// Opportunistic background sync (design D7's triggers, OS-scheduled): an
// expo-background-fetch task runs one engine cycle against the same local
// database and API client the foreground app uses. Correctness never depends
// on it (sync-protocol spec) - the foreground triggers stay primary, so a
// denied, restricted, or never-fired task costs nothing. The engine is
// single-flight across instances, so a background run while the app is
// foregrounded coalesces with the in-flight run instead of racing it.

import * as BackgroundFetch from 'expo-background-fetch'
import * as TaskManager from 'expo-task-manager'
import { randomUUID } from 'expo-crypto'
import { apiClient } from '@/shared/api/client'
import { openLocalDatabase } from '@/shared/lib/db/database'
import {
  configureIdFactory,
  createApiTransport,
  createSyncEngine,
  getOwnerUserId,
} from '@trata/local-data'

// Headless task runs may skip the app entry, so this module binds the id
// factory itself (idempotent, same as the _layout bootstrap).
configureIdFactory(randomUUID)

/** Task name shared by TaskManager.defineTask and registerTaskAsync. */
export const BACKGROUND_SYNC_TASK = 'background-sync'

/** Advisory minimum seconds between OS-scheduled runs (both platforms). */
const MINIMUM_INTERVAL_SECONDS = 15 * 60

async function runBackgroundSync(): Promise<BackgroundFetch.BackgroundFetchResult> {
  const db = await openLocalDatabase()

  // Anonymous device: the engine only runs while authenticated, so there is
  // nothing to push or pull - report NoData without touching the network.
  if (getOwnerUserId(db) === null) {
    return BackgroundFetch.BackgroundFetchResult.NoData
  }

  const engine = createSyncEngine({
    db,
    transport: createApiTransport(apiClient),
    // No TanStack Query cache exists headlessly; the next foreground run
    // invalidates after its own cycle (the engine reports every completed
    // run), so the UI catches up as soon as it is visible again.
  })
  const outcome = await engine.run()
  if (outcome.pushed > 0 || outcome.pulled > 0) {
    return BackgroundFetch.BackgroundFetchResult.NewData
  }
  return BackgroundFetch.BackgroundFetchResult.NoData
}

let registrationStarted = false

/**
 * Defines + registers the background-fetch task. Idempotent (safe on every
 * provider mount / fast-refresh); registration failures only warn - a denied
 * or unavailable status must not affect the foreground sync triggers.
 */
export function registerBackgroundSync(): void {
  if (registrationStarted) return
  registrationStarted = true

  if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
    TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
      try {
        return await runBackgroundSync()
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed
      }
    })
  }

  void BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: MINIMUM_INTERVAL_SECONDS,
    stopOnTerminate: false,
  }).catch((error: unknown) => {
    console.warn('[sync] background fetch registration failed:', error)
  })
}
