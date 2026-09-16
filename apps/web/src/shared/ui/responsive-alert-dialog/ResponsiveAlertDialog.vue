<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { Component } from 'vue'
import { computed, useSlots } from 'vue'
import { useDesktopPresentation } from '@/shared/lib/presentation'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import {
  DRAWER_FOOTER_CLASS,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/shared/ui/drawer'

defineOptions({
  inheritAttrs: false,
})

// Destructive/decision confirm (confirm-capability screens): a centered
// alert dialog on desktop, a bottom sheet on mobile - the same split the
// ResponsiveDialog applies to forms and pickers. The mobile sheet is the
// app-wide confirm rule (web-screens): a centered AlertDialog can never
// stack over an open drawer (the drawer's z-[60] sheet buries it, modal
// behavior freezes the page), so every confirm renders as a sheet on
// mobile. The z-scale in shared/ui keeps any stray centered alert above
// drawers anyway (z-50 dialogs < z-[60] drawers < z-[70] alerts).
//
// Controlled component: `confirm` click closes via update:open and fires
// `confirm`; `cancel` fires on cancel with the same close. The ownership
// gate binds the events without v-model - the store owns its open state.

const props = withDefaults(
  defineProps<{
    open?: boolean
    title: string
    description?: string
    confirmLabel: string
    cancelLabel: string
    loading?: boolean
    /** Optional leading icon for the desktop card's destructive circle. */
    icon?: Component | null
    contentTestId?: string
    confirmTestId?: string
    cancelTestId?: string
    class?: HTMLAttributes['class']
  }>(),
  {
    open: false,
    description: undefined,
    loading: false,
    icon: null,
    contentTestId: undefined,
    confirmTestId: undefined,
    cancelTestId: undefined,
    class: undefined,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
  cancel: []
}>()

const slots = useSlots()
const isDesktop = useDesktopPresentation()

const hasBodyText = computed(() => Boolean(props.description) || Boolean(slots.default))

const handleConfirm = () => {
  emit('update:open', false)
  emit('confirm')
}

const handleCancel = () => {
  emit('update:open', false)
  emit('cancel')
}

const iconCircleClass =
  'mx-auto mb-1 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive'
</script>

<template>
  <AlertDialog
    v-if="isDesktop"
    :open="open"
    @update:open="(value: boolean) => emit('update:open', value)"
  >
    <AlertDialogContent
      :class="cn('max-w-[320px]', props.class)"
      :data-testid="contentTestId"
      :aria-describedby="hasBodyText ? undefined : ''"
    >
      <AlertDialogHeader class="items-center text-center">
        <span v-if="icon" :class="iconCircleClass" aria-hidden="true">
          <component :is="icon" class="size-6" />
        </span>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="hasBodyText">
          {{ description }}<slot />
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="flex-row gap-3">
        <AlertDialogCancel class="flex-1" :data-testid="cancelTestId" @click="handleCancel">
          {{ cancelLabel }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          class="flex-1"
          :loading="loading"
          :data-testid="confirmTestId"
          @click="handleConfirm"
        >
          {{ confirmLabel }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <Drawer v-else :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <DrawerContent :data-testid="contentTestId" :aria-describedby="hasBodyText ? undefined : ''">
      <div class="flex flex-col gap-1 px-6 pt-1">
        <DrawerTitle>{{ title }}</DrawerTitle>
        <DrawerDescription v-if="hasBodyText">{{ description }}<slot /></DrawerDescription>
      </div>
      <template #footer>
        <div :class="cn('flex flex-col gap-3', DRAWER_FOOTER_CLASS)">
          <Button
            variant="destructive"
            class="w-full"
            :loading="loading"
            :data-testid="confirmTestId"
            @click="handleConfirm"
          >
            {{ confirmLabel }}
          </Button>
          <Button
            variant="outline"
            class="w-full"
            :data-testid="cancelTestId"
            @click="handleCancel"
          >
            {{ cancelLabel }}
          </Button>
        </div>
      </template>
    </DrawerContent>
  </Drawer>
</template>
