import { describe, expect, it } from 'vitest'
import { convert, fetchLatestRates, type CurrencyRates, type FetchLike } from './rates'

// open.er-api.com convention: 1 unit of base = rates[code] units of code.
const RATES: CurrencyRates = {
  base: 'USD',
  asOf: '2026-09-14T00:02:31.000Z',
  rates: { USD: 1, RUB: 84.239057, EUR: 0.85, GEL: 2.7, KZT: 520 },
}

const stubFetch = (body: unknown, ok = true, status = 200): FetchLike => async () => ({
  ok,
  status,
  json: async () => body,
})

describe('convert', () => {
  it('returns the amount untouched for a same-currency conversion, rates or not', () => {
    expect(convert(12_345, 'RUB', 'RUB', { base: 'USD', asOf: '', rates: {} })).toBe(12_345)
  })

  it('converts a direct pair against the published base (USD -> RUB)', () => {
    // $1240.00 -> 124 000 minor * 84.239057 / 1 = 10 445 643 minor
    expect(convert(124_000, 'USD', 'RUB', RATES)).toBe(10_445_643)
  })

  it('computes the cross rate through the base (GEL -> KZT)', () => {
    // 100 minor = 1 GEL = 1/2.7 USD = 520/2.7 KZT -> 19 259 minor
    expect(convert(100, 'GEL', 'KZT', RATES)).toBe(19_259)
  })

  it('rounds half away from zero, symmetric for negatives', () => {
    const half: CurrencyRates = { base: 'USD', asOf: '', rates: { USD: 1, RUB: 2 } }
    // 1 minor * 1/2 = 0.5 -> 1; mirrored for the negative.
    expect(convert(1, 'RUB', 'USD', half)).toBe(1)
    expect(convert(-1, 'RUB', 'USD', half)).toBe(-1)
  })

  it('returns null instead of guessing when a needed rate is missing', () => {
    expect(convert(100, 'GEL', 'KZT', { base: 'USD', asOf: '', rates: { USD: 1 } })).toBeNull()
    expect(convert(100, 'GEL', 'KZT', { base: 'USD', asOf: '', rates: { GEL: 2.7 } })).toBeNull()
  })
})

describe('fetchLatestRates', () => {
  it('maps the provider payload to base, rates and an ISO as-of date', async () => {
    const rates = await fetchLatestRates(
      stubFetch({
        result: 'success',
        base_code: 'USD',
        rates: { RUB: 84.24, USD: 1 },
        time_last_update_unix: 1_760_467_351,
      }),
    )
    expect(rates).toEqual({
      base: 'USD',
      rates: { RUB: 84.24, USD: 1 },
      asOf: new Date(1_760_467_351_000).toISOString(),
    })
  })

  it('rejects on a transport failure so callers keep their cached rates', async () => {
    await expect(fetchLatestRates(stubFetch({}, false, 503))).rejects.toThrow('503')
  })

  it('rejects on an unexpected payload shape', async () => {
    await expect(fetchLatestRates(stubFetch({ result: 'error' }))).rejects.toThrow(
      'unexpected payload',
    )
  })
})
