// Recurrence vectors mirrored from the backend's TestAdvanceNextDue (design
// D2): both implementations are pinned by the same table so a locally
// confirmed plan and the server's auto job compute identical series.

import { describe, expect, it } from 'vitest'
import type { PlannedPaymentRegularity } from '@trata/api'
import { advanceNextDue, monthlyAmount, monthlyTotal } from './recurrence'

describe('advanceNextDue (shared backend vectors)', () => {
  it.each<[string, string, string, PlannedPaymentRegularity, string]>([
    ['daily', '2026-08-31', '2026-08-31', 'daily', '2026-09-01'],
    ['weekly keeps the weekday', '2026-08-25', '2026-08-25', 'weekly', '2026-09-01'],
    ['monthly same-day', '2026-08-05', '2026-08-05', 'monthly', '2026-09-05'],
    ['monthly 31 clamps to Feb 28', '2026-01-31', '2026-01-31', 'monthly', '2026-02-28'],
    ['monthly 31 recovers in Mar after Feb', '2026-02-28', '2026-01-31', 'monthly', '2026-03-31'],
    [
      'monthly 31 clamps to Apr 30 and recovers',
      '2026-03-31',
      '2026-01-31',
      'monthly',
      '2026-04-30',
    ],
    ['monthly 30 in Feb leap year', '2024-01-30', '2024-01-30', 'monthly', '2024-02-29'],
    ['monthly year rollover', '2026-12-15', '2026-12-15', 'monthly', '2027-01-15'],
    ['yearly same date', '2026-09-01', '2026-09-01', 'yearly', '2027-09-01'],
    ['yearly Feb 29 clamps to Feb 28', '2024-02-29', '2024-02-29', 'yearly', '2025-02-28'],
    [
      'yearly anchor day kept after clamped step',
      '2025-02-28',
      '2024-02-29',
      'yearly',
      '2026-02-28',
    ],
  ])('%s', (_name, nextDue, anchor, regularity, want) => {
    expect(advanceNextDue(nextDue, anchor, regularity)).toBe(want)
  })

  it('advances one period per step without skipping (catch-up sequence)', () => {
    const anchor = '2026-06-05'
    let next = anchor
    const want = ['2026-07-05', '2026-08-05', '2026-09-05']
    for (const expected of want) {
      next = advanceNextDue(next, anchor, 'monthly')
      expect(next).toBe(expected)
    }
  })
})

describe('monthly normalization', () => {
  it('converts each regularity to its monthly figure in integer minor units', () => {
    expect(monthlyAmount(599_00, 'monthly')).toBe(599_00)
    expect(monthlyAmount(12_000_00, 'yearly')).toBe(1_000_00)
    expect(monthlyAmount(300_00, 'weekly')).toBe(1_300_00) // 300 × 52/12 = 1300
    expect(monthlyAmount(12_00, 'daily')).toBe(365_00) // 12 × 365/12 = 365
  })

  it('sums plans into the card figure: 599 ₽/мес + 6 000 ₽/год → 1 099,00 ₽/мес', () => {
    const plans = [
      { amount: 599_00, regularity: 'monthly' },
      { amount: 6_000_00, regularity: 'yearly' },
    ] as const
    expect(monthlyTotal(plans)).toBe(109_900)
  })
})
