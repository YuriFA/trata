<script setup lang="ts">
import { Trash2Icon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useDeleteAccount } from '@/entities/account'
import { notification } from '@/shared/services/notification'
import { ResponsiveAlertDialog } from '@/shared/ui/responsive-alert-dialog'

const { accountId } = defineProps<{
  accountId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { mutateAsync: deleteAccount, asyncStatus } = useDeleteAccount()

const handleConfirm = async () => {
  try {
    await deleteAccount(accountId)
    notification.success(t('deleteAccount.success'))
  } catch (error) {
    notification.mutationError(error, {
      title: t('deleteAccount.error'),
      feature: 'account',
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
    :title="t('deleteAccount.confirmDelete')"
    :description="t('deleteAccount.confirmDeleteDescription')"
    :confirm-label="t('deleteAccount.confirm')"
    :cancel-label="t('deleteAccount.cancel')"
    :loading="asyncStatus === 'loading'"
    confirm-test-id="delete-account-confirm"
    cancel-test-id="delete-account-cancel"
    @confirm="handleConfirm"
  />
</template>
