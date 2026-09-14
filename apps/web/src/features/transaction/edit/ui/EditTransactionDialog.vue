<script setup lang="ts">
import { computed } from 'vue'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { useI18n } from 'vue-i18n'
import {
  isAdjustmentTransaction,
  isTransferTransaction,
  type AdjustmentTransaction,
  type CashflowTransaction,
  type Transaction,
  type TransferTransaction,
} from '@/entities/transaction'
import { authorLabel, useHousehold } from '@/entities/household'
import { useAuthStore } from '@/entities/session'
import AdjustmentEditForm from './AdjustmentEditForm.vue'
import CashflowEditForm from './CashflowEditForm.vue'
import TransferEditForm from './TransferEditForm.vue'

const { transaction } = defineProps<{
  transaction: Transaction
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const isTransfer = computed(() => isTransferTransaction(transaction))
const isAdjustment = computed(() => isAdjustmentTransaction(transaction))
const adjustment = computed(() =>
  isAdjustment.value ? (transaction as AdjustmentTransaction) : null,
)
const cashflow = computed(() =>
  !isTransfer.value && !isAdjustment.value ? (transaction as CashflowTransaction) : null,
)
const transfer = computed(() => (isTransfer.value ? (transaction as TransferTransaction) : null))

// The detail's provenance line (household-ux 3.4): unlike the compact row
// markers, the detail shows who created the record even alone in the
// household («вами») - provenance, not collaboration (design D2).
const auth = useAuthStore()
const householdQuery = useHousehold({ enabled: () => auth.isAuthenticated })
const author = computed(() => {
  if (!auth.isAuthenticated) return null
  return authorLabel(
    transaction.authorId,
    householdQuery.data.value?.members ?? [],
    auth.user?.id,
    {
      selfLabel: t('household.authorSelf'),
      includeSingleMember: true,
    },
  )
})

const handleSuccess = () => {
  open.value = false
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-[400px]">
    <template #title>{{ t('editTransaction.title') }}</template>
    <template #description>
      <p
        v-if="author"
        class="text-xs text-muted-foreground"
        :data-testid="`edit-transaction-author-${transaction.id}`"
      >
        {{ t('household.authoredBy', { name: author }) }}
      </p>
    </template>

    <TransferEditForm
      v-if="transfer"
      :id="transfer.id"
      :version="transfer.version"
      :amount="transfer.amount"
      :destination-amount="transfer.destinationAmount"
      :description="transfer.description ?? ''"
      :from-account-id="transfer.fromAccountId"
      :to-account-id="transfer.toAccountId"
      @success="handleSuccess"
    />
    <AdjustmentEditForm
      v-else-if="adjustment"
      :id="adjustment.id"
      :version="adjustment.version"
      :amount="adjustment.amount"
      :description="adjustment.description ?? ''"
      :account-id="adjustment.accountId"
      @success="handleSuccess"
    />
    <CashflowEditForm
      v-else-if="cashflow"
      :id="cashflow.id"
      :version="cashflow.version"
      :type="cashflow.type"
      :amount="cashflow.amount"
      :description="cashflow.description ?? ''"
      :account-id="cashflow.accountId"
      :category-id="cashflow.categoryId"
      @success="handleSuccess"
    />
  </ResponsiveDialog>
</template>
