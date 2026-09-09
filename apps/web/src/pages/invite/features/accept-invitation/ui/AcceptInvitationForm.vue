<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HouseholdInvitationPreview } from '@trata/api'
import { Button } from '@/shared/ui/button'
import { emailLocalPart, getHouseholdErrorMessage, householdApi } from '@/entities/household'
import { useAuthStore } from '@/entities/session'
import { useHouseholdJoinStore, type HouseholdDataChoice } from '@/features/household-join'

// The invitation accept form (household-join design D6): household summary,
// the carry/clean choice (carry preselected, decided HERE - no second dialog
// after the join), and the accept button. The chosen option is applied
// directly through the shared household-join store (rebase/wipe + cache
// invalidation + sync run); navigation home is the caller's (page's) job.
const props = defineProps<{
  token: string
  preview: HouseholdInvitationPreview
}>()

const emit = defineEmits<{
  /** Accept succeeded and the local-data choice has been applied. */
  accepted: []
}>()

const { t } = useI18n()
const auth = useAuthStore()
const join = useHouseholdJoinStore()

const choice = ref<HouseholdDataChoice>('carry')
const isAccepting = ref(false)
const acceptError = ref<string | null>(null)

// The preview carries no member list; unset names fall back to the inviter's
// email prefix (the spec's "derived label from the owner's account").
const householdLabel = computed(
  () => props.preview.householdName ?? emailLocalPart(props.preview.inviterEmail),
)
const inviterLabel = computed(() => props.preview.inviterDisplayName ?? props.preview.inviterEmail)

async function accept(): Promise<void> {
  isAccepting.value = true
  acceptError.value = null
  try {
    // Make sure the client-side session state has caught up with the cookie
    // the preview used (idempotent - cached after the first restore).
    await auth.ensureRestored()
    const household = await householdApi.acceptInvitation(props.token)
    // The choice was made on this screen - apply it directly, no dialog.
    await join.applyHouseholdChoice(household, choice.value)
    emit('accepted')
  } catch (error) {
    acceptError.value = getHouseholdErrorMessage(error) ?? t('errors.generic')
  } finally {
    isAccepting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="invite-page-preview">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold" data-testid="invite-household-name">
        {{ householdLabel }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('household.invite.invitedBy', { name: inviterLabel }) }} ·
        {{ t('household.membersCount', preview.membersCount) }}
      </p>
    </div>

    <fieldset class="flex flex-col gap-2" :aria-label="t('household.choice.description')">
      <legend class="mb-1 text-sm font-medium">{{ t('household.choice.description') }}</legend>
      <label
        data-testid="invite-choice-carry"
        class="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
        :class="choice === 'carry' ? 'border-primary bg-primary/10' : 'border-border'"
      >
        <input v-model="choice" type="radio" value="carry" class="sr-only" />
        <span class="flex-1 space-y-0.5">
          <span class="block text-sm font-medium">{{ t('household.choice.carry') }}</span>
          <span class="block text-xs text-muted-foreground">
            {{ t('household.choice.carryHint') }}
          </span>
        </span>
      </label>
      <label
        data-testid="invite-choice-clean"
        class="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
        :class="choice === 'clean' ? 'border-primary bg-primary/10' : 'border-border'"
      >
        <input v-model="choice" type="radio" value="clean" class="sr-only" />
        <span class="flex-1 space-y-0.5">
          <span class="block text-sm font-medium">{{ t('household.choice.clean') }}</span>
          <span class="block text-xs text-muted-foreground">
            {{ t('household.choice.cleanHint') }}
          </span>
        </span>
      </label>
    </fieldset>

    <p v-if="acceptError" class="text-sm text-destructive">{{ acceptError }}</p>

    <Button data-testid="invite-accept-button" type="button" :loading="isAccepting" @click="accept">
      {{ t('household.invite.join') }}
    </Button>
  </div>
</template>
