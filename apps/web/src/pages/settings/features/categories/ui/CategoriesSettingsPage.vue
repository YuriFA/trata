<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArchiveRestore, Archive, ChevronDown, Pencil, Trash2 } from '@lucide/vue'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { PageHeader } from '@/shared/ui/page-header'
import { Skeleton } from '@/shared/ui/skeleton'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { SettingsCard } from '@/shared/ui/settings-card'
import { useCategoriesIncludingArchived, useSetCategoryArchived } from '@/entities/category'
import type { Category } from '@trata/api'
import { notification } from '@/shared/services/notification'
import { groupCategories, useCategoryUsage } from '../model/use-category-usage'
import CategoryEditDialog from './CategoryEditDialog.vue'
import CategoryDeleteDialog from './CategoryDeleteDialog.vue'

// Category management (category-management screens): the household's
// non-deleted categories grouped by type with locally computed transaction
// counts, an archive section, and edit/archive/delete actions. Creation
// lives in the header (add-category-create-button): it opens the shared
// edit dialog in create mode; the transaction form keeps its inline flow.
const { t, locale } = useI18n()

const categoriesQuery = useCategoriesIncludingArchived()
const categories = computed(() => categoriesQuery.data.value ?? [])
const { expense, income, archived } = groupCategories(categories)
const { usage, isPending: usagePending } = useCategoryUsage()

// Skeletons only while NO data exists yet: background refetches
// (invalidation, sync cycle) keep the rendered list in place.
const categoriesLoading = computed(() => categoriesQuery.isPending.value || usagePending.value)

const countLabel = (category: Category): string => {
  if (!usage.value) return ''
  const count = usage.value.byCategory[category.id]?.transactionCount ?? 0
  return count === 0
    ? t('categoryManagement.noTransactions')
    : t('categoryManagement.transactionsCount', count)
}

const archiveOpen = ref(true)
const archivedCount = computed(() => archived.value.length)

const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }))
const formatArchivedSince = (category: Category): string =>
  t('categoryManagement.archivedSince', {
    date: dateFormatter.value.format(new Date(category.archivedAt!)),
  })

// One dialog pair outside the lists + the active category; both mount per
// open (destroy-on-close) so their drafts reset by remount (vue-patterns §4).
const editTarget = ref<Category | null>(null)
const editOpen = ref(false)
const deleteTarget = ref<Category | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editTarget.value = null
  editOpen.value = true
}

function openEdit(category: Category): void {
  editTarget.value = category
  editOpen.value = true
}
function openDelete(category: Category): void {
  deleteTarget.value = category
  deleteOpen.value = true
}

// Row-level archive/unarchive are direct (reversible) mutations; a live
// planned payment blocks archiving, and that guard is checked from the
// local mirror before the mutation so the explanation is exact.
const { mutateAsync: setArchived } = useSetCategoryArchived()

async function archiveCategory(category: Category): Promise<void> {
  const entry = usage.value?.byCategory[category.id]
  if (entry?.livePlanCount) {
    notification.warning(
      t('categoryManagement.archiveBlockedPlans', {
        plans: usage.value!.planNames(entry.blockingPlans).join(', '),
      }),
    )
    return
  }
  try {
    await setArchived({ id: category.id, version: category.version, archived: true })
    notification.success(t('categoryManagement.archiveSuccess'))
  } catch (error) {
    notification.mutationError(error, {
      title: t('categoryManagement.actions.archive'),
      feature: 'category',
      action: 'archive',
    })
  }
}

async function unarchiveCategory(category: Category): Promise<void> {
  try {
    await setArchived({ id: category.id, version: category.version, archived: false })
    notification.success(t('categoryManagement.unarchiveSuccess'))
  } catch (error) {
    notification.mutationError(error, {
      title: t('categoryManagement.actions.unarchive'),
      feature: 'category',
      action: 'unarchive',
    })
  }
}
</script>

