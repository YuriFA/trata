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
</script>

<template>
  <Select v-model="modelValue">
    <SelectTrigger
      :id="props.id"
      :class="props.class"
      :aria-label="t('fields.currency')"
      :aria-invalid="!!props.errors?.length"
    >
      <SelectValue :placeholder="props.placeholder ?? t('fields.currency')" />
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
