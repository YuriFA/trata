import { describe, it, expect } from 'vitest'
import { createDebtorDebtSchema, createOperationSchema, createRenameDebtorSchema } from './schemas'

describe('debts form schemas', () => {
  it('requires a positive operation amount', () => {
    const schema = createOperationSchema()
    expect(schema.safeParse({ kind: 'debt', amount: 100, occurredAt: '2026-08-27' }).success).toBe(
      true,
    )
    expect(schema.safeParse({ kind: 'debt', amount: 0, occurredAt: '2026-08-27' }).success).toBe(
      false,
    )
    expect(schema.safeParse({ kind: 'debt', amount: -5, occurredAt: '2026-08-27' }).success).toBe(
      false,
    )
  })

  it('requires the kind and the occurred date', () => {
    const schema = createOperationSchema()
    expect(schema.safeParse({ kind: 'unknown', amount: 1, occurredAt: '2026-08-27' }).success).toBe(
      false,
    )
    expect(schema.safeParse({ kind: 'debt', amount: 1, occurredAt: '' }).success).toBe(false)
  })

  it('requires a non-empty debtor name and a catalog currency for the combined dialog', () => {
    const schema = createDebtorDebtSchema()
    expect(
      schema.safeParse({
        name: 'Анна',
        currency: 'RUB',
        amount: 1,
        occurredAt: '2026-08-27',
      }).success,
    ).toBe(true)
    expect(
      schema.safeParse({
        name: '   ',
        currency: 'RUB',
        amount: 1,
        occurredAt: '2026-08-27',
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        name: 'Анна',
        currency: 'RUB',
        amount: 0,
        occurredAt: '2026-08-27',
      }).success,
    ).toBe(false)
    // The ledger currency must come from the supported catalog.
    expect(
      schema.safeParse({
        name: 'Анна',
        currency: 'XX',
        amount: 1,
        occurredAt: '2026-08-27',
      }).success,
    ).toBe(false)
  })

  it('requires a non-empty name for the rename dialog', () => {
    const schema = createRenameDebtorSchema()
    expect(schema.safeParse({ name: 'Анна' }).success).toBe(true)
    expect(schema.safeParse({ name: '' }).success).toBe(false)
  })
})
