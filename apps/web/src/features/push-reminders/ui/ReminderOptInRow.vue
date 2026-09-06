<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BellRing } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { usePushReminders } from '../model/use-push-reminders'

// The device-level reminder opt-in (web-push change, ADR-0007): an
// unobtrusive row shown where reminders are visible (plans screen,
// dashboard attention card) whenever the household has plans with
// reminders enabled but this device has no push subscription. In a
// regular browser tab it degrades to the install hint - push permission
// is only grantable inside an installed PWA (iOS Safari alike).

const { t } = useI18n()
const { state, showOptIn, enabling, enable } = usePushReminders()

const handleEnable = () => {
  void enable()
}
</script>

<template>
  <div
    v-if="showOptIn"
    class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"
    data-testid="push-reminders-opt-in"
  >
    <span class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <BellRing class="size-4 shrink-0" aria-hidden="true" />
      <span v-if="state.standalone">{{ t('pushReminders.optIn') }}</span>
      <span v-else>{{ t('pushReminders.installHint') }}</span>
    </span>
    <Button
      v-if="state.standalone"
      variant="outline"
      size="sm"
      class="h-7 rounded-full px-3 text-xs font-semibold"
      :disabled="enabling"
      data-testid="push-reminders-opt-in-button"
      @click="handleEnable"
    >
      {{ enabling ? t('pushReminders.enabling') : t('pushReminders.enable') }}
    </Button>
  </div>
  <p v-else-if="state.error" class="text-xs text-destructive" data-testid="push-reminders-error">
    {{ t('pushReminders.error') }}
  </p>
</template>
