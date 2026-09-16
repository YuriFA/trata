<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ResponsiveAlertDialog } from '@/shared/ui/responsive-alert-dialog'
import { useAuthStore } from '../model/use-auth-store'

// The ownership gate's decision dialog (design D5): a different account
// signed in over local data owned by someone else. Mounted globally in the
// app shell; opens whenever the auth store parks a pending gate.
const { t } = useI18n()
const auth = useAuthStore()
const { pendingGate } = storeToRefs(auth)
</script>

<template>
  <ResponsiveAlertDialog
    :open="pendingGate !== null"
    :title="t('auth.ownershipGate.title')"
    :description="t('auth.ownershipGate.description')"
    :confirm-label="t('auth.ownershipGate.delete')"
    :cancel-label="t('auth.ownershipGate.cancel')"
    content-test-id="ownership-gate-dialog"
    confirm-test-id="ownership-gate-delete"
    cancel-test-id="ownership-gate-cancel"
    @cancel="auth.cancelOwnershipGate()"
    @confirm="auth.confirmOwnershipGateDelete()"
  />
</template>
