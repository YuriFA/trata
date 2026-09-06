<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, useAttrs, useSlots } from 'vue'
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useDesktopPresentation } from '@/shared/lib/presentation'
import { cn } from '@/shared/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  DRAWER_FOOTER_CLASS,
  DRAWER_HEADER_PADDING,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/shared/ui/drawer'

defineOptions({
  inheritAttrs: false,
})

interface OpenChangeDetails {
  reason?: string
}

// Default header: actions row with a hairline under it (the settings
// design language shared by every dialog surface). The section owns its
// padding, so the border spans the panel edge-to-edge on its own - no
// negative-margin breakout needed (the drawer shell never had panel padding
// and never needed one; the desktop panel's baked-in p-6 is neutralized
// below, which is what these breakouts used to fight).
const BORDERED_ROW_HEADER_CLASS = `flex-row items-center justify-between border-b`

// Strips DialogContent's baked-in panel padding: every section carries its
// own (px-6 + per-side rhythm), mirroring the drawer shell geometry. Consumer
// classes merge after this and still win.
const PANEL_UNPADDED_CLASS = 'p-0'

const props = withDefaults(
  defineProps<{
    open?: boolean
    class?: HTMLAttributes['class']
    headerClass?: HTMLAttributes['class']
    footerClass?: HTMLAttributes['class']
    closeButtonClass?: HTMLAttributes['class']
    headerVariant?: 'plain' | 'bordered-row'
    /** Full-bleed body: drops the body's horizontal padding for content
     * that pads itself (edge-to-edge lists). The top rhythm and the scroll
     * wrapper's bottom padding stay. */
    bodyVariant?: 'default' | 'flush'
    /** Full-bleed hairline above the footer band (settings design language:
     * the footer separates from the body like a card header strip). On by
     * default; the drawer footer always has the border, this adds it on
     * desktop. Forms that keep their footer inside the body use
     * DIALOG_FORM_FOOTER_CLASS instead. */
    borderedFooter?: boolean
    showCloseButton?: boolean
    closeButtonInHeader?: boolean
  }>(),
  {
    open: false,
    class: undefined,
    headerClass: undefined,
    footerClass: undefined,
    closeButtonClass: undefined,
    headerVariant: 'bordered-row',
    bodyVariant: 'default',
    borderedFooter: true,
    showCloseButton: true,
    closeButtonInHeader: true,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean, details?: OpenChangeDetails]
}>()

const slots = useSlots()
const attrs = useAttrs()
const { t } = useI18n()
const isDesktop = useDesktopPresentation()

const hasTitle = computed(() => Boolean(slots.title))
const hasDescription = computed(() => Boolean(slots.description))
const hasHeaderActions = computed(() => Boolean(slots['header-actions']))
const hasFooter = computed(() => Boolean(slots.footer))
const shouldRenderHeaderCloseButton = computed(
  () => props.showCloseButton && (!isDesktop.value || props.closeButtonInHeader),
)
const shouldRenderDesktopCornerCloseButton = computed(
  () => props.showCloseButton && isDesktop.value && !props.closeButtonInHeader,
)
const hasHeader = computed(
  () =>
    hasTitle.value ||
    hasDescription.value ||
    hasHeaderActions.value ||
    shouldRenderHeaderCloseButton.value,
)
const hasHeaderControls = computed(
  () => hasHeaderActions.value || shouldRenderHeaderCloseButton.value,
)

const handleOpenChange = (value: boolean, details?: OpenChangeDetails) => {
  emit('update:open', value, details)
}

