<script setup lang="ts">
import { Trash2Icon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useDeleteTransaction } from '@/entities/transaction'
import { notification } from '@/shared/services/notification'
import { ResponsiveAlertDialog } from '@/shared/ui/responsive-alert-dialog'

const { transactionId } = defineProps<{
  transactionId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { mutateAsync: deleteTransaction, asyncStatus } = useDeleteTransaction()

const handleConfirm = async () => {
  try {
    await deleteTransaction(transactionId)
    notification.success(t('deleteTransaction.success'))
  } catch (error) {
    notification.mutationError(error, {
      title: t('deleteTransaction.error'),
      feature: 'transaction',
      action: 'delete',
    })
  } finally {
    open.value = false
  }
}
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :icon="Trash2Icon"
    :title="t('deleteTransaction.confirmDelete')"
    :description="t('deleteTransaction.confirmDeleteDescription')"
    :confirm-label="t('deleteTransaction.confirm')"
    :cancel-label="t('deleteTransaction.cancel')"
    :loading="asyncStatus === 'loading'"
    confirm-test-id="delete-transaction-confirm"
    cancel-test-id="delete-transaction-cancel"
    @confirm="handleConfirm"
  />
</template>
