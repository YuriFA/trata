import { describe, it, expect } from 'vitest'
import { AVAILABLE_CURRENCIES } from '@trata/money'
import { createAddAccountSchema } from './add-account-schema'

const validInput = { name: 'Main', openingBalance: 100, currency: 'RUB' }

describe('createAddAccountSchema', () => {
  const schema = createAddAccountSchema()

  it('accepts valid input', () => {
    const result = schema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('accepts zero openingBalance', () => {
    const result = schema.safeParse({ ...validInput, openingBalance: 0 })
    expect(result.success).toBe(true)
  })

  // multi-currency: the creation currency is validated against the catalog.
  it('accepts every catalog currency', () => {
    for (const currency of AVAILABLE_CURRENCIES) {
      expect(schema.safeParse({ ...validInput, currency }).success).toBe(true)
    }
  })

  it('rejects a currency outside the catalog', () => {
    const result = schema.safeParse({ ...validInput, currency: 'JPY' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing currency', () => {
    const { currency: _currency, ...withoutCurrency } = validInput
    expect(schema.safeParse(withoutCurrency).success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = schema.safeParse({ name: '', openingBalance: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects negative openingBalance', () => {
    const result = schema.safeParse({ name: 'Main', openingBalance: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects non-number openingBalance', () => {
    const result = schema.safeParse({ name: 'Main', openingBalance: '100' })
    expect(result.success).toBe(false)
  })

  it('rejects missing name', () => {
    const result = schema.safeParse({ openingBalance: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects missing openingBalance', () => {
    const result = schema.safeParse({ name: 'Main' })
    expect(result.success).toBe(false)
  })
})
