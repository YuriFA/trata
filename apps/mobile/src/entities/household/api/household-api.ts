// Typed wrapper over the generated client for the household control-plane
// (household-join): membership reads and the join/leave lifecycle. Like the
// session API, this is control-plane traffic over the shared apiClient (not
// synced data - the sync engine owns that), so it sits at the same seam
// (dependency-cruiser `api-client-seam`). Errors reject as RepositoryError
// keyed on the backend code (e.g. HOUSEHOLD_CODE_INVALID); RU mapping lives
// in shared/lib/data/repository-errors-ru.

import {
  acceptHouseholdInvitation,
  createHouseholdInvitation,
  dissolveHousehold,
  fetchHousehold,
  generateHouseholdCode,
  joinHouseholdByCode,
  leaveHousehold,
  listHouseholdInvitations,
  previewHouseholdInvitation,
  removeHouseholdMember,
  revokeHouseholdCode,
  revokeHouseholdInvitation,
  updateDisplayName,
  updateHousehold,
} from '@trata/api'
import { apiClient } from '@/shared/api/client'

export const householdApi = {
  /** The signed-in user's household (name + members). */
  getHousehold() {
    return fetchHousehold(apiClient)
  },

  /** Sets or clears the household display name (owner only). */
  rename(name: string | null) {
    return updateHousehold(apiClient, { name })
  },

  /** Sets the current user's display name (the authorship/member label). */
  updateDisplayName(displayName: string) {
    return updateDisplayName(apiClient, displayName)
  },

  /**
   * Invites a member by email (owner only). Re-inviting a pending email
   * refreshes its token/expiry - this is also the "resend" action.
   */
  invite(email: string) {
    return createHouseholdInvitation(apiClient, email)
  },

  /** Lists the household's invitations, freshest first (owner only). */
  listInvitations() {
    return listHouseholdInvitations(apiClient)
  },

  /** Revokes an invitation (owner only); idempotent. */
  revokeInvitation(invitationId: string) {
    return revokeHouseholdInvitation(apiClient, invitationId)
  },

  /** Acceptor-side invitation preview (matching-email accounts only). */
  previewInvitation(token: string) {
    return previewHouseholdInvitation(apiClient, token)
  },

  /** Accepts an invitation; resolves with the joined household. */
  acceptInvitation(token: string) {
    return acceptHouseholdInvitation(apiClient, token)
  },

  /** Generates or rotates the household's join code (owner only). */
  generateCode() {
    return generateHouseholdCode(apiClient)
  },

  /** Revokes the household's join code (owner only); idempotent. */
  revokeCode() {
    return revokeHouseholdCode(apiClient)
  },

  /** Joins the household of an active code; resolves with the joined household. */
  joinByCode(code: string) {
    return joinHouseholdByCode(apiClient, code)
  },

  /**
   * Leaves the household; resolves with the fresh personal household created
   * for the user (household-ux: the local data choice is always clean start -
   * contributions stay with the household per ADR-0002).
   */
  leave() {
    return leaveHousehold(apiClient)
  },

  /** Removes a member from the household (owner only). */
  removeMember(userId: string) {
    return removeHouseholdMember(apiClient, userId)
  },

  /** Dissolves the household with all of its data (owner only). */
  dissolve() {
    return dissolveHousehold(apiClient)
  },
}