const baseHeaderClass = computed(() =>
  cn(
    'shrink-0 text-left',
    isDesktop.value ? 'px-6 pt-6 pb-4' : DRAWER_HEADER_PADDING,
    props.headerVariant === 'bordered-row' && BORDERED_ROW_HEADER_CLASS,
    props.headerClass,
  ),
)
// The body is the only scrolling region. On desktop it fills the unpadded
// panel as a full-bleed scroll area (the pinned header/footer hairlines stay
// edge-to-edge); on the drawer the DrawerContent scroll wrapper wraps just
// this block (header/footer slots sit outside it). The bottom padding lives
// on the inner slot wrapper, NOT on this scroll container: a sticky element
// pins to the containing block's content-box bottom edge, so padding on the
// scroller itself would show as a dead strip under a stuck footer band
// (DIALOG_FORM_FOOTER_CLASS cancels the wrapper's pb-6 with -mb-6 and
// settles flush at the scrollport bottom).
const baseBodyClass = computed(() =>
  cn(
    'min-h-0',
    isDesktop.value && 'flex-1 overflow-y-auto',
    // 'flush' serves edge-to-edge body content that pads itself. NO padding
    // here at all: a padding-top on the scroller offsets the sticky scrollport,
    // so sticky day bands would pin below the header hairline with a gap that
    // lets rows peek through. The top rhythm lives on the content.
    props.bodyVariant === 'flush' ? '' : 'px-6 pt-4',
  ),
)
const baseFooterClass = computed(() =>
  cn(
    'flex shrink-0 flex-col-reverse gap-2',
    isDesktop.value ? 'flex-row justify-end' : DRAWER_FOOTER_CLASS,
    // Desktop hairline above the footer band (settings design language: the
    // footer separates from the body like a card header strip), full-bleed
    // because the section owns its padding. On by default; forms that keep
    // their footer inside the body use DIALOG_FORM_FOOTER_CLASS instead.
    props.borderedFooter && isDesktop.value && 'border-t border-border px-6 pt-4 pb-5',
    props.footerClass,
  ),
)
const closeButtonClass = computed(() =>
  cn(
    'rounded-xs text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:outline-hidden',
    props.closeButtonClass,
  ),
)
</script>

<template>
  <Dialog v-if="isDesktop" :open="open" @update:open="(value: boolean) => handleOpenChange(value)">
    <DialogContent
      v-bind="attrs"
      :aria-describedby="hasDescription ? undefined : ''"
      :class="cn(PANEL_UNPADDED_CLASS, props.class)"
      :show-close-button="shouldRenderDesktopCornerCloseButton"
    >
      <div class="flex min-h-0 flex-1 flex-col">
        <header v-if="hasHeader" :class="baseHeaderClass">
          <div :class="hasHeaderControls ? 'flex items-start justify-between gap-4' : ''">
            <div class="min-w-0 flex-1">
              <DialogTitle v-if="$slots.title">
                <slot name="title" />
              </DialogTitle>
              <DialogDescription v-if="$slots.description" class="mt-2">
                <slot name="description" />
              </DialogDescription>
            </div>

            <div v-if="hasHeaderControls" class="flex shrink-0 items-center gap-2">
              <slot name="header-actions" />
              <DialogClose v-if="shouldRenderHeaderCloseButton" :class="closeButtonClass">
                <X class="size-5" />
                <span class="sr-only">{{ t('common.close') }}</span>
              </DialogClose>
            </div>
          </div>
        </header>

        <div data-slot="dialog-body" :class="baseBodyClass">
          <div class="pb-6">
            <slot />
          </div>
        </div>

        <div v-if="hasFooter" :class="baseFooterClass">
          <slot name="footer" />
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Drawer v-else :open="open" @update:open="handleOpenChange">
    <DrawerContent
      v-bind="attrs"
      :aria-describedby="hasDescription ? undefined : ''"
      :class="props.class"
    >
      <template v-if="hasHeader" #header>
        <header :class="baseHeaderClass">
          <div :class="hasHeaderControls ? 'flex items-start justify-between gap-4' : ''">
            <div class="min-w-0 flex-1">
              <DrawerTitle v-if="$slots.title">
                <slot name="title" />
              </DrawerTitle>
              <DrawerDescription v-if="$slots.description" class="mt-2">
                <slot name="description" />
              </DrawerDescription>
            </div>

            <div v-if="hasHeaderControls" class="flex shrink-0 items-center gap-2">
              <slot name="header-actions" />
              <DrawerClose v-if="shouldRenderHeaderCloseButton" :class="closeButtonClass">
                <X class="size-5" />
                <span class="sr-only">{{ t('common.close') }}</span>
              </DrawerClose>
            </div>
          </div>
        </header>
      </template>

      <div data-slot="dialog-body" :class="baseBodyClass">
        <div class="pb-6">
          <slot />
        </div>
      </div>

      <template v-if="hasFooter" #footer>
        <div :class="baseFooterClass">
          <slot name="footer" />
        </div>
      </template>
    </DrawerContent>
  </Drawer>
</template>
