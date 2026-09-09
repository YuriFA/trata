<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/shared/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <!-- Brand mark «home + ledger» (approved Trata canvas, variant 1 "Refined
       Outline"): roof chevron over a ledger page, three lines, first short.
       Stroke-only glyph in currentColor so it inherits the surrounding
       surface (teal chip in the sidebar, plain teal on paper). -->
  <svg viewBox="0 0 512 512" fill="none" aria-hidden="true" :class="cn('size-4.5', props.class)">
    <g stroke="currentColor" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
      <path d="M104 256 L256 120 L408 256" />
      <path d="M152 216 V416 A24 24 0 0 0 176 440 H336 A24 24 0 0 0 360 416 V216" />
      <path d="M204 270 L264 270" />
      <path d="M204 330 L308 330" />
      <path d="M204 390 L308 390" />
    </g>
  </svg>
</template>
