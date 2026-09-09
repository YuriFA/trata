import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { DEFAULT_LOCALE } from '@trata/i18n'
import i18n from '@/shared/i18n'
import { setupI18nLocaleWatcher } from './setup-i18n-locale-watcher'
import { useSettingsStore } from '@/shared/store/use-settings-store'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

// The watcher needs an app context (query cache, active pinia), so each test
// mounts a harness component that installs it, as main.ts does.

const I18nLocaleHarness = defineComponent({
  setup() {
    setupI18nLocaleWatcher()
    return () => null
  },
})

function mountLocaleHarness() {
  return mountWithProviders(I18nLocaleHarness)
}

describe('setupI18nLocaleWatcher', () => {
  beforeEach(() => {
    localStorage.clear()
    i18n.global.locale.value = DEFAULT_LOCALE
  })

  it('presents Russian on a first visit (no stored choice)', () => {
    expect(DEFAULT_LOCALE).toBe('ru')

    mountLocaleHarness()

    expect(i18n.global.locale.value).toBe('ru')
  })

  it('rehydrates a persisted locale choice on startup', () => {
    localStorage.setItem('BudgetTracker:locale', 'en')

    mountLocaleHarness()

    expect(i18n.global.locale.value).toBe('en')
  })

  it('switches the active locale immediately when the setting changes', async () => {
    const wrapper = mountLocaleHarness()
    const settings = useSettingsStore()

    settings.locale = 'en'
    await nextTick()

    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem('BudgetTracker:locale')).toBe('en')

    settings.locale = 'ru'
    await nextTick()

    expect(i18n.global.locale.value).toBe('ru')
    wrapper.unmount()
  })
})
