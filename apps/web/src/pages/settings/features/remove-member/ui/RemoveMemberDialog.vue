<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ResponsiveAlertDialog } from '@/shared/ui/responsive-alert-dialog'
import { getHouseholdErrorMessage, useHouseholdActions } from '@/entities/household'
import { notification } from '@/shared/services/notification'
import type { HouseholdMember } from '@trata/api'

// Remove-member confirm (household-ux 3.2, owner only). One instance outside
// the members loop; the page passes the member to act on (vue-patterns §4).
const { t } = useI18n()
const actions = useHouseholdActions()

const props = defineProps<{ member: HouseholdMember | null }>()
const emit = defineEmits<{ settled: [] }>()
const open = defineModel<boolean>({ default: false })

async function handleConfirm(): Promise<void> {
  if (!props.member) return
  try {
    await actions.removeMember.mutateAsync(props.member.userId)
    open.value = false
  } catch (error) {
    const mapped = getHouseholdErrorMessage(error)
    if (mapped) notification.error(mapped, { feature: 'household', action: 'remove-member' })
    else
      notification.mutationError(error, {
        title: t('household.removeMemberTitle'),
        feature: 'household',
        action: 'remove-member',
      })
  } finally {
    emit('settled')
  }
}
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :title="t('household.removeMemberTitle')"
    :description="
      t('household.removeMemberDescription', {
        name: member ? (member.displayName ?? member.email) : '',
      })
    "
    :confirm-label="t('household.removeMemberConfirm')"
    :cancel-label="t('household.cancel')"
    :loading="actions.removeMember.isLoading.value"
    confirm-test-id="household-remove-member-confirm"
    cancel-test-id="household-remove-member-cancel"
    @confirm="handleConfirm"
  />
</template>
