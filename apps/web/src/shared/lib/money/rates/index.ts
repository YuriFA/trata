// Exchange-rates presentation state (multi-currency design D5): a module
// singleton over the per-device cache, in the shape of the local-db bridge.
// `refreshRates()` fetches fresh rates and is NON-FATAL by contract: a
// transport/provider failure keeps the previously cached rates in effect and
// resolves to false - it never blocks or breaks the app. Presentation reads
// the cached snapshot synchronously and updates when a refresh completes.
import { fetchLatestRates, type CurrencyRates } from '@trata/money'
import { readCachedRates, writeCachedRates } from './rates-cache'

import { computed, readonly, ref } from 'vue'

const cachedRates = ref<CurrencyRates | null>(readCachedRates())

let inFlight: Promise<boolean> | null = null

// The package seam takes a fetch-family function; bind the platform global
// here so `@trata/money` stays free of DOM/node globals (and tests can stub
// `global.fetch`).
const browserFetch = (input: string) => fetch(input)

/**
 * The cached published rates (null = nothing cached yet: a fresh install
 * that has never refreshed online - converted figures are then omitted).
 */
export function useRates() {
  return readonly(cachedRates)
}

/** The cached rates' publish date (ISO), or null without a cache. */
export const ratesAsOf = computed(() => cachedRates.value?.asOf ?? null)

/**
 * Refreshes rates from the external provider. Concurrent callers share one
 * in-flight request. Resolves true when fresh rates replaced the cache,
 * false on failure (the previous cache stays in effect - never throws).
 */
export function refreshRates(): Promise<boolean> {
  inFlight ??= fetchLatestRates(browserFetch)
    .then((fresh) => {
      cachedRates.value = fresh
      writeCachedRates(fresh)
      return true
    })
    .catch(() => false)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}
