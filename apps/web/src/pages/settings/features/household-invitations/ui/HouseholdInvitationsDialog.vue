<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQueryCache } from '@pinia/colada'
import { Button } from '@/shared/ui/button'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Badge } from '@/shared/ui/badge'
import {
  getHouseholdErrorMessage,
  householdApi,
  useHouseholdInvitations,
} from '@/entities/household'
import { notification } from '@/shared/services/notification'
import type { ErrorAction } from '@/shared/services/notification'
import type { HouseholdInvitation } from '@trata/api'

// Outgoing invitations (household-ux 3.2, owner only): the household's
// invitations with status chips and the resend (re-invite refreshes the
// token/expiry) / revoke actions. Mirrors the mobile invitations sheet.
const { t, locale } = useI18n()
const queryCache = useQueryCache()

// The dialog only mounts for the owner, so the listing runs unconditionally.
const invitationsQuery = useHouseholdInvitations()
const invitations = computed(() => invitationsQuery.data.value ?? [])
// Reactive "no data yet" - a background refetch keeps the rendered list.
const isPending = computed(() => invitationsQuery.isPending.value)

const open = ref(false)

// The label resolves in script over static keys - the strict i18n lint
// bans computed keys inside templates.
const statusLabel = (status: HouseholdInvitation['status']): string => {
  switch (status) {
    case 'accepted':
      return t('household.invitationStatus.accepted')
    case 'revoked':
      return t('household.invitationStatus.revoked')
    case 'expired':
      return t('household.invitationStatus.expired')
    default:
      return t('household.invitationStatus.pending')
  }
}

// Same expiry formatting as the sessions card on the settings page.
const expiryFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)
const formatExpiry = (iso: string) => expiryFormatter.value.format(new Date(iso))

async function handleResend(email: string): Promise<void> {
  try {
    await householdApi.invite(email)
    notification.success(t('household.inviteSuccess', { email }))
    queryCache.invalidateQueries({ key: ['household'] })
  } catch (error) {
    notifyError(error, 'resend-invitation')
  }
}

async function handleRevoke(invitationId: string): Promise<void> {
  try {
    await householdApi.revokeInvitation(invitationId)
    queryCache.invalidateQueries({ key: ['household'] })
  } catch (error) {
    notifyError(error, 'revoke-invitation')
  }
}

function notifyError(error: unknown, action: ErrorAction): void {
  const mapped = getHouseholdErrorMessage(error)
  if (mapped) notification.error(mapped, { feature: 'household', action })
  else
    notification.mutationError(error, {
      title: t('household.invitationsTitle'),
      feature: 'household',
      action,
    })
}
</script>

<template>
  <Button variant="secondary" data-testid="household-invitations-button" @click="open = true">
    {{ t('household.invitationsTitle') }}
  </Button>

  <ResponsiveDialog v-model:open="open">
    <template #title>{{ t('household.invitationsTitle') }}</template>
    <div class="flex flex-col gap-3">
      <p v-if="isPending" class="text-sm text-muted-foreground">
        {{ t('household.loadingInvitations') }}
      </p>
      <p v-else-if="!invitations.length" class="text-sm text-muted-foreground">
        {{ t('household.invitationsEmpty') }}
      </p>
      <ul v-else class="flex flex-col gap-3 text-sm">
        <li
          v-for="invitation in invitations"
          :key="invitation.id"
          class="flex flex-col gap-1 border-b border-b-muted pb-3 last:border-0 last:pb-0"
          :data-testid="`household-invitation-${invitation.id}`"
        >
          <div class="flex items-center gap-2">
            <span class="flex-1">{{ invitation.email }}</span>
            <Badge variant="outline" :data-testid="`household-invitation-${invitation.id}-status`">
              {{ statusLabel(invitation.status) }}
            </Badge>
          </div>
          <span class="text-xs text-muted-foreground">
            {{ t('household.invitationExpiresAt', { date: formatExpiry(invitation.expiresAt) }) }}
          </span>
          <div v-if="invitation.status === 'pending'" class="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              :data-testid="`household-invitation-${invitation.id}-resend`"
              @click="handleResend(invitation.email)"
            >
              {{ t('household.resendInvitation') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :data-testid="`household-invitation-${invitation.id}-revoke`"
              @click="handleRevoke(invitation.id)"
            >
              {{ t('household.revokeInvitation') }}
            </Button>
          </div>
        </li>
      </ul>
    </div>
  </ResponsiveDialog>
</template>
