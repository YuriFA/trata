<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/shared/ui/button'
import { SettingsCard } from '@/shared/ui/settings-card'
import { APP_VERSION } from '@/shared/config/app-version'
import { useAppInfo } from '../model/use-app-info'

// About-app card (change `web-app-info`): the build versions (web always,
// API as a best-effort muted line) and the honest update status - surfaced
// from the same waiting-worker signal that fires the toast (web-pwa).
const { t } = useI18n()
const { apiVersion, status, checkForUpdates, applyUpdate } = useAppInfo()

// The update section renders once there is something to say (a check
// resolved or an update is waiting); `hidden`/`idle` render neither status
// nor actions.
const updateUiVisible = computed(() => status.value !== 'hidden' && status.value !== 'idle')

// Labels resolve in script over static keys - the strict i18n lint bans
// computed keys inside templates.
const statusText = computed(() => {
  if (status.value === 'update-available') return t('common.updateAvailable')
  if (status.value === 'up-to-date') return t('settings.upToDate')
  if (status.value === 'failed') return t('settings.checkFailed')
  return null
})

const checkButtonLabel = computed(() =>
  status.value === 'failed' ? t('common.errorState.retry') : t('settings.checkForUpdates'),
)
</script>

<template>
  <SettingsCard :title="t('settings.about')" data-testid="settings-app-info-card">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 flex-col gap-1">
        <p class="text-sm font-semibold" data-testid="settings-app-version">
          {{ t('settings.version') }}: {{ APP_VERSION }}
        </p>
        <p
          v-if="apiVersion"
          class="text-xs text-muted-foreground"
          data-testid="settings-api-version"
        >
          {{ t('settings.apiVersion') }}: {{ apiVersion }}
        </p>
        <p
          v-if="statusText"
          class="text-xs font-medium"
          :class="status === 'update-available' ? 'text-primary' : 'text-muted-foreground'"
          data-testid="settings-update-status"
        >
          {{ statusText }}
        </p>
      </div>
      <div v-if="updateUiVisible" class="flex shrink-0 items-center gap-2">
        <Button
          v-if="status === 'update-available'"
          size="sm"
          data-testid="settings-apply-update"
          @click="applyUpdate"
        >
          {{ t('common.updateNow') }}
        </Button>
        <Button
          v-else
          variant="ghost"
          size="sm"
          :loading="status === 'checking'"
          :disabled="status === 'checking'"
          data-testid="settings-check-updates"
          @click="checkForUpdates"
        >
          {{ checkButtonLabel }}
        </Button>
      </div>
    </div>
  </SettingsCard>
</template>
