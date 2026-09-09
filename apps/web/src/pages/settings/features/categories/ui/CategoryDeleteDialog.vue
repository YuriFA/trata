<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, Trash2 } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Field, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { notification } from '@/shared/services/notification'
import { formatMoney } from '@/shared/lib/money'
import { useAccounts } from '@/entities/account'
import { useDeleteCategory, useSetCategoryArchived } from '@/entities/category'
import type { Category } from '@trata/api'
import type { CategoryUsage } from '../model/use-category-usage'

// Hybrid delete (category-management screens): the dialog branches by the
// category's local reference state - blocked by live plans, plain confirm
// (unreferenced), archive-vs-cascade choice (referenced, active), or the
// direct cascade confirm (archived with transactions). The cascade option
// always requires typing the exact category name (spec).
const { t, locale } = useI18n()

const props = defineProps<{
  category: Category | null
  usage: CategoryUsage | null
  /** Resolves blocking plan display names from the usage index. */
  planNames: ((plans: CategoryUsage['blockingPlans']) => string[]) | null
}>()

const open = defineModel<boolean>('open', { default: false })

const { data: accounts } = useAccounts()
const { mutateAsync: deleteCategory, asyncStatus: deleteStatus } = useDeleteCategory()
const { mutateAsync: setArchived, asyncStatus: archiveStatus } = useSetCategoryArchived()

type Mode = 'blocked' | 'plain' | 'choice' | 'cascade'
type Choice = 'archive' | 'cascade'

const mode = computed<Mode>(() => {
  const usage = props.usage
  if (!usage) return 'plain'
  if (usage.livePlanCount > 0) return 'blocked'
  if (usage.transactionCount > 0) {
    // Archived categories already had their archive decision made.
    return props.category?.archivedAt ? 'cascade' : 'choice'
  }
  return 'plain'
})

const transactionCount = computed(() => props.usage?.transactionCount ?? 0)
const busy = computed(() => deleteStatus.value === 'loading' || archiveStatus.value === 'loading')

// Usage string for the with-transactions copy ("12 операций", pluralized
// by vue-i18n over the dedicated nominative key).
const usageText = computed(() => t('deleteCategory.usageCount', transactionCount.value))

const plansText = computed(() => {
  const blocking = props.usage?.blockingPlans ?? []
  return props.planNames ? props.planNames(blocking).filter(Boolean).join(', ') : ''
})

// Balance impact of a cascade, per account (spec: the cascade states the
// balance change). Deleting an expense raises the balance and vice versa.
const balanceImpact = computed(() => {
  const usage = props.usage
  const accountList = accounts.value
  if (!usage || !accountList || !props.category) return []
  const sign = props.category.type === 'expense' ? 1 : -1
  return usage.impactByAccount.map(({ accountId, amountMinorUnits }) => {
    const account = accountList.find((candidate) => candidate.id === accountId)
    // Explicit sign prefix: deleting an expense raises the balance and vice
    // versa; formatMoney itself drops the plus.
    const magnitude = formatMoney(
      Math.abs(amountMinorUnits),
      account?.currency ?? 'RUB',
      locale.value,
    )
    return {
      account: account?.name ?? '',
      delta: `${sign * amountMinorUnits >= 0 ? '+' : '−'}${magnitude}`,
    }
  })
})

// Choice state starts clean every time: the host mounts the dialog per
// open (destroy-on-close, vue-patterns §4), so a fresh mount IS the reset.
const choice = ref<Choice>('archive')
const confirmation = ref('')

const cascadeChosen = computed(() => mode.value === 'cascade' || choice.value === 'cascade')
const confirmationMatches = computed(
  () => props.category !== null && confirmation.value.trim() === props.category.name,
)
const canConfirm = computed(() => {
  if (busy.value) return false
  if (mode.value === 'choice') {
    return choice.value === 'archive' || confirmationMatches.value
  }
  if (mode.value === 'cascade') return confirmationMatches.value
  return true
})

