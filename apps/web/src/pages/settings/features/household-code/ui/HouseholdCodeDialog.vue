<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ResponsiveAlertDialog } from '@/shared/ui/responsive-alert-dialog'
import { Button } from '@/shared/ui/button'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { getHouseholdErrorMessage, useHouseholdActions } from '@/entities/household'
import { notification } from '@/shared/services/notification'
import type { HouseholdCode } from '@trata/api'

// The home-code panel (household-ux 3.2, owner only). The API offers no read
// for an existing code - only generate/rotate and revoke - so the panel starts
// empty («код не создан») and Create/Rotate produce the current code, with a
// copy button and a rotate confirm. Mirrors the mobile code sheet.
const { t } = useI18n()
const actions = useHouseholdActions()

const open = ref(false)
const rotateConfirmOpen = ref(false)
// The code is only knowable by generating it; null = none created here.
const code = ref<HouseholdCode | null>(null)

async function handleGenerate(): Promise<void> {
  try {
    code.value = await actions.generateCode.mutateAsync(undefined)
  } catch (error) {
    const mapped = getHouseholdErrorMessage(error)
    if (mapped) notification.error(mapped, { feature: 'household', action: 'generate-code' })
    else
      notification.mutationError(error, {
        title: t('household.codePanelTitle'),
        feature: 'household',
        action: 'generate-code',
      })
  }
}

async function handleCopy(): Promise<void> {
  if (!code.value) return
  await navigator.clipboard.writeText(code.value.code)
  notification.success(t('household.codeCopied'))
}

async function handleRevoke(): Promise<void> {
  try {
    await actions.revokeCode.mutateAsync(undefined)
    code.value = null
  } catch (error) {
    const mapped = getHouseholdErrorMessage(error)
    if (mapped) notification.error(mapped, { feature: 'household', action: 'revoke-code' })
    else
      notification.mutationError(error, {
        title: t('household.codePanelTitle'),
        feature: 'household',
        action: 'revoke-code',
      })
  }
}
</script>

<template>
  <Button variant="secondary" data-testid="household-code-button" @click="open = true">
    {{ t('household.codePanelTitle') }}
  </Button>

  <ResponsiveDialog v-model:open="open">
    <template #title>{{ t('household.codePanelTitle') }}</template>
    <div class="flex flex-col gap-4">
      <p
        v-if="code"
        class="text-center font-mono text-2xl tracking-[0.3em] select-all"
        data-testid="household-code-value"
      >
        {{ code.code }}
      </p>
      <p v-else class="text-sm text-muted-foreground" data-testid="household-code-none">
        {{ t('household.codeNone') }}
      </p>
    </div>

    <template #footer>
      <div class="flex flex-wrap gap-2">
        <template v-if="code">
          <Button variant="secondary" data-testid="household-code-copy" @click="handleCopy">
            {{ t('household.codeCopy') }}
          </Button>
          <Button
            variant="secondary"
            :loading="actions.generateCode.isLoading.value"
            data-testid="household-code-rotate"
            @click="rotateConfirmOpen = true"
          >
            {{ t('household.codeRotate') }}
          </Button>
          <Button
            variant="ghost"
            :loading="actions.revokeCode.isLoading.value"
            data-testid="household-code-revoke"
            @click="handleRevoke"
          >
            {{ t('household.codeRevoke') }}
          </Button>
        </template>
        <Button
          v-else
          :loading="actions.generateCode.isLoading.value"
          data-testid="household-code-generate"
          @click="handleGenerate"
        >
          {{ t('household.codeGenerate') }}
        </Button>
      </div>
    </template>

    <ResponsiveAlertDialog
      v-model:open="rotateConfirmOpen"
      :title="t('household.codeRotateConfirmTitle')"
      :description="t('household.codeRotateConfirmDescription')"
      :confirm-label="t('household.codeRotate')"
      :cancel-label="t('household.cancel')"
      :loading="actions.generateCode.isLoading.value"
      confirm-test-id="household-code-rotate-confirm"
      cancel-test-id="household-code-rotate-cancel"
      @confirm="handleGenerate"
    />
  </ResponsiveDialog>
</template>
