<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter, useRoute } from 'vue-router'
import { computed } from 'vue'
import {
  ArrowLeftRight,
  CalendarClock,
  ChartPie,
  HandCoins,
  House,
  LogOut,
  Plus,
  Settings,
  Wallet,
} from '@lucide/vue'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { LogoMark } from '@/shared/ui/logo'
import { SyncStatusBadge } from '@/widgets/sync-status'
import { useAddTransactionDialog } from '@/features/transaction/add'
import { useAuthStore } from '@/entities/session'
import { isRouteActive } from '@/shared/lib/route-active'
import { notification } from '@/shared/services/notification'

const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const navItems = computed(() => [
  { to: '/', name: 'home', label: t('nav.dashboard'), icon: House },
  { to: '/transactions', name: 'transactions', label: t('nav.transactions'), icon: ArrowLeftRight },
  { to: '/analytics', name: 'analytics', label: t('nav.analytics'), icon: ChartPie },
  { to: '/debts', name: 'debts', label: t('nav.debts'), icon: HandCoins },
  { to: '/plans', name: 'plans', label: t('nav.plans'), icon: CalendarClock },
  { to: '/accounts', name: 'accounts', label: t('nav.accounts'), icon: Wallet },
  { to: '/settings', name: 'settings', label: t('nav.settings'), icon: Settings },
])

// Flat route records: analytics-detail keeps Аналитика active by name prefix.
const isActive = (name: string) => isRouteActive(route.name, name)

// The CTA is the primary desktop trigger of the single creation flow; the
// dialog itself lives in the app shell host (one instance per flow).
const { openAddTransactionDialog } = useAddTransactionDialog()

async function signOut() {
  await auth.logout()
  notification.success(t('auth.signedOut'))
  // Logout keeps local data and the anonymous mode usable: stay right here
  // instead of relocating to the login page.
}

function goToLogin() {
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex h-full flex-col gap-5 p-5">
    <!-- The logo doubles as a home link (canvas): the nav item below stays
         the primary "where am I" anchor, this is a shortcut on top. -->
    <RouterLink :to="{ path: '/' }" class="flex items-center gap-2.5" data-testid="sidebar-logo">
      <span
        class="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <LogoMark class="size-6" />
      </span>
      <span class="text-xl font-bold tracking-tight">{{ t('app.name') }}</span>
    </RouterLink>

    <nav class="flex flex-col gap-1 text-[15px]">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-md py-1.5 transition-colors"
        :class="
          isActive(item.name)
            ? 'font-semibold text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        "
        data-testid="sidebar-nav-link"
        @click="emit('navigate')"
      >
        <component :is="item.icon" class="size-4.5" aria-hidden="true" />
        <span
          class="relative"
          :class="
            isActive(item.name)
              ? 'after:absolute after:-bottom-0.5 after:inset-x-0 after:h-0.5 after:bg-primary'
              : ''
          "
        >
          {{ item.label }}
        </span>
      </RouterLink>
    </nav>

    <!-- Emphasis pass per the approved canvas (draft ec985bff): full-width
         pill with centered content. No inline hover hint - at w-62 the row
         cannot fit label + kbd, and the «N» accelerator is discoverable in
         the command palette. -->
    <Button
      size="lg"
      class="h-10 w-full px-4"
      data-testid="sidebar-add-operation"
      @click="openAddTransactionDialog()"
    >
      <Plus class="size-4" aria-hidden="true" />
      {{ t('dashboard.addOperation') }}
    </Button>

    <div
      v-if="auth.isAuthenticated"
      class="mt-auto flex flex-col gap-2.5 border-t border-sidebar-border pt-4"
    >
      <SyncStatusBadge class="w-fit" />
      <span class="truncate text-sm font-medium">{{ auth.user?.email }}</span>
      <Button
        variant="link"
        size="sm"
        class="w-fit gap-1.5 text-xs text-muted-foreground"
        @click="signOut"
      >
        <LogOut class="size-3.5" aria-hidden="true" />
        {{ t('auth.signOut') }}
      </Button>
    </div>

    <div v-else class="mt-auto flex flex-col gap-2.5 border-t border-sidebar-border pt-4">
      <!-- Mode indicator: offline (network failed restore, sign-in pending,
           will auto-retry) vs the ordinary anonymous local mode. -->
      <Badge
        variant="secondary"
        class="w-fit"
        :data-testid="auth.isOfflineMode ? 'offline-mode-indicator' : 'guest-mode-indicator'"
      >
        {{ auth.isOfflineMode ? t('auth.offlineMode') : t('auth.guestMode') }}
      </Badge>
      <Button
        variant="link"
        size="sm"
        class="w-fit text-xs text-muted-foreground"
        @click="goToLogin"
      >
        {{ t('auth.signIn') }}
      </Button>
    </div>
  </div>
</template>
