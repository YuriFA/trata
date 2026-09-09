<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus } from '@lucide/vue'
import type { Debtor } from '@trata/api'
import type { DebtDirection, DebtOperation } from '@/entities/debt-operation'
import { debtorSection } from '../model/selectors'
import DebtorRow from './DebtorRow.vue'

// One direction's section of the composite debts card: eyebrow header with
// the direction-tinted «add» pill, full-bleed debtor rows, and settled
// (zero-balance) debtors behind a reveal.

const props = defineProps<{
  direction: DebtDirection
  debtors: readonly Debtor[]
  operations: readonly DebtOperation[]
}>()

const emit = defineEmits<{
  add: [direction: DebtDirection]
  select: [debtor: Debtor, direction: DebtDirection]
}>()

const { t } = useI18n()

const section = computed(() => debtorSection(props.debtors, props.operations, props.direction))

const title = computed(() =>
  props.direction === 'receivable' ? t('debts.receivable') : t('debts.payable'),
)
const addTitle = computed(() =>
  props.direction === 'receivable' ? t('debts.receivableAddTitle') : t('debts.payableAddTitle'),
)
const emptyText = computed(() =>
  props.direction === 'receivable' ? t('debts.receivableEmpty') : t('debts.payableEmpty'),
)

const showSettled = ref(false)
</script>

<template>
  <section>
    <div class="flex items-center justify-between border-b border-border px-4 py-4 md:px-6">
      <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">{{ title }}</h2>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors"
        :class="
          direction === 'receivable'
            ? 'text-primary hover:bg-accent'
            : 'text-warning hover:bg-warning/10'
        "
        :aria-label="addTitle"
        :data-testid="`debts-section-add-${direction}`"
        @click="emit('add', direction)"
      >
        <Plus class="size-3.5" aria-hidden="true" />
        {{ t('debts.add') }}
      </button>
    </div>

    <p
      v-if="section.visible.length === 0 && section.settled.length === 0"
      class="px-4 py-4 text-sm text-muted-foreground md:px-6"
    >
      {{ emptyText }}
    </p>
    <DebtorRow
      v-for="view in section.visible"
      :key="view.debtor.id"
      :debtor="view.debtor"
      :balance="view.balance"
      :direction="direction"
      :operations="operations"
      @click="emit('select', view.debtor, direction)"
    />
    <button
      v-if="section.settled.length > 0"
      type="button"
      class="w-full px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:underline md:px-6"
      :data-testid="`debts-settled-reveal-${direction}`"
      @click="showSettled = !showSettled"
    >
      {{
        showSettled
          ? t('debts.hideSettled')
          : t('debts.showSettled', { count: section.settled.length })
      }}
    </button>
    <template v-if="showSettled">
      <DebtorRow
        v-for="view in section.settled"
        :key="view.debtor.id"
        :debtor="view.debtor"
        :balance="view.balance"
        :direction="direction"
        :operations="operations"
        @click="emit('select', view.debtor, direction)"
      />
    </template>
  </section>
</template>
