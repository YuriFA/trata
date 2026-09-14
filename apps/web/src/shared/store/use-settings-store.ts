import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useStorage } from '@vueuse/core'
import { isCurrencyCode, type CurrencyCode } from '@trata/money'
import { APP_NAME } from '@/shared/config/app'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/config/settings'

const LOCALE_STORAGE_KEY = `${APP_NAME}:locale`
const THEME_STORAGE_KEY = `${APP_NAME}:theme`

// The display currency persists in a versioned envelope (multi-currency
// design D3): the pre-cut store wrote a bare currency string under a
// different key, and the restored setting's meaning differs (null = follow
// the household base), so a schema version guards every read. Bump
// DISPLAY_CURRENCY_SCHEMA_VERSION whenever the stored shape changes.
const DISPLAY_CURRENCY_STORAGE_KEY = `${APP_NAME}:display-currency`
const DISPLAY_CURRENCY_SCHEMA_VERSION = 1

interface StoredDisplayCurrency {
  version: number
  currency: string | null
}

function readStoredDisplayCurrency(): CurrencyCode | null {
  try {
    const raw = localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDisplayCurrency>
    if (parsed.version !== DISPLAY_CURRENCY_SCHEMA_VERSION) return null
    return isCurrencyCode(parsed.currency) ? parsed.currency : null
  } catch {
    return null
  }
}

function writeStoredDisplayCurrency(currency: CurrencyCode | null): void {
  const stored: StoredDisplayCurrency = {
    version: DISPLAY_CURRENCY_SCHEMA_VERSION,
    currency,
  }
  localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, JSON.stringify(stored))
}

export const useSettingsStore = defineStore('settings', () => {
  const locale = useStorage<Settings['locale']>(LOCALE_STORAGE_KEY, DEFAULT_SETTINGS.locale)
  const theme = useStorage<Settings['theme']>(THEME_STORAGE_KEY, DEFAULT_SETTINGS.theme)

  const storedDisplayCurrency = ref(readStoredDisplayCurrency())

  /**
   * Explicit display currency; null = follow the household's base currency
   * (the resolution chain lives in `shared/store/use-display-currency`).
   */
  const displayCurrency = computed<CurrencyCode | null>({
    get: () => storedDisplayCurrency.value,
    set: (value) => {
      storedDisplayCurrency.value = value
      writeStoredDisplayCurrency(value)
    },
  })

  return { locale, theme, displayCurrency }
})
