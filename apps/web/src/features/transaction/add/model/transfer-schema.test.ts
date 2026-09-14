import { describe, it, expect } from 'vitest'
import { createTransferSchema } from './transfer-schema'

// The iff-rule's cross-currency leg is judged against the live account pair,
// so the tests drive the context flag instead of a static schema.
let crossCurrency: boolean
const schema = createTransferSchema({ isCrossCurrency: () => crossCurrency })

const validBase = {
  type: 'transfer',
  fromAccountId: 'a1',
  toAccountId: 'a2',
  amount: 100,
  occurredAt: '2026-08-29T10:00:00.000Z',
}

describe('createTransferSchema', () => {
  it('accepts valid transfer input', () => {
    crossCurrency = false
    const result = schema.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  it('accepts optional description', () => {
    crossCurrency = false
    const result = schema.safeParse({
      ...validBase,
      description: 'Monthly transfer',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-transfer type', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'income',
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty fromAccountId', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: '',
      toAccountId: 'a2',
      amount: 100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty toAccountId', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: 'a1',
      toAccountId: '',
      amount: 100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when fromAccountId equals toAccountId', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: 'a1',
      toAccountId: 'a1',
      amount: 100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero amount', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative amount', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: -10,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-number amount', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: '100',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing type', () => {
    crossCurrency = false
    const result = schema.safeParse({
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 100,
    })
    expect(result.success).toBe(false)
  })

  it('reports error on toAccountId path when accounts are equal', () => {
    crossCurrency = false
    const result = schema.safeParse({
      type: 'transfer',
      fromAccountId: 'a1',
      toAccountId: 'a1',
      amount: 100,
      occurredAt: '2026-08-29T10:00:00.000Z',
    })
    if (result.success) {
      throw new Error('Expected schema to fail')
    }
    const paths = result.error.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('toAccountId')
  })

  it('requires the destination amount for a cross-currency pair', () => {
    crossCurrency = true
    const result = schema.safeParse(validBase)
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('destinationAmount')
  })

  it('rejects a non-positive destination amount', () => {
    crossCurrency = true
    const result = schema.safeParse({ ...validBase, destinationAmount: 0 })
    expect(result.success).toBe(false)
  })

  it('accepts a stale destination value on a same-currency pair', () => {
    // The form-level schema never rejects a lingering field value; the
    // submit payload simply omits it for same-currency pairs (TransferForm).
    crossCurrency = false
    const result = schema.safeParse({ ...validBase, destinationAmount: 100 })
    expect(result.success).toBe(true)
  })
})
