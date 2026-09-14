import type { CurrencyCode } from './currencies'

/**
 * Published exchange rates from the external provider: 1 unit of `base`
 * equals `rates[code]` units of `code` (the open.er-api.com convention).
 * Values are plain numbers - display-grade precision only; every converted
 * figure is presented as approximate.
 */
export interface CurrencyRates {
  /** ISO code the published rates are quoted against (e.g. "USD"). */
  base: string
  /** Multiplication factor per code: 1 unit of `base` = `rates[code]` units of `code`. */
  rates: Record<string, number>
  /** Provider publish timestamp, ISO 8601 - shown next to converted figures. */
  asOf: string
}

/**
 * Structural subset of `fetch` - keeps the package free of DOM/node lib
 * types while staying stubbable in tests. Callers pass the platform's
 * `fetch`; the package never imports platform globals.
 */
export type FetchLike = (
  input: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const PROVIDER_URL = 'https://open.er-api.com/v6/latest'

/**
 * The conversion pivot. USD is the provider's natural base and keeps the
 * cross-rate math one division away for any catalog pair.
 */
const PROVIDER_BASE = 'USD'

/**
 * Fetch the latest published rates. Rejects on transport failure, non-2xx
 * or an unexpected payload; callers treat rejection as a non-fatal refresh
 * failure and keep serving their previously cached rates.
 */
export async function fetchLatestRates(fetchImpl: FetchLike): Promise<CurrencyRates> {
  const response = await fetchImpl(`${PROVIDER_URL}/${PROVIDER_BASE}`)
  if (!response.ok) {
    throw new Error(`rate provider responded ${response.status}`)
  }
  const payload = (await response.json()) as {
    result?: string
    base_code?: string
    rates?: Record<string, number>
    time_last_update_unix?: number
  }
  if (
    payload.result !== 'success' ||
    payload.base_code === undefined ||
    payload.rates === undefined ||
    payload.time_last_update_unix === undefined
  ) {
    throw new Error('rate provider returned an unexpected payload')
  }
  return {
    base: payload.base_code,
    rates: payload.rates,
    asOf: new Date(payload.time_last_update_unix * 1000).toISOString(),
  }
}

/**
 * Convert a minor-units amount between catalog currencies through the
 * published base, rounding half away from zero ONCE at the end. Callers
 * convert aggregates (bucket totals), never individual rows, so rounding
 * noise cannot accumulate. Returns `null` when a needed rate is missing -
 * the caller then omits the converted figure and keeps exact per-currency
 * totals (the graceful-degradation rule), never guesses with a stale
 * default rate.
 */
export function convert(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: CurrencyRates,
): number | null {
  if (from === to) return amountMinor
  const fromRate = rates.rates[from]
  const toRate = rates.rates[to]
  if (fromRate === undefined || toRate === undefined || fromRate === 0) return null
  const converted = (amountMinor * toRate) / fromRate
  // Half away from zero keeps negative balances symmetric with positive
  // ones ("0.5 rounds to 1" in both directions).
  const sign = converted < 0 ? -1 : 1
  return sign * Math.round(Math.abs(converted))
}
