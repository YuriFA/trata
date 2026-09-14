<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_CURRENCY, type CurrencyCode } from '@/shared/lib/money'
import { CurrencySelect } from '@/shared/ui/currency-select'
import { Button } from '@/shared/ui/button'
import { Field, FieldLabel } from '@/shared/ui/field'
import { notification } from '@/shared/services/notification'
import { APP_NAME } from '@/shared/config/app'
import { getHouseholdErrorMessage, useHouseholdActions } from '@/entities/household'
import { localeCurrency } from '../model/locale-currency'

// The owner's household base-currency editor (multi-currency 5.5): changing
// the base never rewrites stored records - it moves the presentation
// conversion target only. The one-time locale suggestion lives here too: a
// device whose locale maps to a catalog currency other than the
// server-default RUB gets exactly one proposal per device (dismissed or
// acted-on writes the flag; the suggestion never blocks any flow).

const props = defineProps<{
  currency: CurrencyCode
}>()

const { t } = useI18n()
const actions = useHouseholdActions()

const selected = ref<CurrencyCode>(props.currency)

async function handleChange(value: CurrencyCode): Promise<void> {
  const previous = selected.value
  selected.value = value
  try {
    await actions.setBaseCurrency.mutateAsync(value)
  } catch (error) {
    selected.value = previous
    const mapped = getHouseholdErrorMessage(error)
    if (mapped) notification.error(mapped, { feature: 'household', action: 'update' })
    else
      notification.mutationError(error, {
        title: t('household.baseCurrency'),
        feature: 'household',
        action: 'update',
      })
  }
}

// --- One-time locale suggestion ---------------------------------------------
const SUGGESTION_STORAGE_KEY = `${APP_NAME}:base-currency-suggestion`

const suggested = computed(() => {
  if (props.currency !== DEFAULT_CURRENCY) return null
  const candidate = localeCurrency(navigator.language)
  return candidate && candidate !== DEFAULT_CURRENCY ? candidate : null
})
const dismissed = ref(localStorage.getItem(SUGGESTION_STORAGE_KEY) !== null)
const suggestionVisible = computed(() => suggested.value !== null && !dismissed.value)

function dismissSuggestion(): void {
  localStorage.setItem(SUGGESTION_STORAGE_KEY, String(suggested.value))
  dismissed.value = true
}

async function acceptSuggestion(): Promise<void> {
  const candidate = suggested.value
  if (!candidate) return
  dismissSuggestion()
  await handleChange(candidate)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Field>
      <FieldLabel for="household-base-currency">{{ t('household.baseCurrency') }}</FieldLabel>
      <CurrencySelect
        id="household-base-currency"
        class="w-full shrink-0 sm:w-56"
        :model-value="selected"
        data-testid="settings-base-currency-select"
        @update:model-value="(v) => v && handleChange(v)"
      />
      <p class="text-xs text-muted-foreground">
        {{ t('household.baseCurrencyDescription') }}
      </p>
    </Field>

    <div
      v-if="suggestionVisible"
      class="flex flex-col gap-2 rounded-lg border border-border bg-accent px-4 py-3"
      data-testid="settings-base-currency-suggestion"
    >
      <p class="text-sm">{{ t('household.suggestBaseCurrency', { currency: suggested }) }}</p>
      <div class="flex flex-wrap gap-2">
        <Button
          size="sm"
          data-testid="settings-base-currency-suggest-accept"
          @click="acceptSuggestion"
        >
          {{ t('household.suggestBaseCurrencyAccept') }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="settings-base-currency-suggest-dismiss"
          @click="dismissSuggestion"
        >
          {{ t('household.suggestBaseCurrencyDismiss') }}
        </Button>
      </div>
    </div>
  </div>
</template>
