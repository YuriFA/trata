// Per-device exchange-rates cache over the local SQLite database
// (multi-currency design D5, exchange-rates capability): rates live in the
// `exchange_rates` table, never synchronize, and a failed refresh is
// NON-FATAL by contract - it keeps the previously cached snapshot in effect
// and resolves false, never throwing into the caller. Presentation reads the
// cached snapshot through the `useRates` query and updates when a refresh
// completes.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchLatestRates, isCurrencyCode, type CurrencyRates } from '@trata/money'
import { exchangeRates } from '@trata/local-data'
import { useLocalDatabase } from './database-context'
import type { LocalDatabase } from './database'

const RATES_QUERY_KEY = ['exchange-rates'] as const

/** Reassembles the cached snapshot; null = never cached (fresh install). */
async function readCachedRates(db: LocalDatabase): Promise<CurrencyRates | null> {
  const rows = db.select().from(exchangeRates).all()
  if (rows.length === 0) return null
  const { base, asOf } = rows[0] as { base: string; asOf: string }
  const rates: Record<string, number> = {}
  for (const row of rows) {
    rates[row.code] = row.rate
  }
  return { base, rates, asOf }
}

/** Replaces the whole snapshot in one transaction (one write per refresh). */
function writeCachedRates(db: LocalDatabase, rates: CurrencyRates): void {
  db.transaction((tx) => {
    tx.delete(exchangeRates).run()
    tx.insert(exchangeRates)
      .values(
        Object.entries(rates.rates)
          .filter(([code]) => isCurrencyCode(code))
          .map(([code, rate]) => ({ code, base: rates.base, rate, asOf: rates.asOf })),
      )
      .run()
  })
}

let inFlight: Promise<boolean> | null = null

/**
 * Refreshes rates from the external provider and rewrites the cache.
 * Concurrent callers share one in-flight request. Resolves true when fresh
 * rates replaced the cache, false on failure (the previous cache stays in
 * effect - never throws).
 */
export async function refreshRates(db: LocalDatabase): Promise<boolean> {
  inFlight ??= fetchLatestRates((input) => fetch(input))
    .then((fresh) => {
      writeCachedRates(db, fresh)
      return true
    })
    .catch(() => false)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** The cached published rates (null = nothing cached: converted figures are omitted). */
export function useRates() {
  const db = useLocalDatabase()
  return useQuery({
    queryKey: RATES_QUERY_KEY,
    queryFn: () => readCachedRates(db),
  })
}

/** Refresh hook: runs `refreshRates` and refreshes the presentation query. */
export function useRatesRefresher() {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  return () =>
    refreshRates(db).then((refreshed) => {
      if (refreshed) void queryClient.invalidateQueries({ queryKey: RATES_QUERY_KEY })
      return refreshed
    })
}
