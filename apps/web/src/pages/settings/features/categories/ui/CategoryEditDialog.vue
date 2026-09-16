<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQueryCache } from '@pinia/colada'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Field, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { SegmentedControl, type SegmentedControlOption } from '@/shared/ui/segmented-control'
import { notification } from '@/shared/services/notification'
import { VersionConflictError } from '@trata/api'
import {
  CATEGORY_ICONS,
  categoryIconsForType,
  defaultCategoryIcon,
  pickCategoryColor,
  useCategoriesIncludingArchived,
  useCreateCategory,
  useUpdateCategory,
} from '@/entities/category'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import type { Category } from '@trata/api'

// Edit/create dialog (category-management screens): one dialog for the
// screen's full CRUD. Edit mode (category set) offers name + the
// pre-paired icon/color set only - the type is immutable by contract and
// rendered as a read-only badge. Create mode (category null, opened from
// the page header, add-category-create-button) additionally offers the
// type as a segmented control; the color still travels with the picked
// icon (the user picks only the emoji), same creation model as the
// transaction form's new-category dialog.
const { t } = useI18n()
const queryCache = useQueryCache()

const props = defineProps<{
  category: Category | null
}>()

const open = defineModel<boolean>('open', { default: false })

const { data: allCategories } = useCategoriesIncludingArchived()
const { mutateAsync: updateCategory, asyncStatus: updateStatus } = useUpdateCategory()
const { mutateAsync: createCategory, asyncStatus: createStatus } = useCreateCategory()

const isCreate = computed(() => !props.category)
const asyncStatus = computed(() => (isCreate.value ? createStatus.value : updateStatus.value))

// The draft seeds from the record at mount - the host mounts the dialog
// per open (destroy-on-close, vue-patterns §4), so a fresh mount IS the
// reseed: the row's category in edit mode, clean defaults in create mode.
const name = ref(props.category?.name ?? '')
const icon = ref(props.category?.icon ?? defaultCategoryIcon('expense'))
const type = ref<'expense' | 'income'>(props.category?.type ?? 'expense')

// The icon vocabulary follows the category's type (create: the chosen
// type; edit: the immutable record type). Toggling the type in create mode
// replaces an icon the new type does not offer with that type's default.
const effectiveType = computed(() =>
  isCreate.value ? type.value : (props.category?.type ?? 'expense'),
)
const iconOptions = computed(() => categoryIconsForType(effectiveType.value))
watch(type, (next, previous) => {
  if (next === previous) return
  if (!iconOptions.value.some((option) => option.icon === icon.value)) {
    icon.value = defaultCategoryIcon(next)
  }
})

// Literal keys per branch (the i18n lint bans dynamic keys).
const typeOptions = computed<SegmentedControlOption<'expense' | 'income'>[]>(() => [
  {
    value: 'expense',
    label: t('transactions.types.expense'),
    testid: 'create-category-type-expense',
  },
  { value: 'income', label: t('transactions.types.income'), testid: 'create-category-type-income' },
])
const titleLabel = computed(() =>
  isCreate.value ? t('editCategory.createTitle') : t('editCategory.title'),
)
const submitLabel = computed(() =>
  isCreate.value ? t('editCategory.createSubmit') : t('editCategory.submit'),
)
const typeLabel = computed(() =>
  (isCreate.value ? type.value : props.category?.type) === 'income'
    ? t('transactions.types.income')
    : t('transactions.types.expense'),
)
// Mode-scoped testids keep the edit surface stable for existing specs.
const dialogTestId = computed(() => (isCreate.value ? 'create-category' : 'edit-category'))

const trimmed = computed(() => name.value.trim())
const canSubmit = computed(() => trimmed.value.length > 0 && asyncStatus.value !== 'loading')

