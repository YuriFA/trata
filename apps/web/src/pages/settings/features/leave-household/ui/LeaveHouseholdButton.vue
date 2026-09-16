<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Button } from '@/shared/ui/button'
import { ResponsiveAlertDialog } from '@/shared/ui/responsive-alert-dialog'
import { getHouseholdErrorMessage, householdApi } from '@/entities/household'
import { useHouseholdJoinStore } from '@/features/household-join'
import { notification } from '@/shared/services/notification'

// Leave flow (household-ux 3.3): a destructive confirm, then a CLEAN START
// for the fresh personal household the backend created - the carry/clean
// choice is deliberately not offered (design D5): contributions stay with
// the household per ADR-0002, so carrying would per-item fail. Then home.
// HOUSEHOLD_OWNER_WITH_MEMBERS (owner cannot abandon members) surfaces its
// own localized message.
const { t } = useI18n()
const router = useRouter()
const join = useHouseholdJoinStore()

const open = ref(false)
const leaving = ref(false)

async function handleConfirm(): Promise<void> {
  leaving.value = true
  try {
    const household = await householdApi.leave()
    notification.success(t('household.leaveSuccess'))
    open.value = false
    await join.applyHouseholdChoice(household, 'clean')
    await router.push({ name: 'home' })
  } catch (error) {
    const mapped = getHouseholdErrorMessage(error)
    if (mapped) {
      notification.error(mapped, { feature: 'household', action: 'leave' })
    } else {
      notification.mutationError(error, {
        title: t('household.leave'),
        feature: 'household',
        action: 'leave',
      })
    }
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <Button variant="destructive" data-testid="household-leave-button" @click="open = true">
    {{ t('household.leave') }}
  </Button>

  <ResponsiveAlertDialog
    v-model:open="open"
    :title="t('household.leaveTitle')"
    :description="t('household.leaveDescription')"
    :confirm-label="t('household.leave')"
    :cancel-label="t('household.cancel')"
    :loading="leaving"
    confirm-test-id="household-leave-confirm"
    cancel-test-id="household-leave-cancel"
    @confirm="handleConfirm"
  />
</template>
