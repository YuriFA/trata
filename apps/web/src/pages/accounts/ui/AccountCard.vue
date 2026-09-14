<script setup lang="ts">
import { formatMoney } from '@/shared/lib/money'
import { generateHashIndex } from '@/shared/lib/hash-generator'
import type { AccountWithBalance } from '@/entities/account'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Card } from '@/shared/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Button } from '@/shared/ui/button'
import { MoreVertical, Pencil, ScaleIcon, Trash2 } from '@lucide/vue'

const { account } = defineProps<{
  account: AccountWithBalance
}>()

// The edit/reconcile/delete dialogs live once on the page (list/dialog
// convention): the kebab only reports the intent, the page hoists the dialogs.
const emit = defineEmits<{
  edit: []
  reconcile: []
  delete: []
}>()

const index = computed(() => generateHashIndex(account.id))
const { locale, t } = useI18n()
const format = (value: number) => formatMoney(value, account.currency, locale.value)
</script>

<template>
  <Card class="gap-3 p-4 transition-colors hover:border-foreground/10 md:p-5">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="flex size-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
          :style="{ backgroundColor: `var(--avatar-color-${index})` }"
          aria-hidden="true"
        >
          {{ account.name.at(0) }}
        </div>
        <span class="truncate text-[15px] font-semibold">{{ account.name }}</span>
        <!-- Native-currency chip (the accounts-mc mockup): balances stay in
             the account's own currency, so the code rides on every card. -->
        <span
          class="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          data-testid="account-currency-chip"
        >
          {{ account.currency }}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" :aria-label="t('accounts.actions')">
            <MoreVertical class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @select="emit('edit')">
            <Pencil class="size-4" />
            {{ t('editAccount.trigger') }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="emit('reconcile')">
            <ScaleIcon class="size-4" />
            {{ t('reconcileAccount.trigger') }}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" @select="emit('delete')">
            <Trash2 class="size-4" />
            {{ t('deleteAccount.trigger') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <p class="text-xl font-bold tabular-nums">{{ format(account.balance) }}</p>
  </Card>
</template>