async function submit(): Promise<void> {
  if (!trimmed.value) return

  // The color stays paired to the picked icon; colors taken by OTHER
  // categories (archived included - they still render in charts) displace
  // to the nearest free palette color, same walk as creation.
  const takenColors = (allCategories.value ?? [])
    .filter((candidate) => candidate.id !== props.category?.id)
    .map((candidate) => candidate.color)
  const color = pickCategoryColor(icon.value, takenColors)

  try {
    if (isCreate.value) {
      await createCategory({
        name: trimmed.value,
        icon: icon.value,
        color,
        type: type.value,
      })
      notification.success(t('editCategory.createSuccess'))
    } else {
      const category = props.category
      if (!category) return
      await updateCategory({
        id: category.id,
        payload: {
          name: trimmed.value,
          icon: icon.value,
          color,
          version: category.version,
        },
      })
      notification.success(t('editCategory.success'))
    }
    open.value = false
  } catch (error) {
    if (error instanceof VersionConflictError) {
      // Refetch so the row picks up the concurrent version (the dialog closes
      // with the conflict message; the user can retry against fresh state).
      await queryCache.invalidateQueries({ key: ['categories'] })
    }
    notification.mutationError(error, {
      title: titleLabel.value,
      feature: 'category',
      action: isCreate.value ? 'create' : 'update',
    })
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-sm" :data-testid="`${dialogTestId}-dialog`">
    <template #title>{{ titleLabel }}</template>

    <form :id="`${dialogTestId}-form`" class="flex flex-col gap-3" @submit.prevent="submit">
      <div v-if="!isCreate" class="flex items-center gap-3">
        <CategoryAvatar
          :icon="icon || '❔'"
          :color="CATEGORY_ICONS.find((option) => option.icon === icon)?.color"
          class="size-9 text-lg"
        />
        <div class="flex flex-col gap-0.5">
          <span class="text-[11px] font-medium text-muted-foreground">
            {{ t('editCategory.typeLabel') }}
          </span>
          <Badge
            variant="outline"
            class="w-fit rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            data-testid="edit-category-type"
          >
            {{ typeLabel }}
          </Badge>
        </div>
      </div>

      <!-- Create mode: the type IS choosable (segmented control, the shared
           Tabs-look control); edit keeps the read-only badge. -->
      <Field v-else>
        <FieldLabel>{{ t('editCategory.typeLabel') }}</FieldLabel>
        <SegmentedControl
          v-model="type"
          class="w-full"
          :options="typeOptions"
          :aria-label="t('editCategory.typeLabel')"
          data-testid="create-category-type"
        />
      </Field>

      <Field>
        <FieldLabel :for="`${dialogTestId}-name`">{{ t('editCategory.nameLabel') }}</FieldLabel>
        <Input
          :id="`${dialogTestId}-name`"
          v-model="name"
          :data-testid="`${dialogTestId}-name`"
          :placeholder="t('editCategory.nameLabel')"
        />
      </Field>

      <Field>
        <FieldLabel>{{ t('editCategory.iconLabel') }}</FieldLabel>
        <!-- Live preview tiles: each emoji on the pastel tint of its own
             paired color (design-system identity rule, same as creation). -->
        <div
          class="flex flex-wrap gap-2"
          role="radiogroup"
          :aria-label="t('editCategory.iconLabel')"
        >
          <button
            v-for="(option, index) in iconOptions"
            :key="option.icon"
            type="button"
            role="radio"
            :aria-checked="icon === option.icon"
            :data-testid="`${dialogTestId}-icon-${index}`"
            class="flex size-10 items-center justify-center rounded-full text-lg transition-shadow"
            :class="
              icon === option.icon ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
            "
            :style="{ backgroundColor: `color-mix(in srgb, ${option.color} 15%, transparent)` }"
            @click="icon = option.icon"
          >
            {{ option.icon }}
          </button>
        </div>
      </Field>

      <!-- Edit-only hint: the type is immutable by contract (create mode
           offers it as a control, so no hint is needed). -->
      <p v-if="!isCreate" class="text-xs text-muted-foreground">
        {{ t('editCategory.typeImmutableHint') }}
      </p>
    </form>

    <template #footer>
      <Button
        type="button"
        variant="ghost"
        :data-testid="`${dialogTestId}-cancel`"
        @click="open = false"
      >
        {{ t('categoryManagement.cancel') }}
      </Button>
      <Button
        type="submit"
        :form="`${dialogTestId}-form`"
        :loading="asyncStatus === 'loading'"
        :disabled="!canSubmit"
        :data-testid="`${dialogTestId}-submit`"
      >
        {{ submitLabel }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
