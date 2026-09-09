// The cashflow sheets' authorship context (household-ux 2.4): the household
// members cache + the current user's id, resolved once per container and
// threaded into the grouping selectors. Auth-free while anonymous (markers
// simply don't resolve) - the same gating the settings section uses.

import { useMemo } from 'react'
import type { HouseholdMember } from '@trata/api'
import { useHousehold } from '@/entities/household'
import { useAuth } from '@/entities/session'
import type { CashflowAuthorContext } from './selectors'

const NO_MEMBERS: HouseholdMember[] = []

export function useCashflowAuthor(): CashflowAuthorContext | undefined {
  const { status, user } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const members = householdQuery.data?.members
  // Stable identity across renders so downstream useMemos keep working.
  return useMemo(
    () =>
      status === 'authenticated'
        ? { members: members ?? NO_MEMBERS, currentUserId: user?.id }
        : undefined,
    [status, members, user?.id],
  )
}
