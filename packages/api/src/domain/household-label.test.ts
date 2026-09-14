import { describe, expect, it } from 'vitest'
import type { Household, HouseholdMember } from './household'
import { emailLocalPart, householdDisplayName, memberLabel } from './household-label'

const ME = '11111111-1111-4111-8111-111111111111'
const SIBLING = '22222222-2222-4222-8222-222222222222'

function member(overrides: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    userId: SIBLING,
    email: 'wife@example.com',
    displayName: null,
    role: 'member',
    joinedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

function me(overrides: Partial<HouseholdMember> = {}): HouseholdMember {
  return member({ userId: ME, email: 'me@example.com', role: 'owner', ...overrides })
}

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: 'hh-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    name: null,
    currency: 'RUB',
    members: [me()],
    ...overrides,
  }
}

describe('emailLocalPart', () => {
  it('takes the part before the @', () => {
    expect(emailLocalPart('wife@example.com')).toBe('wife')
  })

  it('returns the input whole when there is no @', () => {
    expect(emailLocalPart('wife')).toBe('wife')
  })
})

describe('memberLabel', () => {
  it('prefers the display name when set', () => {
    expect(memberLabel(member({ displayName: 'Жена' }))).toBe('Жена')
  })

  it('falls back to the email', () => {
    expect(memberLabel(member())).toBe('wife@example.com')
  })
})

describe('householdDisplayName', () => {
  it('uses the household name when set', () => {
    expect(householdDisplayName(household({ name: 'Семья' }))).toBe('Семья')
  })

  it('derives the label from the owner when the name is unset', () => {
    const members = [member(), me()]
    expect(householdDisplayName(household({ members }))).toBe('me')
  })

  it('derives from the first member when no owner is present', () => {
    expect(householdDisplayName(household({ members: [member()] }))).toBe('wife')
  })

  it('returns an empty string for a household with no members', () => {
    expect(householdDisplayName(household({ members: [] }))).toBe('')
  })
})
