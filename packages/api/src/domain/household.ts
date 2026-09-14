import { isCurrencyCode, type CurrencyCode } from '@trata/money'
import { asDateTimeString, asNonEmptyString, asString, isRecord } from '../lib/normalize'

export type HouseholdRole = 'owner' | 'member'

export interface HouseholdMember {
  userId: string
  email: string
  /** Display name; null when never set (consumers fall back to email). */
  displayName: string | null
  role: HouseholdRole
  joinedAt: string
}

export interface Household {
  id: string
  createdAt: string
  /** Owner-set display name; null = never set (consumers derive a label). */
  name: string | null
  /**
   * Base currency: the conversion target for household-wide presentation.
   * Owner-editable; changing it never rewrites stored amounts.
   */
  currency: CurrencyCode
  members: HouseholdMember[]
}

/** Invitation lifecycle state as reported by the owner-side listing. */
export type HouseholdInvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface HouseholdInvitation {
  id: string
  email: string
  status: HouseholdInvitationStatus
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

/** Acceptor-side preview of an invitation (matching-email accounts only). */
export interface HouseholdInvitationPreview {
  householdName: string | null
  membersCount: number
  inviterEmail: string
  inviterDisplayName: string | null
  expiresAt: string
}

export interface HouseholdCode {
  code: string
  createdAt: string
}

const isHouseholdRole = (value: unknown): value is HouseholdRole =>
  value === 'owner' || value === 'member'

const isInvitationStatus = (value: unknown): value is HouseholdInvitationStatus =>
  value === 'pending' ||
  value === 'accepted' ||
  value === 'revoked' ||
  value === 'expired'

// Nullable-but-optional field: the Go server omits nil pointers (omitempty),
// so "absent" and JSON null are the same thing here - both mean "not set".
const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : asString(value)

const asNullableDateTime = (value: unknown): string | null =>
  value === null || value === undefined ? null : asDateTimeString(value)

export const normalizeHouseholdMember = (value: unknown): HouseholdMember | null => {
  if (!isRecord(value)) {
    return null
  }

  const userId = asNonEmptyString(value.userId)
  const email = asNonEmptyString(value.email)
  const displayName = value.displayName == null ? null : asString(value.displayName)
  const role = isHouseholdRole(value.role) ? value.role : null
  const joinedAt = asDateTimeString(value.joinedAt)

  if (!userId || !email || !role || !joinedAt) {
    return null
  }

  return { userId, email, displayName, role, joinedAt }
}

export const normalizeHousehold = (value: unknown): Household | null => {
  if (!isRecord(value) || !Array.isArray(value.members)) {
    return null
  }

  const id = asNonEmptyString(value.id)
  const createdAt = asDateTimeString(value.createdAt)
  const name = asNullableString(value.name)
  const currency = isCurrencyCode(value.currency) ? value.currency : null
  if (!id || !createdAt || !currency) {
    return null
  }

  const members: HouseholdMember[] = []
  for (const raw of value.members) {
    const member = normalizeHouseholdMember(raw)
    if (!member) {
      return null
    }
    members.push(member)
  }

  return { id, createdAt, name, currency, members }
}

export const normalizeHouseholdInvitation = (value: unknown): HouseholdInvitation | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = asNonEmptyString(value.id)
  const email = asNonEmptyString(value.email)
  const status = isInvitationStatus(value.status) ? value.status : null
  const createdAt = asDateTimeString(value.createdAt)
  const expiresAt = asDateTimeString(value.expiresAt)
  const acceptedAt = asNullableDateTime(value.acceptedAt)
  const revokedAt = asNullableDateTime(value.revokedAt)
  if (!id || !email || !status || !createdAt || !expiresAt) {
    return null
  }

  return { id, email, status, createdAt, expiresAt, acceptedAt, revokedAt }
}

export const normalizeHouseholdInvitationPreview = (
  value: unknown,
): HouseholdInvitationPreview | null => {
  if (!isRecord(value)) {
    return null
  }

  const householdName = asNullableString(value.householdName)
  const inviterEmail = asNonEmptyString(value.inviterEmail)
  const inviterDisplayName = asNullableString(value.inviterDisplayName)
  const expiresAt = asDateTimeString(value.expiresAt)
  const membersCount =
    typeof value.membersCount === 'number' && Number.isSafeInteger(value.membersCount)
      ? value.membersCount
      : null
  if (!inviterEmail || !expiresAt || membersCount === null || membersCount < 1) {
    return null
  }

  return { householdName, membersCount, inviterEmail, inviterDisplayName, expiresAt }
}

export const normalizeHouseholdCode = (value: unknown): HouseholdCode | null => {
  if (!isRecord(value)) {
    return null
  }

  const code = asNonEmptyString(value.code)
  const createdAt = asDateTimeString(value.createdAt)
  if (!code || !createdAt) {
    return null
  }

  return { code, createdAt }
}
