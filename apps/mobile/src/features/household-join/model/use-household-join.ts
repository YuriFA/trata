// The shared "join data choice" flow (household-join design D6), used by
// every path that lands the device in a NEW household: invitation accept,
// join-by-code, leave, and the second-device startup/foreground mismatch
// (D7). Whatever made the change, the local bookkeeping must follow before
// the sync engine runs as the new household:
//
// - carry: `rebaseLocalDataForHousehold` resets versions/cursor and
//   regenerates the outbox as base-0 creates (also stores last_household);
// - clean: `wipeLocalData` + re-bind the owner + stamp last_household.
//
// The choice itself comes either from the caller (the invite screen renders
// it inline - no second dialog) or from the non-cancelable Alert below
// (join-by-code / leave / startup, where no prior screen asked).
// `useEnsureCurrentHousehold` is the same check as the sync run-policy's
// household gate: it resolves once the marker matches the server household.

import { useCallback, useMemo } from 'react'
import { Alert } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { Household } from '@trata/api'
import {
  householdNeedsRebase,
  rebaseLocalDataForHousehold,
  setLastHousehold,
  setOwnerUserId,
  wipeLocalData,
  type LocalDatabase,
} from '@trata/local-data'
import { householdApi } from '@/entities/household'
import { useAuth } from '@/entities/session'
import { useLocalDatabase } from '@/shared/lib/db/database-context'
import { useSyncController } from '@/shared/lib/sync/sync-context'

export type HouseholdDataChoice = 'carry' | 'clean'

/** Applies the picked path to the local database bookkeeping. */
function applyHouseholdChoice(
  db: LocalDatabase,
  household: Household,
  choice: HouseholdDataChoice,
  userId: string | undefined,
): void {
  if (choice === 'carry') {
    // The rebase itself stamps the last_household marker (design D4).
    rebaseLocalDataForHousehold(db, household.id)
  } else {
    // The wipe drops the marker (and the owner binding) - restamp both.
    wipeLocalData(db)
    if (userId) setOwnerUserId(db, userId)
    setLastHousehold(db, household.id)
  }
}

/** The non-cancelable choice Alert; resolves once `apply` has settled. */
function chooseViaAlert(
  household: Household,
  apply: (choice: HouseholdDataChoice) => Promise<void>,
): Promise<void> {
  // TODO(i18n): RU wording until mobile i18n wiring lands.
  return new Promise((resolve) => {
    Alert.alert(
      'Новое домохозяйство',
      'Домохозяйство изменилось. Что сделать с данными на этом устройстве?',
      [
        {
          text: 'Перенести данные',
          onPress: () => {
            void apply('carry').then(resolve, resolve)
          },
        },
        {
          text: 'Начать с чистого листа',
          style: 'destructive',
          onPress: () => {
            void apply('clean').then(resolve, resolve)
          },
        },
      ],
      { cancelable: false },
    )
  })
}

export interface HouseholdJoinController {
  /** Applies an already-made choice to the local database and sync state. */
  performHouseholdJoin(household: Household, choice: HouseholdDataChoice): Promise<void>
  /**
   * Asks the user through a non-cancelable Alert (carry first) and applies
   * the chosen path. Resolves once the choice has been applied.
   */
  chooseHouseholdData(household: Household): Promise<void>
}

export function useHouseholdJoin(): HouseholdJoinController {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  const { runNow } = useSyncController()
  const { user } = useAuth()

  const performHouseholdJoin = useCallback(
    async (household: Household, choice: HouseholdDataChoice) => {
      applyHouseholdChoice(db, household, choice, user?.id)
      // Run FIRST, invalidate LAST: the pulled household data must be on the
      // device before cached queries refetch, or they serve the pre-sync set.
      await runNow()
      await queryClient.invalidateQueries()
    },
    [db, queryClient, runNow, user],
  )

  const chooseHouseholdData = useCallback(
    (household: Household) =>
      chooseViaAlert(household, (choice) => performHouseholdJoin(household, choice)),
    [performHouseholdJoin],
  )

  return useMemo(
    () => ({ performHouseholdJoin, chooseHouseholdData }),
    [chooseHouseholdData, performHouseholdJoin],
  )
}

/**
 * The sync run-policy's household gate (household-join design D7): resolves
 * once the local last_household marker matches the server-reported
 * household; on a mismatch it holds for the carry/clean Alert. No runNow
 * here - the gated run that awaited this resolver continues right after it
 * resolves. Rejects when the check cannot complete (offline / backend
 * unavailable): the policy then skips the pending run and retries at the
 * next session boundary - it never runs un-gated.
 */
export function useEnsureCurrentHousehold(): () => Promise<void> {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useCallback(async () => {
    const household = await householdApi.getHousehold()
    if (!householdNeedsRebase(db, household.id)) {
      // First run after the upgrade (null marker) or the current household.
      setLastHousehold(db, household.id)
      return
    }
    await chooseViaAlert(household, async (choice) => {
      applyHouseholdChoice(db, household, choice, user?.id)
      await queryClient.invalidateQueries()
    })
  }, [db, queryClient, user])
}
