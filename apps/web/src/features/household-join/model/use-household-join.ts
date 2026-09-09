// The shared "join data choice" flow (household-join design D6), used by
// every path that lands the device in a NEW household: invitation accept,
// join-by-code, leave, and the second-device startup mismatch (D7). Whatever
// made the change, the local bookkeeping must follow before the sync engine
// runs as the new household:
//
// - carry: the worker-side rebase resets versions/cursor and regenerates the
//   outbox as base-0 creates (it also stores the last_household marker, D4);
// - clean: `wipeLocalData` + re-bind the owner + stamp last_household.
//
// Both paths then invalidate every cached query and run the engine. The
// choice itself comes either from the caller (the invite page renders it
// inline - no second dialog) or from the globally mounted
// HouseholdChoiceDialog (join-by-code / leave / startup), which parks the
// decision in `pending` until a button is picked. The dialog is deliberately
// non-dismissable: the membership has already changed server-side, so local
// data MUST be rebased or wiped either way.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useQueryCache } from '@pinia/colada'
import type { Household } from '@trata/api'
import i18n from '@/shared/i18n'
import { getLocalDbApi } from '@/shared/lib/local-db'
import { householdApi } from '@/entities/household'
import { useAuthStore } from '@/entities/session'
import { notification } from '@/shared/services/notification'

export type HouseholdDataChoice = 'carry' | 'clean'

interface PendingHouseholdChoice {
  household: Household
  resolve: () => void
}

export const useHouseholdJoinStore = defineStore('household-join', () => {
  const queryCache = useQueryCache()
  const auth = useAuthStore()

  /** Set while the choice dialog awaits the user's pick. */
  const pending = ref<PendingHouseholdChoice | null>(null)
  const applying = ref(false)

  /** Applies an already-made choice to the local database and sync state. */
  async function applyHouseholdChoice(
    household: Household,
    choice: HouseholdDataChoice,
  ): Promise<void> {
    const db = await getLocalDbApi()
    if (choice === 'carry') {
      // The rebase itself stamps the last_household marker (design D4).
      await db.household.rebase(household.id)
    } else {
      // The wipe drops the marker (and the owner binding) - restamp both.
      await db.meta.wipeLocalData()
      const userId = auth.user?.id
      if (userId) await db.meta.setOwnerUserId(userId)
      await db.household.setLastHousehold(household.id)
    }
    // Run FIRST, invalidate LAST: the pulled household data must be on the
    // device before cached queries refetch, or they serve the pre-sync set.
    await db.sync.run()
    await queryCache.invalidateQueries()
  }

  /**
   * Opens the non-dismissable choice dialog (carry preselected) and resolves
   * once the chosen path has been applied and the engine has run.
   */
  function chooseHouseholdData(household: Household): Promise<void> {
    return new Promise((resolve) => {
      pending.value = { household, resolve }
    })
  }

  /** The dialog's button handler: applies the pick and releases the waiter. */
  async function confirmChoice(choice: HouseholdDataChoice): Promise<void> {
    const current = pending.value
    if (!current || applying.value) return
    applying.value = true
    try {
      await applyHouseholdChoice(current.household, choice)
      pending.value = null
      current.resolve()
    } catch (error) {
      // The dialog stays up: local data still must be rebased or wiped.
      notification.mutationError(error, {
        title: i18n.global.t('household.choice.title'),
        feature: 'household',
        action: 'apply-join-choice',
      })
    } finally {
      applying.value = false
    }
  }

  /**
   * The startup/login household gate (design D7): compares the
   * server-reported household against the local last_household marker. A
   * null (fresh/legacy) or matching marker is stamped and left alone; a
   * mismatch means this device still holds the OLD household's bookkeeping -
   * hold for the carry/clean choice before the engine runs as the new
   * household. Rejects when the check cannot complete (offline / the
   * household fetch fails): the run-policy then skips the pending sync run
   * and retries at the next session boundary - it never runs un-gated.
   */
  async function ensureCurrentHousehold(): Promise<void> {
    const household = await householdApi.getHousehold()
    const db = await getLocalDbApi()
    const last = await db.household.getLastHousehold()
    if (last === null || last === household.id) {
      await db.household.setLastHousehold(household.id)
      return
    }
    await chooseHouseholdData(household)
  }

  return {
    pending,
    applying,
    applyHouseholdChoice,
    chooseHouseholdData,
    confirmChoice,
    ensureCurrentHousehold,
  }
})
