<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Debtor } from '@/entities/debtor'
import {
  balanceInDirection,
  type DebtDirection,
  type DebtOperation,
} from '@/entities/debt-operation'
import { debtorHistoryGroups } from '../model/selectors'
import { useAuthorLabel } from '@/features/household-author'
import OperationFormDialog from './OperationFormDialog.vue'
import DebtorFormDialog from './DebtorFormDialog.vue'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { Pencil } from '@lucide/vue'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'

// Debtor history (debts capability): the debtor's operation history for one
// direction as full-bleed day bands with kind-titled rows (note as the meta
// line); the derived balance sits in the footer above the two actions. The
// shared responsive-dialog preserves the desktop dialog and switches to the
// mobile drawer presentation below 768px (web-screens mobile overlays).

const props = defineProps<{
  debtor: Debtor
  direction: DebtDirection
  operations: readonly DebtOperation[]
}>()

const open = defineModel<boolean>('open', { default: false })

const { t, locale } = useI18n()
const authorLabel = useAuthorLabel()
// Debts carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const directionLabel = computed(() =>
  props.direction === 'receivable' ? t('debts.receivable') : t('debts.payable'),
)
const balance = computed(() =>
  balanceInDirection(props.operations, props.debtor.id, props.direction),
)
const balanceText = computed(() => formatMoney(balance.value, displayCurrency.value, locale.value))
const groups = computed(() =>
  debtorHistoryGroups(props.operations, props.debtor.id, props.direction, locale.value),
)

const kindLabel = (operation: DebtOperation) =>
  operation.kind === 'debt' ? t('debts.debt') : t('debts.repayment')

const operationText = (operation: DebtOperation) =>
  `${operation.kind === 'debt' ? '+' : '−'}\u00A0${formatMoney(operation.amount, displayCurrency.value, locale.value)}`

// One dialog instance + active item refs (convention 4).
const operationOpen = ref(false)
const activeOperation = ref<DebtOperation | null>(null)
const createKind = ref<'debt' | 'repayment'>('debt')

const openCreate = (kind: 'debt' | 'repayment') => {
  createKind.value = kind
  activeOperation.value = null
  operationOpen.value = true
}

const openEdit = (operation: DebtOperation) => {
  activeOperation.value = operation
  operationOpen.value = true
}

const editDebtorOpen = ref(false)
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    class="sm:max-w-md"
    body-variant="flush"
    data-testid="debts-history-dialog"
  >
    <template #title>{{ debtor.name }}</template>
    <template #description>
      <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {{ directionLabel }}
      </p>
    </template>
    <template #header-actions>
      <Button
        variant="ghost"
        size="icon"
        :aria-label="t('debts.editContact')"
        data-testid="debts-history-edit-debtor"
        @click="editDebtorOpen = true"
      >
        <Pencil class="size-4" />
      </Button>
    </template>

    <div class="max-h-80 overflow-y-auto pt-4">
      <EmptyState v-if="groups.length === 0" :title="t('debts.historyEmpty')" />
      <div v-for="group in groups" :key="group.key" :data-testid="`debts-history-day-${group.key}`">
        <div class="border-y border-border bg-muted/50 px-6 py-2.5 first:border-t-0">
          <span class="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {{ group.title }}
          </span>
        </div>
        <div class="divide-y divide-border/60">
          <button
            v-for="operation in group.operations"
            :key="operation.id"
            type="button"
            class="flex w-full items-center justify-between gap-3 px-6 py-3.5 text-left transition-colors hover:bg-muted/40"
            :data-testid="`debts-history-op-${operation.id}`"
            @click="openEdit(operation)"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold">{{ kindLabel(operation) }}</span>
              <span
                v-if="operation.note || authorLabel(operation.authorId)"
                class="mt-0.5 block truncate text-[11px] text-muted-foreground"
              >
                {{ operation.note }}
                <span
                  v-if="authorLabel(operation.authorId)"
                  :data-testid="`debts-history-op-${operation.id}-author`"
                >
                  · {{ authorLabel(operation.authorId) }}
                </span>
              </span>
            </span>
            <span
              class="shrink-0 text-sm font-bold tabular-nums"
              :class="operation.kind === 'debt' ? 'text-success' : 'text-warning'"
            >
              {{ operationText(operation) }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full flex-col gap-4">
        <div class="flex w-full items-center justify-between">
          <span class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {{ t('debts.balance') }}
          </span>
          <span
            class="text-xl font-bold tabular-nums"
            :class="{ 'text-destructive': balance < 0 }"
            data-testid="debts-history-balance"
          >
            {{ balanceText }}
          </span>
        </div>
        <div class="grid w-full grid-cols-2 gap-3">
          <Button
            variant="secondary"
            data-testid="debts-new-repayment"
            @click="openCreate('repayment')"
          >
            {{ t('debts.repaymentAction') }}
          </Button>
          <Button data-testid="debts-new-operation" @click="openCreate('debt')">
            {{ t('debts.debtAction') }}
          </Button>
        </div>
      </div>
    </template>

    <OperationFormDialog
      v-if="operationOpen"
      :key="`${activeOperation?.id ?? 'create'}-${createKind}`"
      v-model:open="operationOpen"
      :debtor="debtor"
      :direction="direction"
      :operation="activeOperation"
      :operations="operations"
      :initial-kind="createKind"
    />

    <DebtorFormDialog
      v-if="editDebtorOpen"
      :key="debtor.id"
      v-model:open="editDebtorOpen"
      :debtor="debtor"
      @deleted="open = false"
    />
  </ResponsiveDialog>
</template>
