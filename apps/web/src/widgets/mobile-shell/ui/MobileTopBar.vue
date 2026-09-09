<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { CloudOffIcon } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { LogoMark } from '@/shared/ui/logo'
import { useAuthStore } from '@/entities/session'
import UserMenu from './UserMenu.vue'

// Slim sticky shell header (web-screens: mobile top bar account access).
// The sync badge and the guest indicator keep their testids and render only
// here (mobile) or in the sidebar footer (desktop) - one instance per
// viewport, guaranteed by the AppShell JS gate.
const { t } = useI18n()
const auth = useAuthStore()
</script>

<template>
  <header
    class="bg-background/90 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur"
  >
    <RouterLink :to="{ path: '/' }" class="flex items-center gap-2">
      <span
        class="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <LogoMark class="size-5.25" />
      </span>
      <span class="text-[17px] font-semibold">{{ t('app.name') }}</span>
    </RouterLink>

    <div class="ml-auto flex items-center gap-1.5">
      <slot name="status" />
      <UserMenu v-if="auth.isAuthenticated" />
      <template v-else>
        <!-- Mode indicator: offline (network failed restore, sign-in pending,
             will auto-retry) vs the ordinary anonymous local mode. -->
        <span
          class="inline-flex h-7 items-center gap-1 rounded-full bg-accent pr-2.5 pl-2 text-[11px] font-semibold text-accent-foreground"
          :data-testid="auth.isOfflineMode ? 'offline-mode-indicator' : 'guest-mode-indicator'"
        >
          <CloudOffIcon class="size-3" aria-hidden="true" />
          {{ auth.isOfflineMode ? t('auth.offlineModeShort') : t('auth.guestModeShort') }}
        </span>
        <Button as-child size="sm" data-testid="topbar-sign-in">
          <RouterLink :to="{ name: 'login' }">{{ t('shell.signIn') }}</RouterLink>
        </Button>
      </template>
    </div>
  </header>
</template>
