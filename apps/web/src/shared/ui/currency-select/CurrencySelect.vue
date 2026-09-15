<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { getCurrencyOptions } from '@/shared/lib/money'
import type { CurrencyCode } from '@/shared/lib/money'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

// The 18-currency catalog picker (multi-currency, the accounts-mc mockup):
// «TRY · ₼» composite label with the localized name muted. Used by the
// account and debtor creation forms and both settings selectors.
const modelValue = defineModel<CurrencyCode | undefined>()

const props = withDefaults(
  defineProps<{
    id?: string
    errors?: string[]
    placeholder?: string
    class?: string
  }>(),
  {
    id: 'currency',
    errors: undefined,
    placeholder: undefined,
    class: undefined,
  },
)

const { t } = useI18n()
const options = computed(() => getCurrencyOptions())
// The trigger slot must resolve the selected label itself: reka's SelectValue
// fallback renders the option's textContent, which concatenates the label and
// name spans with no whitespace («RUB · ₽Российский рубль»). Same constraint
// as CategorySelect/AccountSelect.
const selectedOption = computed(() =>
  options.value.find((option) => option.value === modelValue.value),
)
</script>

<template>
  <Select v-model="modelValue">
    <SelectTrigger
      :id="props.id"
      :class="props.class"
      :aria-label="t('fields.currency')"
      :aria-invalid="!!props.errors?.length"
    >
      <SelectValue :placeholder="props.placeholder ?? t('fields.currency')">
        <template v-if="selectedOption">
          <span class="font-semibold">{{ selectedOption.label }}</span>
          <span class="text-muted-foreground">{{ selectedOption.name }}</span>
        </template>
        <template v-else>{{ props.placeholder ?? t('fields.currency') }}</template>
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in options" :key="option.value" :value="option.value">
        <span class="flex items-center gap-2">
          <span class="font-semibold">{{ option.label }}</span>
          <span class="text-muted-foreground">{{ option.name }}</span>
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
