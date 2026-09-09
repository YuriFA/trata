import { describe, expect, it } from '@jest/globals'
import { formatAmount } from './format'

// ru shaping from @trata/money: narrow no-break space (\u202F)
// groups thousands, no-break space (\u00A0) glues the currency symbol.

describe('format · formatAmount', () => {
  it('renders a compact amount with the RUB symbol', () => {
    expect(formatAmount(26_813_00)).toBe('26\u202F813\u00A0₽')
  })

  it('keeps fractional amounts two-digits', () => {
    expect(formatAmount(1_234_50)).toBe('1\u202F234,50\u00A0₽')
  })

  it('renders negative amounts with a leading minus', () => {
    expect(formatAmount(-500_00)).toBe('-500\u00A0₽')
  })
})
