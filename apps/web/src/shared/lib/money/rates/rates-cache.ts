// Per-device rates cache (multi-currency design D5): the web app persists
// the latest published rates in localStorage - device-local by definition
// (the sync protocol carries no rate records) - in a versioned envelope
// following the device-cache conventions (`last-account-ids`). Bump
// RATES_SCHEMA_VERSION whenever the stored shape changes; unreadable or
// stale-versioned data degrades to "never cached" (fresh install offline).

import type { CurrencyRates } from '@trata/money'
import { APP_NAME } from '@/shared/config/app'

const RATES_STORAGE_KEY = `${APP_NAME}:exchange-rates`
const RATES_SCHEMA_VERSION = 1

interface StoredRates {
  version: number
  rates: CurrencyRates
}

function isCurrencyRates(value: unknown): value is CurrencyRates {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CurrencyRates>
  if (typeof candidate.base !== 'string' || typeof candidate.asOf !== 'string') return false
  if (typeof candidate.rates !== 'object' || candidate.rates === null) return false
  return Object.values(candidate.rates).every((rate) => typeof rate === 'number')
}

export function readCachedRates(): CurrencyRates | null {
  try {
    const raw = localStorage.getItem(RATES_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredRates>
    if (parsed.version !== RATES_SCHEMA_VERSION) return null
    return isCurrencyRates(parsed.rates) ? parsed.rates : null
  } catch {
    return null
  }
}

export function writeCachedRates(rates: CurrencyRates): void {
  const stored: StoredRates = { version: RATES_SCHEMA_VERSION, rates }
  localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(stored))
}
