// Household + profile endpoint client: reading the requester's household with
// its members, editing the current user's display name, and the join
// lifecycle (invitations, home code, join/leave/remove/dissolve, household
// name). Platform-agnostic like every HTTP call here - callers supply the
// fetch-backed ApiClient. Errors reject as RepositoryError keyed on the
// backend `ErrorResponse.code` (e.g. HOUSEHOLD_INVITATION_EXPIRED).

import type { ApiClient } from '../api-client'
import type { CurrencyCode } from '@trata/money'
import {
  normalizeHousehold,
  normalizeHouseholdCode,
  normalizeHouseholdInvitation,
  normalizeHouseholdInvitationPreview,
  type Household,
  type HouseholdCode,
  type HouseholdInvitation,
  type HouseholdInvitationPreview,
} from '../domain/household'

function requireData<T>(data: T | undefined): T {
  if (data === undefined) {
    throw new Error('Expected a response body but received none')
  }
  return data
}

function requireHousehold(data: unknown): Household {
  const household = normalizeHousehold(data)
  if (!household) {
    throw new Error('Received a malformed household from the server')
  }
  return household
}

/**
 * Fetches the current user's household (name, members with email, display
 * name, role, and joined date). Rejects only on transport/auth failures.
 */
export async function fetchHousehold(client: ApiClient): Promise<Household> {
  const { data } = await client.GET('/api/household', { params: {} })
  return requireHousehold(requireData(data))
}

/**
 * Updates the household (owner only): sets or clears the display name
 * (`null` resets it) and optionally changes the base currency. Resolves
 * with the updated household.
 */
export async function updateHousehold(
  client: ApiClient,
  patch: { name: string | null; currency?: CurrencyCode },
): Promise<Household> {
  const { data } = await client.PATCH('/api/household', { body: patch })
  return requireHousehold(requireData(data))
}

/**
 * Sets the current user's display name (non-empty, max 100 chars enforced by
 * the contract). Resolves with the updated display name.
 */
export async function updateDisplayName(client: ApiClient, displayName: string): Promise<string> {
  const { data } = await client.PATCH('/api/me', { body: { displayName } })
  const updated = requireData(data).displayName
  if (typeof updated !== 'string' || updated.length === 0) {
    throw new Error('Received a malformed profile response from the server')
  }
  return updated
}

/**
 * Invites a member by email (owner only). Re-inviting a pending email
 * refreshes its token/expiry instead of duplicating. Resolves with the
 * active invitation.
 */
export async function createHouseholdInvitation(
  client: ApiClient,
  email: string,
): Promise<HouseholdInvitation> {
  const { data } = await client.POST('/api/household/invitations', { body: { email } })
  const invitation = normalizeHouseholdInvitation(requireData(data))
  if (!invitation) {
    throw new Error('Received a malformed household invitation from the server')
  }
  return invitation
}

/** Lists the household's invitations, freshest first (owner only). */
export async function listHouseholdInvitations(client: ApiClient): Promise<HouseholdInvitation[]> {
  const { data } = await client.GET('/api/household/invitations', { params: {} })
  const raw = requireData(data).invitations
  if (!Array.isArray(raw)) {
    throw new Error('Received a malformed household invitation list from the server')
  }
  return raw.map((item) => {
    const invitation = normalizeHouseholdInvitation(item)
    if (!invitation) {
      throw new Error('Received a malformed household invitation from the server')
    }
    return invitation
  })
}

/** Revokes an invitation (owner only); idempotent for already-revoked ones. */
export async function revokeHouseholdInvitation(client: ApiClient, invitationId: string): Promise<void> {
  await client.DELETE('/api/household/invitations/{invitationId}', {
    params: { path: { invitationId } },
  })
}

/**
 * Previews an invitation by its accept token. Requires the authenticated
 * account's email to match the invitation (mismatch rejects with
 * HOUSEHOLD_INVITATION_EMAIL_MISMATCH; expired/revoked/accepted invitations
 * reject with their lifecycle codes).
 */
export async function previewHouseholdInvitation(
  client: ApiClient,
  token: string,
): Promise<HouseholdInvitationPreview> {
  const { data } = await client.GET('/api/invitations/{token}', {
    params: { path: { token } },
  })
  const preview = normalizeHouseholdInvitationPreview(requireData(data))
  if (!preview) {
    throw new Error('Received a malformed invitation preview from the server')
  }
  return preview
}

/**
 * Accepts an invitation: moves the user's single membership into the
 * inviting household. Idempotent (accepting into the current household is a
 * no-op success). Resolves with the joined household.
 */
export async function acceptHouseholdInvitation(client: ApiClient, token: string): Promise<Household> {
  const { data } = await client.POST('/api/invitations/{token}/accept', {
    params: { path: { token } },
  })
  return requireHousehold(requireData(data))
}

/** Generates or rotates the household's join code (owner only). */
export async function generateHouseholdCode(client: ApiClient): Promise<HouseholdCode> {
  const { data } = await client.POST('/api/household/code', { params: {} })
  const code = normalizeHouseholdCode(requireData(data))
  if (!code) {
    throw new Error('Received a malformed household code from the server')
  }
  return code
}

/** Revokes the household's join code (owner only); idempotent. */
export async function revokeHouseholdCode(client: ApiClient): Promise<void> {
  await client.DELETE('/api/household/code', { params: {} })
}

/**
 * Joins the household of an active code (any authenticated user). Idempotent
 * (a code for the current household is a no-op success). Resolves with the
 * joined household.
 */
export async function joinHouseholdByCode(client: ApiClient, code: string): Promise<Household> {
  const { data } = await client.POST('/api/household/join', { body: { code } })
  return requireHousehold(requireData(data))
}

/**
 * Leaves the household (the owner cannot leave while other members remain).
 * Resolves with the fresh personal household created for the user.
 */
export async function leaveHousehold(client: ApiClient): Promise<Household> {
  const { data } = await client.POST('/api/household/leave', { params: {} })
  return requireHousehold(requireData(data))
}

/** Removes a member from the household (owner only; the owner cannot be removed). */
export async function removeHouseholdMember(client: ApiClient, userId: string): Promise<void> {
  await client.DELETE('/api/household/members/{userId}', {
    params: { path: { userId } },
  })
}

/**
 * Dissolves the household with all of its data (owner only; explicit
 * confirm is part of the request contract).
 */
export async function dissolveHousehold(client: ApiClient): Promise<void> {
  await client.POST('/api/household/dissolve', { body: { confirm: true } })
}
