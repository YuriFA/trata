// Multi-currency aggregate presentation (multi-currency design D9): stored
// amounts stay native and exact; conversion happens only here, on aggregate
// buckets - one `convert()` per currency bucket, never per row. Converted
// figures are approximate by nature (the UI marks them «≈» and shows the
// rate's as-of date); single-currency aggregates stay exact and unmarked.

import {
  convert,
  DEFAULT_CURRENCY,
  AVAILABLE_CURRENCIES,
  type CurrencyCode,
  type CurrencyRates,
} from '@trata/money'

/** One exact per-currency sum in minor units. */
export interface CurrencyBucket {
  currency: CurrencyCode
  amount: number
}

export interface CurrencyAggregate {
  /**
   * Per-currency exact totals, the display (target) currency first, then
   * catalog order - the presentation order of every aggregate screen.
   */
  totals: CurrencyBucket[]
  /** True when the buckets span more than one currency. */
  isMixed: boolean
  /**
   * The buckets summed after conversion into the target currency, or null
   * when no converted figure is presented: either every amount already
   * shares one currency (exact, no approximation mark) or a required rate
   * is missing (the converted total is omitted, never an error - the
   * exchange-rates degradation rule).
   */
  converted: CurrencyBucket | null
}

/**
 * Display-currency resolution chain (multi-currency design D3): an explicit
 * per-device preference wins, then the household base currency, then the
 * `DEFAULT_CURRENCY` fallback.
 */
export function resolveDisplayCurrency(
  explicit: CurrencyCode | null | undefined,
  householdBase: CurrencyCode | null | undefined,
): CurrencyCode {
  return explicit ?? householdBase ?? DEFAULT_CURRENCY
}
/**
 * Groups exact per-currency sums and computes the optional converted total.
 * Every input is a native (never converted) amount: accounts feed balances,
 * period transactions feed their account's currency (account-less amounts
 * join the display-currency bucket), debt operations feed their debtor's.
 */
export function aggregateByCurrency(
  amounts: Iterable<CurrencyBucket>,
  target: CurrencyCode,
  rates: CurrencyRates | null | undefined,
): CurrencyAggregate {
  const sums = new Map<CurrencyCode, number>()
  for (const { currency, amount } of amounts) {
    sums.set(currency, (sums.get(currency) ?? 0) + amount)
  }

  const order = (code: CurrencyCode) => (code === target ? -1 : AVAILABLE_CURRENCIES.indexOf(code))
  const totals = [...sums.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => order(a.currency) - order(b.currency))

  if (totals.length <= 1) {
    return { totals, isMixed: false, converted: null }
  }
  if (!rates) {
    return { totals, isMixed: true, converted: null }
  }

  let amount = 0
  for (const total of totals) {
    const convertedBucket = convert(total.amount, total.currency, target, rates)
    // A missing pair degrades the whole converted figure (never partially).
    if (convertedBucket === null) {
      return { totals, isMixed: true, converted: null }
    }
    amount += convertedBucket
  }
  return { totals, isMixed: true, converted: { currency: target, amount } }
}
