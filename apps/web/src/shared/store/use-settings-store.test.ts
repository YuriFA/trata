import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useSettingsStore } from './use-settings-store'
import { DEFAULT_SETTINGS } from '@/shared/config/settings'

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default values when localStorage is empty', () => {
    const store = useSettingsStore()
    expect(store.locale).toBe(DEFAULT_SETTINGS.locale)
    expect(store.theme).toBe(DEFAULT_SETTINGS.theme)
  })

  it('defaults the locale to Russian (product default, web-locales)', () => {
    const store = useSettingsStore()
    expect(store.locale).toBe('ru')
  })

  it('persists the chosen locale to localStorage on change', async () => {
    const store = useSettingsStore()
    store.locale = 'en'
    await nextTick()
    expect(localStorage.getItem('BudgetTracker:locale')).toBe('en')
  })

  it('persists the theme to localStorage on change', async () => {
    const store = useSettingsStore()
    store.theme = 'dark'
    await nextTick()
    const stored = localStorage.getItem('BudgetTracker:theme')
    expect(stored).toBe('dark')
  })

  it('reads initial locale from localStorage when present', () => {
    localStorage.setItem('BudgetTracker:locale', 'en')
    const store = useSettingsStore()
    expect(store.locale).toBe('en')
  })

  // currency-rub-only aftermath: the pre-cut store wrote a bare currency
  // string under the legacy key; the versioned display-currency envelope
  // ignores it, and the legacy key itself is left untouched.
  it('ignores a legacy bare currency key without removing it', () => {
    localStorage.setItem('BudgetTracker:currency', 'EUR')
    const store = useSettingsStore()
    expect(store.displayCurrency).toBeNull()
    expect(localStorage.getItem('BudgetTracker:currency')).toBe('EUR')
  })

  it('resolves the display currency from the versioned envelope', () => {
    localStorage.setItem(
      'BudgetTracker:display-currency',
      JSON.stringify({ version: 1, currency: 'USD' }),
    )
    const store = useSettingsStore()
    expect(store.displayCurrency).toBe('USD')
  })

  it('ignores an unknown schema version', () => {
    localStorage.setItem(
      'BudgetTracker:display-currency',
      JSON.stringify({ version: 99, currency: 'USD' }),
    )
    const store = useSettingsStore()
    expect(store.displayCurrency).toBeNull()
  })

  it('persists an explicit display currency and accepts null again', () => {
    const store = useSettingsStore()
    store.displayCurrency = 'EUR'
    expect(JSON.parse(localStorage.getItem('BudgetTracker:display-currency')!)).toEqual({
      version: 1,
      currency: 'EUR',
    })
    store.displayCurrency = null
    expect(JSON.parse(localStorage.getItem('BudgetTracker:display-currency')!)).toEqual({
      version: 1,
      currency: null,
    })
  })
})