<template>
  <section class="flex flex-col gap-7">
    <PageHeader
      :title="t('categoryManagement.title')"
      :back-to="{ name: 'settings' }"
      :back-label="t('pages.settings')"
    >
      <template #actions>
        <Button data-testid="categories-create" @click="openCreate()">
          {{ t('actions.create') }}
        </Button>
      </template>
    </PageHeader>

    <div v-if="categoriesLoading" class="flex flex-col gap-6" data-testid="categories-loading">
      <Skeleton v-for="group in 2" :key="group" class="h-40" />
    </div>

    <template v-else>
      <SettingsCard
        v-for="group in [
          {
            title: t('categoryManagement.groupExpense'),
            items: expense,
            testid: 'categories-expense',
          },
          {
            title: t('categoryManagement.groupIncome'),
            items: income,
            testid: 'categories-income',
          },
        ]"
        :key="group.title"
        :title="group.title"
        bleed
        :data-testid="group.testid"
      >
        <p
          v-if="!group.items.length"
          class="px-6 py-5 text-sm text-muted-foreground"
          :data-testid="`${group.testid}-empty`"
        >
          {{ t('categoryManagement.emptyGroup') }}
        </p>
        <div
          v-for="category in group.items"
          :key="category.id"
          class="flex items-center justify-between gap-3 border-b border-border px-6 py-5 last:border-0"
          :data-testid="`category-row-${category.id}`"
        >
          <div class="flex min-w-0 items-center gap-3">
            <CategoryAvatar :icon="category.icon" :color="category.color" class="size-9 text-lg" />
            <div class="min-w-0">
              <p
                class="truncate text-sm font-semibold"
                :data-testid="`category-name-${category.id}`"
              >
                {{ category.name }}
              </p>
              <p
                class="text-xs text-muted-foreground"
                :data-testid="`category-count-${category.id}`"
              >
                {{ countLabel(category) }}
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              :aria-label="t('categoryManagement.actions.edit')"
              :data-testid="`category-edit-${category.id}`"
              @click="openEdit(category)"
            >
              <Pencil class="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              :aria-label="t('categoryManagement.actions.archive')"
              :data-testid="`category-archive-${category.id}`"
              @click="archiveCategory(category)"
            >
              <Archive class="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="hover:text-destructive"
              :aria-label="t('categoryManagement.actions.delete')"
              :data-testid="`category-delete-${category.id}`"
              @click="openDelete(category)"
            >
              <Trash2 class="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard bleed data-testid="categories-archive">
        <template #title>
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2"
            :aria-expanded="archiveOpen"
            data-testid="categories-archive-toggle"
            @click="archiveOpen = !archiveOpen"
          >
            <span
              class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              {{ t('categoryManagement.archiveTitle') }}
              <Badge
                v-if="archivedCount"
                variant="outline"
                class="rounded-md px-2 py-0.5 text-[10px] font-bold"
              >
                {{ archivedCount }}
              </Badge>
            </span>
            <ChevronDown
              class="size-4 text-muted-foreground transition-transform"
              :class="archiveOpen ? '' : 'rotate-180'"
              aria-hidden="true"
            />
          </button>
        </template>
        <div v-if="archiveOpen" class="flex flex-col gap-4">
          <p class="px-6 pt-5 text-xs text-muted-foreground">
            {{ t('categoryManagement.archiveHint') }}
          </p>
          <p
            v-if="!archivedCount"
            class="px-6 pb-5 text-sm text-muted-foreground"
            data-testid="categories-archive-empty"
          >
            {{ t('categoryManagement.emptyGroup') }}
          </p>
          <div
            v-for="category in archived"
            :key="category.id"
            class="flex items-center justify-between gap-3 border-b border-border px-6 py-5 last:border-0"
            :data-testid="`category-row-${category.id}`"
          >
            <div class="flex min-w-0 items-center gap-3 opacity-75">
              <CategoryAvatar
                :icon="category.icon"
                :color="category.color"
                class="size-9 text-lg"
              />
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold">{{ category.name }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ countLabel(category) }} · {{ formatArchivedSince(category) }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                :aria-label="t('categoryManagement.actions.unarchive')"
                :data-testid="`category-unarchive-${category.id}`"
                @click="unarchiveCategory(category)"
              >
                <ArchiveRestore class="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="t('categoryManagement.actions.edit')"
                :data-testid="`category-edit-${category.id}`"
                @click="openEdit(category)"
              >
                <Pencil class="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="hover:text-destructive"
                :aria-label="t('categoryManagement.actions.delete')"
                :data-testid="`category-delete-${category.id}`"
                @click="openDelete(category)"
              >
                <Trash2 class="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </SettingsCard>
    </template>

    <CategoryEditDialog
      v-if="editOpen"
      :key="editTarget?.id ?? 'create'"
      v-model:open="editOpen"
      :category="editTarget"
    />
    <CategoryDeleteDialog
      v-if="deleteOpen"
      :key="deleteTarget?.id"
      v-model:open="deleteOpen"
      :category="deleteTarget"
      :usage="deleteTarget ? (usage?.byCategory[deleteTarget.id] ?? null) : null"
      :plan-names="usage?.planNames ?? null"
    />
  </section>
</template>
