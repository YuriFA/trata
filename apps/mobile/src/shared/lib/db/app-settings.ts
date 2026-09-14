// Device-local app settings over the local SQLite `app_settings` key/value
// table (multi-currency design D3): the display-currency preference is
// per-device, never synchronized, and affects presentation only. Absent key
// = no explicit preference - the resolution chain falls through to the
// household base currency (see resolveDisplayCurrency).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eq } from 'drizzle-orm'
import { appSettings } from '@trata/local-data'
import { isCurrencyCode, type CurrencyCode } from '@trata/money'
import { useLocalDatabase } from './database-context'
import type { LocalDatabase } from './database'

const DISPLAY_CURRENCY_QUERY_KEY = ['app-settings', 'display-currency'] as const
const DISPLAY_CURRENCY_KEY = 'display_currency'

/** The stored explicit preference; null = unset (chain falls through). */
function readDisplayCurrency(db: LocalDatabase): CurrencyCode | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, DISPLAY_CURRENCY_KEY)).get()
  if (!row || !isCurrencyCode(row.value)) return null
  return row.value
}

/** null clears the preference (the chain falls through again). */
function writeDisplayCurrency(db: LocalDatabase, currency: CurrencyCode | null): void {
  db.transaction((tx) => {
    tx.delete(appSettings).where(eq(appSettings.key, DISPLAY_CURRENCY_KEY)).run()
    if (currency !== null) {
      tx.insert(appSettings).values({ key: DISPLAY_CURRENCY_KEY, value: currency }).run()
    }
  })
}

export function useDisplayCurrencySetting() {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: DISPLAY_CURRENCY_QUERY_KEY,
    queryFn: () => readDisplayCurrency(db),
  })
  const set = useMutation({
    mutationFn: (currency: CurrencyCode | null) => {
      writeDisplayCurrency(db, currency)
      return Promise.resolve()
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: DISPLAY_CURRENCY_QUERY_KEY }),
  })
  return { data: query.data ?? null, setDisplayCurrency: set.mutate }
}
