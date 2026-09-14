// The resolved display currency (multi-currency design D3): a per-device
// preference (settings store) over an injectable household-base source.
// The source is provided by the composition root (AppShell wires the
// auth-gated household read there - shared/store must not import entities);
// consumers anywhere inject it. Without a provider (standalone mounts,
// tests) the chains resolve without the household link.

import {
  computed,
  inject,
  provide,
  readonly,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
  toValue,
} from 'vue'
import { DEFAULT_CURRENCY, resolveDisplayCurrency, type CurrencyCode } from '@/shared/lib/money'
import { useSettingsStore } from './use-settings-store'

const HOUSEHOLD_BASE_KEY: InjectionKey<Readonly<Ref<CurrencyCode | null>>> =
  Symbol('household-base-currency')
const DISPLAY_CURRENCY_KEY: InjectionKey<Readonly<Ref<CurrencyCode>>> = Symbol('display-currency')

/**
 * Composition-root wiring: publishes the household-base source (null or
 * undefined = no household known: anonymous device, query still pending)
 * and provides both resolution chains down the tree. Returns the resolved
 * display currency.
 */
export function provideDisplayCurrency(
  householdBase: MaybeRefOrGetter<CurrencyCode | null | undefined>,
): ComputedRef<CurrencyCode> {
  const base = computed(() => toValue(householdBase) ?? null)
  provide(HOUSEHOLD_BASE_KEY, readonly(base))

  const settings = useSettingsStore()
  const displayCurrency = computed(() =>
    resolveDisplayCurrency(settings.displayCurrency, base.value),
  )
  provide(DISPLAY_CURRENCY_KEY, readonly(displayCurrency))
  return displayCurrency
}

/** The display currency all presentation converts into (reactive). */
export function useDisplayCurrency(): Readonly<Ref<CurrencyCode>> {
  const provided = inject(DISPLAY_CURRENCY_KEY)
  if (provided) return provided

  const settings = useSettingsStore()
  return computed(() => resolveDisplayCurrency(settings.displayCurrency, undefined))
}

/**
 * The household's base currency (null = none known): the preselect of the
 * account/debtor creation forms and the fallback link of the chain.
 */
function useHouseholdBaseCurrency(): Readonly<Ref<CurrencyCode | null>> {
  const provided = inject(HOUSEHOLD_BASE_KEY)
  if (provided) return provided
  // No provider (standalone mounts, tests): no household known.
  return readonly(computed(() => null))
}

/** The household base or the catalog default - the creation-form preselect. */
export function useDefaultCreationCurrency(): ComputedRef<CurrencyCode> {
  const base = useHouseholdBaseCurrency()
  return computed(() => base.value ?? DEFAULT_CURRENCY)
}
