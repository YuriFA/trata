<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { capitalizeFirstLetter } from '@/shared/lib/capitalize'
import { useSettingsStore } from '@/shared/store/use-settings-store'
import type { Settings } from '@/shared/config/settings'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { PageHeader } from '@/shared/ui/page-header'
import { SettingsCard } from '@/shared/ui/settings-card'
import { Skeleton } from '@/shared/ui/skeleton'
import { ChevronRight, Database, Tags } from '@lucide/vue'
import { useAuthStore, sessionApi } from '@/entities/session'
import { householdDisplayName, memberLabel, useHousehold } from '@/entities/household'
import { AppInfoCard } from '../features/app-info'
import { DissolveHouseholdDialog } from '../features/dissolve-household'
import { DisplayNameEditor } from '../features/display-name'
import { HouseholdCodeDialog } from '../features/household-code'
import { HouseholdInvitationsDialog } from '../features/household-invitations'
import { InviteMemberDialog } from '../features/invite-member'
import { JoinHouseholdDialog } from '../features/join-household'
import { LeaveHouseholdButton } from '../features/leave-household'
import { RemoveMemberDialog } from '../features/remove-member'
import { RenameHouseholdDialog } from '../features/rename-household'
import { notification } from '@/shared/services/notification'
import type { Session } from '@/entities/session'
import type { HouseholdMember } from '@expense-tracker/api'

const { t, locale, availableLocales } = useI18n()
const settings = useSettingsStore()
const auth = useAuthStore()

// Event-handler sync (vue-patterns): the handler only writes the store; the
// DOM bridge is owned by the app-level theme watcher (setup-theme-watcher),
// so this page never imports the app layer.
const onThemeChange = (value: unknown) => {
  settings.theme = value as Settings['theme']
}

const themes = computed(() => [
  { value: 'light' as const, label: t('settings.themeLight') },
  { value: 'dark' as const, label: t('settings.themeDark') },
  { value: 'system' as const, label: t('settings.themeSystem') },
])

const locales = computed(() => {
  const displayNames = new Intl.DisplayNames(locale.value, { type: 'language' })

  return availableLocales.map((value) => ({
    id: value,
    label: capitalizeFirstLetter(displayNames.of(value) ?? ''),
  }))
})

// --- Session management ----------------------------------------------------
const sessions = ref<Session[]>([])
const sessionsLoading = ref(false)
const revoking = ref(false)

// --- Household (household-ux 3.1) -------------------------------------------
// Control-plane read over the API (not synced data): display name (owner
// email prefix fallback), the member list (label/email, role, joined date),
// and role-aware actions. Owner-only actions are hidden, not disabled; the
// owner cannot leave while other members remain (the backend rejects it).
const householdQuery = useHousehold({ enabled: () => auth.isAuthenticated })
const household = computed(() => householdQuery.data.value)
// First load only (and only while the gated query can actually run):
// background refetches keep the rendered member list in place.
const householdPending = computed(() => auth.isAuthenticated && householdQuery.isPending.value)
const householdLabel = computed(() =>
  household.value ? householdDisplayName(household.value) : null,
)
const members = computed(() => household.value?.members ?? [])
const myMember = computed(
  () => household.value?.members.find((member) => member.userId === auth.user?.id) ?? null,
)
const isOwner = computed(() => myMember.value?.role === 'owner')
const canLeave = computed(() => !isOwner.value || members.value.length === 1)

// One remove dialog outside the members loop + the active member ref
// (vue-patterns §4).
const removeTarget = ref<HouseholdMember | null>(null)
const removeOpen = ref(false)

const joinedFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }))
const formatJoined = (iso: string) => joinedFormatter.value.format(new Date(iso))

const myDisplayName = computed(() => myMember.value?.displayName ?? '')

// The label resolves in script over static keys - the strict i18n lint
// bans computed keys inside templates.
const roleLabel = (role: HouseholdMember['role']): string =>
  role === 'owner' ? t('household.role.owner') : t('household.role.member')

// Avatar initials: first letter of the resolved member label.
const memberInitials = (member: HouseholdMember): string => {
  const label = memberLabel(member).trim()
  return label ? label[0]!.toUpperCase() : '?'
}

