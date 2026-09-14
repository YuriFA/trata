import { DEFAULT_LOCALE, type AppLocale } from './locale'
import type { CurrencyCode } from '@trata/money'

export interface Settings {
  locale: AppLocale
  /**
   * `system` follows the OS `prefers-color-scheme` preference live
   * (bridged by `app/theme.ts`).
   */
  theme: 'light' | 'dark' | 'system'
  /**
   * Explicit display currency (multi-currency design D3): null = follow the
   * household's base currency. Per-device, never synchronized; presentation
   * only - it never rewrites stored amounts.
   */
  displayCurrency: CurrencyCode | null
}

export const DEFAULT_SETTINGS: Settings = {
  locale: DEFAULT_LOCALE,
  theme: 'light',
  displayCurrency: null,
}
