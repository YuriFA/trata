// Multi-currency aggregate presentation (multi-currency design D9): stored
// amounts stay native and exact; conversion happens only here, on aggregate
// buckets - one `convert()` per currency bucket, never per row. Converted
// figures are approximate by nature (the UI marks them «≈» and shows the
// rate's as-of date); single-currency aggregates stay exact and unmarked.

import {
  AVAILABLE_CURRENCIES,
  convert,
  DEFAULT_CURRENCY,
  formatMoney,
  type CurrencyCode,
  type CurrencyRates,
} from '@trata/money'

const RU_LOCALE = 'ru'

/**
 * Compact aggregate figure: the money package's always-two-digits output
 * with a zero fraction stripped ("26 813 ₽" / "$1 240" instead of
 * "26 813,00 ₽") - the app's reference look for hero totals.
 */
function formatCompact(amountMinor: number, currency: CurrencyCode): string {
  return formatMoney(amountMinor, currency, RU_LOCALE).replace(/,00(?=\u00A0)/, '')
}

/** One exact per-currency sum in minor units. */
export interface CurrencyBucket {
  currency: CurrencyCode
  amount: number
}

/**
 * Everything the aggregate presentation needs: the native currency of every
 * account (rows and buckets), the resolved display currency, and the cached
 * rate snapshot (null = none cached - converted figures are omitted).
 */
export interface MoneyPresentation {
  currencyByAccountId: ReadonlyMap<string, CurrencyCode>
  displayCurrency: CurrencyCode
  rates: CurrencyRates | null
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

  // No movement at all is a real zero of the display currency, not a blank:
  // empty aggregates keep rendering exact hero figures («0 ₽»).
  if (totals.length === 0) {
    return { totals: [{ currency: target, amount: 0 }], isMixed: false, converted: null }
  }
  if (totals.length === 1) {
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

/**
 * The native currency of one amount record: its account's currency, or the
 * display currency for account-less figures («Без счета»). Accepts the
 * domain union loosely - cashflow records may carry a null account, and the
 * transfer variant has no accountId at all.
 */
export function nativeCurrencyOf(
  record: object,
  presentation: Pick<MoneyPresentation, 'currencyByAccountId' | 'displayCurrency'>,
): CurrencyCode {
  // `object` keeps the domain union assignable even for the transfer variant
  // (no accountId property at all - TS's weak-type check would reject an
  // all-optional parameter type); `in` + `typeof` read the field checked.
  const accountId = 'accountId' in record ? record.accountId : undefined
  return (
    (typeof accountId === 'string' ? presentation.currencyByAccountId.get(accountId) : undefined) ??
    presentation.displayCurrency
  )
}

/**
 * Native currency buckets of amount records: each joins its account's
 * currency; account-less amounts have no native account and join the
 * display-currency bucket (analytics capability).
 */
export function cashflowBuckets(
  transactions: ReadonlyArray<{ amount: number; accountId?: string | null }>,
  currencyByAccountId: ReadonlyMap<string, CurrencyCode>,
  displayCurrency: CurrencyCode,
): CurrencyBucket[] {
  return transactions.map((transaction) => ({
    currency: nativeCurrencyOf(transaction, {
      currencyByAccountId,
      displayCurrency,
    }),
    amount: transaction.amount,
  }))
}

function perCurrencyLine(aggregate: CurrencyAggregate): string {
  return aggregate.totals
    .map((total) => formatCompact(total.amount, total.currency))
    .join(' \u00B7 ')
}

/**
 * The hero figure of an aggregate screen: the exact single-currency total,
 * the «≈» converted total, or - when a mixed aggregate has no cached rates -
 * the joined per-currency line (the graceful-degradation presentation).
 */
export function aggregateHeroText(aggregate: CurrencyAggregate): string {
  if (aggregate.converted) {
    const converted = aggregate.converted
    return `\u2248\u00A0${formatCompact(converted.amount, converted.currency)}`
  }
  if (!aggregate.isMixed && aggregate.totals.length === 1) {
    const total = aggregate.totals[0] as CurrencyBucket
    return formatCompact(total.amount, total.currency)
  }
  return perCurrencyLine(aggregate)
}

/** The exact per-currency line shown under a converted hero («20 113 ₽ · $100,00»). */
export function aggregateDetailText(aggregate: CurrencyAggregate): string | null {
  return aggregate.converted ? perCurrencyLine(aggregate) : null
}

/**
 * The exact-only aggregate text (no conversion): the compact single-currency
 * total, or the joined per-currency line for a mixed aggregate. Used where
 * the native-currency rule forbids conversion marks - list rows, day
 * headers - and for the missing-rates degradation.
 */
export function aggregateExactText(aggregate: CurrencyAggregate): string {
  if (!aggregate.isMixed && aggregate.totals.length === 1) {
    const total = aggregate.totals[0] as CurrencyBucket
    return formatCompact(total.amount, total.currency)
  }
  return perCurrencyLine(aggregate)
}

/** "2026-09-14T…Z" -> "14.09.2026": the rate date shown next to «≈» figures. */
export function rateDateLabel(asOf: string): string {
  const [date = ''] = asOf.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${day}.${month}.${year}`
}
