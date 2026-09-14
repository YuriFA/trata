import { useMutation, useQueryCache } from '@pinia/colada'
import type { CurrencyCode } from '@trata/money'
import { householdApi } from '../api/household-api'

/**
 * The household management mutation set (household-ux design D1): typed
 * actions over the control-plane API, each invalidating the household caches
 * (the `['household']` key also prefix-matches `['household',
 * 'invitations']`) on settle so the section reflects the server's answer. No
 * dedicated store - the query cache plus these mutations are the whole state.
 */
export function useHouseholdActions() {
  const queryCache = useQueryCache()

  const invalidate = () => {
    queryCache.invalidateQueries({ key: ['household'] })
  }

  const rename = useMutation({
    mutation: (name: string | null) => householdApi.rename(name),
    onSettled: invalidate,
  })

  const setBaseCurrency = useMutation({
    mutation: (currency: CurrencyCode) => householdApi.setBaseCurrency(currency),
    onSettled: invalidate,
  })

  const updateDisplayName = useMutation({
    mutation: (displayName: string) => householdApi.updateDisplayName(displayName),
    onSettled: invalidate,
  })

  const invite = useMutation({
    mutation: (email: string) => householdApi.invite(email),
    onSettled: invalidate,
  })

  const revokeInvitation = useMutation({
    mutation: (invitationId: string) => householdApi.revokeInvitation(invitationId),
    onSettled: invalidate,
  })

  const generateCode = useMutation({
    mutation: () => householdApi.generateCode(),
    onSettled: invalidate,
  })

  const revokeCode = useMutation({
    mutation: () => householdApi.revokeCode(),
    onSettled: invalidate,
  })

  const removeMember = useMutation({
    mutation: (userId: string) => householdApi.removeMember(userId),
    onSettled: invalidate,
  })

  const dissolve = useMutation({
    mutation: () => householdApi.dissolve(),
    onSettled: invalidate,
  })

  return {
    rename,
    setBaseCurrency,
    updateDisplayName,
    invite,
    revokeInvitation,
    generateCode,
    revokeCode,
    removeMember,
    dissolve,
  }
}
