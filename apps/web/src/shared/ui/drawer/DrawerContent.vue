<script setup lang="ts">
import type { DrawerContentEmits, DrawerContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { onBeforeUnmount } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DrawerContent, DrawerPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/shared/lib/utils'
import DrawerHandle from './DrawerHandle.vue'
import DrawerOverlay from './DrawerOverlay.vue'

const props = defineProps<DrawerContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DrawerContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)

// Drawer stack accessibility (web-screens: while a picker drawer is open
// above this drawer, both stay exposed to the accessibility tree). reka
// marks a drawer with `data-nested-drawer-open` when a child drawer is
// stacked above it, but the child's modal `hideOthers` pass still sets
// `aria-hidden` on this content - which would remove the form below from
// the accessibility tree (the mobile-forms sheet-stack incident mirrored on
// web). Strip that attribute again while a nested drawer is open; reka's
// own undo restores the original state once the stack closes.
let attributesObserver: MutationObserver | undefined

const stripHiddenWhileStacked = (element: HTMLElement) => {
  if (
    element.hasAttribute('data-nested-drawer-open') &&
    element.getAttribute('aria-hidden') === 'true'
  ) {
    element.removeAttribute('aria-hidden')
  }
}

const setScrollElement = (node: unknown) => {
  // A function ref on our own div receives the DOM element directly. reka's
  // content root (the element reka marks with `data-nested-drawer-open` and
  // that `hideOthers` hides) is its parent; the content mounts lazily behind
  // Presence, so the observer must attach here, not in onMounted.
  const element = node instanceof HTMLElement ? node.parentElement : undefined
  if (!(element instanceof HTMLElement)) return

  stripHiddenWhileStacked(element)

  attributesObserver?.disconnect()
  attributesObserver = new MutationObserver(() => stripHiddenWhileStacked(element))
  attributesObserver.observe(element, {
    attributes: true,
    attributeFilter: ['aria-hidden', 'data-nested-drawer-open'],
  })
}

onBeforeUnmount(() => {
  attributesObserver?.disconnect()
  attributesObserver = undefined
})
</script>

<template>
  <DrawerPortal>
    <!-- z-scale (see shared/ui/alert-dialog/AlertDialogContent.vue): the
         sheet's z-[60] sits above plain dialogs (z-50); alert dialogs
         out-rank it at z-[70]. -->
    <DrawerOverlay />
    <DrawerContent
      data-slot="drawer-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'bg-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-[60] flex max-h-[calc(100dvh-0.5rem)] flex-col overflow-hidden rounded-t-[1.75rem] border-x border-t shadow-lg duration-300',
          props.class,
        )
      "
    >
      <DrawerHandle />
      <!-- Header/footer slots sit outside the scroll area so they stay pinned;
           the scroll area is flex so bounded flex children (e.g. the
           transactions filters form) hand overflow to their inner scroller. -->
      <slot name="header" />
      <div
        :ref="setScrollElement"
        class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        <slot />
      </div>
      <slot name="footer" />
    </DrawerContent>
  </DrawerPortal>
</template>