async function handleConfirm(): Promise<void> {
  const category = props.category
  if (!category || !canConfirm.value) return
  try {
    if (mode.value === 'choice' && choice.value === 'archive') {
      await setArchived({ id: category.id, version: category.version, archived: true })
      notification.success(t('categoryManagement.archiveSuccess'))
    } else {
      const cascade = transactionCount.value > 0
      await deleteCategory({ id: category.id, cascade: cascade || undefined })
      notification.success(t('categoryManagement.deleteSuccess'))
    }
  } catch (error) {
    notification.mutationError(error, {
      title: t('deleteCategory.trigger'),
      feature: 'category',
      action: 'delete',
    })
  } finally {
    // Same close rule as every delete confirm: no draft to keep, the toast
    // carries the failure (vue-patterns §3).
    open.value = false
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-md" data-testid="delete-category-dialog">
    <template #title>
      {{
        mode === 'blocked'
          ? t('deleteCategory.blockedTitle')
          : mode === 'plain'
            ? t('deleteCategory.plainTitle')
            : t('deleteCategory.withTransactionsTitle')
      }}
    </template>

    <div class="flex flex-col gap-4">
      <!-- Identity row -->
      <div v-if="category" class="flex items-center gap-3">
        <CategoryAvatar :icon="category.icon" :color="category.color" class="size-9 text-lg" />
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold" data-testid="delete-category-name">
            {{ category.name }}
          </p>
          <p class="text-xs text-muted-foreground">{{ usageText }}</p>
        </div>
      </div>

      <!-- blocked -->
      <p v-if="mode === 'blocked'" class="text-sm" data-testid="delete-category-blocked">
        {{ t('deleteCategory.blockedPlans', { plans: plansText }) }}
      </p>

      <!-- plain -->
      <p v-else-if="mode === 'plain'" class="text-sm">
        {{ t('deleteCategory.plainDescription') }}
      </p>

      <!-- choice / cascade -->
      <template v-else>
        <p class="text-sm" data-testid="delete-category-warning">
          {{
            mode === 'cascade'
              ? t('deleteCategory.cascadeDescription', { usage: usageText })
              : t('deleteCategory.withTransactionsDescription', { usage: usageText })
          }}
        </p>

        <!-- Option cards (choice mode only) -->
        <div v-if="mode === 'choice'" class="flex flex-col gap-2" role="radiogroup">
          <button
            type="button"
            role="radio"
            :aria-checked="choice === 'archive'"
            data-testid="delete-category-option-archive"
            class="flex items-start gap-3 rounded-xl border p-3 text-left transition-colors"
            :class="choice === 'archive' ? 'border-primary bg-accent' : 'border-border'"
            @click="choice = 'archive'"
          >
            <Archive class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span class="block text-sm font-semibold">
                {{ t('deleteCategory.optionArchiveTitle') }}
              </span>
              <span class="block text-xs text-muted-foreground">
                {{ t('deleteCategory.optionArchiveDescription') }}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="choice === 'cascade'"
            data-testid="delete-category-option-cascade"
            class="flex items-start gap-3 rounded-xl border p-3 text-left transition-colors"
            :class="choice === 'cascade' ? 'border-destructive bg-destructive/10' : 'border-border'"
            @click="choice = 'cascade'"
          >
            <Trash2 class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>
              <span class="block text-sm font-semibold text-destructive">
                {{ t('deleteCategory.optionCascadeTitle', { count: transactionCount }) }}
              </span>
              <span class="block text-xs text-muted-foreground">
                {{ t('deleteCategory.optionCascadeDescription') }}
              </span>
            </span>
          </button>
        </div>

        <!-- Typed confirmation + balance impact once the cascade is in play -->
        <template v-if="cascadeChosen">
          <ul v-if="balanceImpact.length" class="flex flex-col gap-1 text-xs text-muted-foreground">
            <li
              v-for="(line, index) in balanceImpact"
              :key="index"
              data-testid="delete-category-impact"
            >
              {{ t('deleteCategory.balanceImpact', { account: line.account, delta: line.delta }) }}
            </li>
          </ul>
          <Field>
            <FieldLabel for="delete-category-confirmation">
              {{ t('deleteCategory.typeToConfirm', { name: category?.name ?? '' }) }}
            </FieldLabel>
            <Input
              id="delete-category-confirmation"
              v-model="confirmation"
              data-testid="delete-category-confirmation"
              :placeholder="category?.name"
              autocomplete="off"
            />
          </Field>
        </template>
      </template>
    </div>

    <template #footer>
      <Button variant="ghost" data-testid="delete-category-cancel" @click="open = false">
        {{ t('categoryManagement.cancel') }}
      </Button>
      <Button
        v-if="mode === 'choice' && choice === 'archive'"
        :loading="busy"
        :disabled="!canConfirm"
        data-testid="delete-category-confirm"
        @click="handleConfirm"
      >
        {{ t('deleteCategory.confirmArchive') }}
      </Button>
      <Button
        v-else-if="mode !== 'blocked'"
        variant="destructive"
        :loading="busy"
        :disabled="!canConfirm"
        data-testid="delete-category-confirm"
        @click="handleConfirm"
      >
        {{ cascadeChosen ? t('deleteCategory.confirmCascade') : t('deleteCategory.confirm') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
