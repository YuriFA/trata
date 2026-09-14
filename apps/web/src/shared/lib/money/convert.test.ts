import { describe, it, expect } from 'vitest'
import { toMinorUnits, toMajorUnits } from '@trata/money'

describe('toMinorUnits', () => {
  it('converts whole units to kopeks', () => {
    expect(toMinorUnits(10)).toBe(1000)
  })

  it('converts fractional units to kopeks with rounding', () => {
    expect(toMinorUnits(10.5)).toBe(1050)
  })

  it('rounds float artifacts away', () => {
    expect(toMinorUnits(0.1 + 0.2)).toBe(30)
  })

  it('handles zero', () => {
    expect(toMinorUnits(0)).toBe(0)
  })

  it('handles negative values', () => {
    expect(toMinorUnits(-10.5)).toBe(-1050)
  })
})

describe('toMajorUnits', () => {
  it('converts kopeks to whole units', () => {
    expect(toMajorUnits(1000)).toBe(10)
  })

  it('preserves fractional kopeks', () => {
    expect(toMajorUnits(1050)).toBe(10.5)
  })

  it('handles zero', () => {
    expect(toMajorUnits(0)).toBe(0)
  })
})