function openRemove(member: HouseholdMember): void {
  removeTarget.value = member
  removeOpen.value = true
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    sessions.value = await sessionApi.listSessions()
  } catch (error) {
    notification.mutationError(error, {
      title: t('auth.sessionsTitle'),
      feature: 'session',
      action: 'list',
    })
  } finally {
    sessionsLoading.value = false
  }
}

async function revokeOtherSessions() {
  revoking.value = true
  try {
    await sessionApi.deleteAllSessions()
    notification.success(t('auth.sessionsRevoked'))
    await loadSessions()
  } catch (error) {
    notification.mutationError(error, {
      title: t('auth.revokeOtherSessions'),
      feature: 'session',
      action: 'revoke',
    })
  } finally {
    revoking.value = false
  }
}

const formatExpiry = (iso: string) =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )

onMounted(() => {
  // Only fetch when actually signed in (keeps the unauthenticated test harness
  // from making network calls).
  if (auth.isAuthenticated) void loadSessions()
})
</script>

<template>
  <section class="flex flex-col gap-7">
    <PageHeader :title="t('pages.settings')" />

    <SettingsCard :title="t('settings.locale')">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted-foreground">
          {{ t('settings.languageDescription') }}
        </p>
        <Select v-model="settings.locale">
          <SelectTrigger class="w-full shrink-0 sm:w-56" :aria-label="t('settings.locale')">
            <SelectValue :placeholder="t('settings.locale')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in locales" :key="item.id" :value="item.id">
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </SettingsCard>

    <SettingsCard :title="t('settings.appearance')">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted-foreground">
          {{ t('settings.appearanceDescription') }}
        </p>
        <Select :model-value="settings.theme" @update:model-value="onThemeChange">
          <SelectTrigger class="w-full shrink-0 sm:w-56" :aria-label="t('settings.appearance')">
            <SelectValue :placeholder="t('settings.appearance')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in themes" :key="item.value" :value="item.value">
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </SettingsCard>

    <!-- Category management entry (category-management screens): available
         to anonymous users too - categories are local-first data, the
         difference is only synchronization. -->
    <SettingsCard :title="t('categoryManagement.title')" bleed>
      <!-- Full-bleed row: the padding belongs to the link so the hover and
           the click target span the card edge-to-edge; the bottom corners
           follow the card radius since the hover fill reaches it. -->
      <RouterLink
        :to="{ name: 'settings-categories' }"
        class="flex items-center justify-between gap-3 rounded-b-lg px-4 py-5 transition-colors hover:bg-muted/50 md:px-6"
        data-testid="settings-categories-link"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Tags class="size-4" />
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold">{{ t('categoryManagement.title') }}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ t('categoryManagement.subtitle') }}
            </p>
          </div>
        </div>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </RouterLink>
    </SettingsCard>

    <!-- Data transfer entry (web-data-transfer): local-first data tools,
         available anonymously like the categories card. -->
    <SettingsCard :title="t('dataTransfer.title')" bleed>
      <RouterLink
        :to="{ name: 'settings-data' }"
        class="flex items-center justify-between gap-3 rounded-b-lg px-4 py-5 transition-colors hover:bg-muted/50 md:px-6"
        data-testid="settings-data-link"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Database class="size-4" />
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold">{{ t('dataTransfer.title') }}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ t('dataTransfer.subtitle') }}
            </p>
          </div>
        </div>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </RouterLink>
    </SettingsCard>

    <template v-if="auth.isAuthenticated">
      <Card v-if="!auth.user?.emailVerified">
        <CardHeader>
          <CardTitle>{{ t('auth.verifyEmailPrompt') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button as-child variant="secondary">
            <RouterLink :to="{ name: 'verify-email' }">{{ t('auth.verifyEmailTitle') }}</RouterLink>
          </Button>
        </CardContent>
      </Card>

      <!-- Mounts only once the household read resolves: the editor's initial
           form value comes from the member entry and would otherwise seed
           empty while the query is in flight. -->
      <SettingsCard
        :title="t('profile.title')"
        content-class="flex flex-col gap-4"
        data-testid="settings-profile-card"
      >
        <DisplayNameEditor
          v-if="auth.user && household"
          :email="auth.user.email"
          :initial-name="myDisplayName"
        />
      </SettingsCard>

      <SettingsCard
        :title="t('household.title')"
        content-class="flex flex-col gap-4"
        data-testid="settings-household-card"
      >
        <p class="text-sm font-semibold" data-testid="settings-household-name">
          {{ householdLabel }}
          <template v-if="household"> · {{ t('household.membersCount', members.length) }}</template>
        </p>
        <Skeleton v-if="householdPending" class="h-5 w-40" />

        <ul v-if="household" class="flex flex-col" data-testid="settings-household-member-list">
          <li
            v-for="member in members"
            :key="member.userId"
            class="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"
            :data-testid="`settings-household-member-${member.userId}`"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                :class="
                  member.role === 'owner'
                    ? 'bg-accent text-primary'
                    : 'bg-muted text-muted-foreground'
                "
                aria-hidden="true"
              >
                {{ memberInitials(member) }}
              </span>
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold">
                  {{ memberLabel(member) }}
                  <span
                    v-if="member.userId === auth.user?.id"
                    class="font-normal text-muted-foreground"
                  >
                    ({{ t('household.you') }})
                  </span>
                </p>
                <p class="truncate text-[11px] text-muted-foreground">
                  {{ member.email }} ·
                  {{ t('household.joinedAt', { date: formatJoined(member.joinedAt) }) }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <Badge
                variant="outline"
                class="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
              >
                {{ roleLabel(member.role) }}
              </Badge>
              <Button
                v-if="isOwner && member.role !== 'owner'"
                variant="link"
                size="sm"
                class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-destructive"
                :data-testid="`settings-household-remove-${member.userId}`"
                @click="openRemove(member)"
              >
                {{ t('household.removeMember') }}
              </Button>
            </div>
          </li>
        </ul>

        <div
          v-if="isOwner && household"
          class="flex flex-wrap gap-2"
          data-testid="settings-household-owner-actions"
        >
          <InviteMemberDialog />
          <HouseholdInvitationsDialog />
          <HouseholdCodeDialog />
          <RenameHouseholdDialog :initial-name="household.name" />
          <DissolveHouseholdDialog />
        </div>

        <div class="flex flex-wrap gap-2 border-t border-border pt-4">
          <JoinHouseholdDialog />
          <LeaveHouseholdButton v-if="canLeave" />
        </div>
      </SettingsCard>

      <RemoveMemberDialog v-model="removeOpen" :member="removeTarget" />

      <SettingsCard :title="t('auth.sessionsTitle')" content-class="flex flex-col gap-4">
        <p class="text-xs text-muted-foreground">
          {{ t('auth.sessionsDescription') }}
        </p>
        <ul v-if="sessions.length" class="flex flex-col text-sm">
          <li
            v-for="(session, index) in sessions"
            :key="index"
            class="flex items-center justify-between border-b border-border py-2.5 last:border-0"
          >
            <span>
              {{ t('auth.sessionExpiresAt') }}: {{ formatExpiry(session.expiresAt) }}
              <span v-if="session.isCurrent" class="ml-2 text-muted-foreground">
                ({{ t('auth.sessionCurrent') }})
              </span>
            </span>
          </li>
        </ul>
        <p v-else-if="!sessionsLoading" class="text-sm text-muted-foreground">-</p>
        <div class="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" :loading="sessionsLoading" @click="loadSessions">
            {{ t('common.errorState.retry') }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive hover:bg-destructive/10 hover:text-destructive"
            :loading="revoking"
            @click="revokeOtherSessions"
          >
            {{ t('auth.revokeOtherSessions') }}
          </Button>
        </div>
      </SettingsCard>

      <RouterLink
        :to="{ name: 'reset-password' }"
        class="text-sm text-muted-foreground hover:underline"
      >
        {{ t('auth.forgotPassword') }}
      </RouterLink>
    </template>

    <!-- About-app card (web-app-info): last, least-frequent section. Outside
         the authenticated block - SW updates and build versions apply to
         anonymous users too. -->
    <AppInfoCard />
  </section>
</template>
