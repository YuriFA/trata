// Manual-confirmation sheet (design D6/D7): the same reference row layout
// as the add/edit form — static account/category context rows from the
// plan, an editable decimal-pad amount with the account's currency chip
// (prefilled from the plan), an editable occurrence date row (defaulting
// to the scheduled one), and an optional note input row, over the submit
// footer pinned via @gorhom's footerComponent layer (above the extended
// keyboard). Submitting runs the local two-op composite
// (`confirmPlannedPayment`) — the transaction insert and the plan
// advancement commit in one local transaction and converge via sync; the
// mutation hook invalidates the plan/transaction/account queries.

import { useEffect, useMemo, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormProvider, useController, useForm, useFormContext } from 'react-hook-form'
import { View } from 'react-native'
import { currencySymbol } from '@trata/money'
import type { PlannedPayment } from '@trata/api'
import { useAccounts } from '@/entities/account'
import { useCategories } from '@/entities/category'
import {
  useConfirmPlannedPayment,
  type ConfirmPlannedPaymentInput,
} from '@/entities/planned-payment'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { groupAmountInput } from '@/shared/lib/money/display'
import { parseMajorUnitsToMinor, sanitizeAmountInput } from '@/shared/lib/money/parse'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetInput,
  BottomSheetView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { FormError } from '@/shared/ui/form'
import { useSheetContentPickers } from '@/shared/ui/sheet-content-portal'
import { Text } from '@/shared/ui/text'
import { PLANS_COPY, PLAN_TYPE_VIEWS } from '../model/kind'
import { planRowTitle } from '../model/selectors'
import {
  confirmPlanDefaultValues,
  confirmPlanSchema,
  type ConfirmPlanFormValues,
} from '../model/schema'
import { PlansFormFooter } from './form-actions'
import { PlansDateFieldRow, PlansNoteFieldRow } from './form-rows'

function toConfirmInput(values: ConfirmPlanFormValues, planId: string): ConfirmPlannedPaymentInput {
  return {
    planId,
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    // Mid-day UTC keeps the transaction inside its own calendar day for any
    // user west of UTC+12 (design D2).
    occurredAt: new Date(`${values.occurredOn}T12:00:00.000Z`).toISOString(),
    note: values.note.trim(),
  }
}

export function ConfirmSheet({ plan }: { plan: PlannedPayment }) {
  // Mounts with its subject; presentOnMount presents it (forms.md §3). The
  // ref stays for the post-submit dismissal.
  const sheetRef = useRef<BottomSheetRef>(null)
  // The date picker declared by the row below re-renders beside this sheet
  // element (outside its portal content) — see useSheetContentPickers.
  const pickers = useSheetContentPickers()

  const view = PLAN_TYPE_VIEWS[plan.type]
  const accounts = useAccounts().data ?? []
  const categories = useCategories(plan.type).data ?? []
  const account = accounts.find((candidate) => candidate.id === plan.accountId)
  const category = categories.find((candidate) => candidate.id === plan.categoryId)

  const defaults = useMemo(() => confirmPlanDefaultValues(plan), [plan])

  const form = useForm<ConfirmPlanFormValues>({
    resolver: zodResolver(confirmPlanSchema),
    defaultValues: defaults,
    mode: 'onChange',
  })
  const confirmPlan = useConfirmPlannedPayment()

  // @gorhom v5 unmounts the sheet content on close, but this component —
  // and with it the form store — stays mounted while the page holds
  // confirmingPlan, so prefill is an explicit reset (forms.md §3);
  // trigger() recomputes validity for the fresh defaults.
  useEffect(() => {
    form.reset(defaults)
    void form.trigger()
  }, [defaults, form])

  const handleSubmit = async (values: ConfirmPlanFormValues) => {
    try {
      await confirmPlan.mutateAsync(toConfirmInput(values, plan.id))
      form.reset(defaults)
      if (sheetRef.current) sheetRef.current.dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const rootError = form.formState.errors.root?.message

  return (
    <>
      {pickers.nodes}
      {/* The submit footer must live in @gorhom's footerComponent layer, not
          as the last child of the sheet content: with `keyboardBehavior="extend"`
          the sheet grows over the keyboard, the in-content footer's
          accessibility coordinates go stale, and taps (Maestro, XCTest) land on
          the keyboard instead of the button. The footer carries its own
          FormProvider: @gorhom/portal renders the content and the footer
          inside its host at the app root (a registry portal, not React's
          createPortal), so a provider above the <BottomSheet> reaches
          neither subtree (the plan-form-sheet pattern). */}
      <BottomSheet
        ref={sheetRef}
        presentOnMount
        testID="plans-confirm-sheet"
        snapPoints={['65%']}
        stackBehavior="push"
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        footerComponent={() => (
          <FormProvider {...form}>
            <PlansFormFooter
              testID="plans-confirm-submit"
              accessibilityLabel={PLANS_COPY.confirmSubmit}
              pending={confirmPlan.isPending}
              onSubmit={form.handleSubmit(handleSubmit)}
            />
          </FormProvider>
        )}
      >
        <pickers.Provider>
          <FormProvider {...form}>
            <BottomSheetView testID="plans-confirm-sheet" className="flex-1">
              <BottomSheetHeader
                title={PLANS_COPY.confirmTitle}
                subtitle={planRowTitle(plan, categories) || undefined}
              />

              <AmountField plan={plan} />

              <View className="flex-1 gap-1 px-4">
                <StaticRow label={view.accountLabel} value={account?.name ?? plan.accountId} />
                <StaticRow label="Категория" value={category?.name ?? plan.categoryId} />
                <PlansDateFieldRow field="occurredOn" testID="plans-confirm-date" />
                <PlansNoteFieldRow testID="plans-confirm-note" />

                <FormError testID="plans-confirm-error">{rootError}</FormError>
              </View>
            </BottomSheetView>
          </FormProvider>
        </pickers.Provider>
      </BottomSheet>
    </>
  )
}

/** Static context row for the plan's fixed references. */
function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3 py-3.5">
      <Text variant="body" className="text-muted-foreground">
        {label}
      </Text>
      <Text variant="body" className="flex-1 text-right text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

/** The editable amount with the plan's account currency chip beside it. */
function AmountField({ plan }: { plan: PlannedPayment }) {
  const { control, setValue } = useFormContext<ConfirmPlanFormValues>()
  const { field, fieldState } = useController({ name: 'amount', control })
  const accounts = useAccounts().data ?? []
  // The plan's fixed account owns the amount's currency (design D7).
  const currency = accounts.find((account) => account.id === plan.accountId)?.currency ?? 'RUB'

  return (
    <View className="gap-1 px-4 pt-2">
      <View className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
        <View className="flex-1">
          <BottomSheetInput
            testID="plans-confirm-amount"
            className="border-0 bg-transparent px-0 py-1 text-3xl font-bold"
            accessibilityLabel={PLANS_COPY.confirmAmountLabel}
            keyboardType="decimal-pad"
            placeholder="0"
            value={groupAmountInput(field.value)}
            onChangeText={(text) =>
              setValue('amount', sanitizeAmountInput(text), { shouldValidate: true })
            }
            invalid={Boolean(fieldState.error)}
          />
        </View>
        <Text variant="h3" className="text-muted-foreground" testID="plans-confirm-currency">
          {currencySymbol(currency)}
        </Text>
      </View>
      <FormError testID="plans-confirm-amount-error">{fieldState.error?.message}</FormError>
    </View>
  )
}
