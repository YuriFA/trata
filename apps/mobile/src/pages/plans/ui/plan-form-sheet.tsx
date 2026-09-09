// Plan add/edit form + sheet (conventions forms.md §2/§3, design D7): one
// discriminated-union schema whose `type` arm is fixed from the tapped card,
// a decimal-pad amount input with the selected account's currency chip (₽
// fallback — the edit-transaction amount idiom), an optional name, and the
// reference field rows (leading icon, muted label left, value right,
// chevron): account/category picker rows (category type-filtered), a
// next-due calendar row with NO lower bound (past dates are legal — a plan
// may start already overdue), and regularity / confirmation-mode / reminder
// rows opening single-choice option sheets. The note is an inline input
// row; the footer carries only the circular submit over `pb-safe`.
// The amount stays a digit string in form values (sanitized on input,
// grouping is display-only); the named mappers convert to int64 minor
// units exactly once at the submission boundary (forms.md §4).
//
// The root owns the form lifecycle and submission; the field sections
// live in `form-rows.tsx` and subscribe to their own slice through
// useFormContext (forms.md §8). Edit mode carries the record's CAS
// `version` and a delete affordance; the plan's `type` is immutable
// server-side and arrives only as the fixed variant context.

import { useEffect, useMemo, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormProvider, useForm } from 'react-hook-form'
import { Alert } from 'react-native'
import type { PlannedPayment, PlannedPaymentType } from '@trata/api'
import {
  useCreatePlannedPayment,
  useDeletePlannedPayment,
  useUpdatePlannedPayment,
  requestNotificationPermissions,
} from '@/entities/planned-payment'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { minorToInputValue } from '@/shared/lib/money/display'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetScrollView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { useSheetContentPickers } from '@/shared/ui/sheet-content-portal'
import { IconButton } from '@/shared/ui/icon-button'
import {
  PLANS_CONFIRM_MODE_DESCRIPTIONS,
  PLANS_CONFIRM_MODE_LABELS,
  PLANS_REGULARITY_OPTIONS,
  PLANS_REMINDER_LABELS,
  PLAN_TYPE_VIEWS,
} from '../model/kind'
import {
  planFormDefaultValues,
  planFormSchema,
  toCreatePayload,
  toUpdatePayload,
  type PlanFormValues,
} from '../model/schema'
import { PlansFormFooter } from './form-actions'
import {
  AccountRow,
  AmountField,
  CategoryRow,
  NameField,
  OptionFieldRow,
  PlansDateFieldRow,
  PlansNoteFieldRow,
  RootError,
} from './form-rows'

/** Either a create (type fixed from the card) or an edit (its plan). */
export type PlanFormSheetProps =
  | { type: PlannedPaymentType; plan?: undefined }
  | { type?: undefined; plan: PlannedPayment }

export function PlanFormSheet(props: PlanFormSheetProps) {
  // Both variants mount fresh with their subject; presentOnMount presents
  // them (forms.md §3) — a parent-side present() would race the conditional
  // mount and be lost. The ref stays for the post-submit dismissal.
  const sheetRef = useRef<BottomSheetRef>(null)
  // The pickers declared by the rows below re-render beside this sheet
  // element (outside its portal content) — see useSheetContentPickers.
  const pickers = useSheetContentPickers()

  const view = PLAN_TYPE_VIEWS[props.plan ? props.plan.type : props.type]

  const defaults = useMemo<PlanFormValues>(() => {
    if (props.plan) {
      const plan = props.plan
      return {
        type: plan.type,
        amount: minorToInputValue(plan.amount),
        name: plan.name,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        nextDue: plan.nextDue,
        regularity: plan.regularity,
        confirmMode: plan.confirmMode,
        reminder: plan.reminder,
        note: plan.note,
      }
    }
    return planFormDefaultValues(props.type)
    // Stable page state in both variants - defaults must not re-derive per
    // render, or the reset effect below would wipe the user's typing.
  }, [props.plan, props.type])

  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
  })
  const createPlan = useCreatePlannedPayment()
  const updatePlan = useUpdatePlannedPayment()
  const deletePlan = useDeletePlannedPayment()
  const pending = createPlan.isPending || updatePlan.isPending || deletePlan.isPending

  // @gorhom v5 unmounts the sheet content on close, but this component —
  // and with it the form store — stays mounted while the page holds the
  // create context / editingPlan, so prefill is an explicit reset
  // (forms.md §3); reset() does not re-run the resolver — trigger()
  // recomputes validity for the fresh defaults.
  useEffect(() => {
    form.reset(defaults)
    void form.trigger()
  }, [defaults, form])

  const dismiss = () => {
    // TODO(sheet-dismiss): see the matching TODO in
    // pages/debts/ui/new-debtor-debt-sheet.tsx.
    if (sheetRef && typeof sheetRef !== 'function') sheetRef.current?.dismiss()
  }

  const handleDeleteConfirm = async () => {
    if (!props.plan) return
    try {
      await deletePlan.mutateAsync(props.plan.id)
      dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const handleDelete = () => {
    // TODO(i18n): RU wording until mobile i18n wiring lands.
    Alert.alert('Удалить план?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void handleDeleteConfirm() },
    ])
  }

  const handleSubmit = async (values: PlanFormValues) => {
    try {
      if (props.plan) {
        await updatePlan.mutateAsync({
          id: props.plan.id,
          payload: toUpdatePayload(values, props.plan.version),
        })
      } else {
        await createPlan.mutateAsync(toCreatePayload(values))
        form.reset(defaults)
      }
      dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  // Both portaled subtrees carry their own FormProvider: @gorhom/portal
  // renders the content and the footer inside its host at the app root (a
  // registry portal, not React's createPortal), so a provider above the
  // <BottomSheet> reaches neither. The footer itself must stay in
  // footerComponent — an in-content footer's accessibility coordinates go
  // stale over the extended keyboard (see confirm-sheet).
  return (
    <>
      {pickers.nodes}
      <BottomSheet
        ref={sheetRef}
        presentOnMount
        snapPoints={['75%']}
        stackBehavior="push"
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        footerComponent={() => (
          <FormProvider {...form}>
            <PlansFormFooter
              testID="plans-form-submit"
              accessibilityLabel="Сохранить план"
              pending={pending}
              onSubmit={form.handleSubmit(handleSubmit)}
            />
          </FormProvider>
        )}
      >
        <pickers.Provider>
          <FormProvider {...form}>
            <BottomSheetHeader
              title={props.plan ? view.editTitle : view.addTitle}
              right={
                props.plan ? (
                  <IconButton
                    icon="trash-outline"
                    size="md"
                    colorClassName="accent-destructive"
                    accessibilityLabel="Удалить план"
                    testID="plans-form-delete"
                    disabled={pending}
                    onPress={handleDelete}
                  />
                ) : undefined
              }
            />

            {/* The visible element carrying the sheet testID (accounts-sheet
            pattern): the modal container is zero-bounds to Maestro. */}
            <BottomSheetScrollView
              testID="plans-form-sheet"
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}
            >
              <AmountField />
              <NameField />
              <AccountRow label={view.accountLabel} />
              <CategoryRow />
              <PlansDateFieldRow field="nextDue" testID="plans-form-date" />
              <OptionFieldRow
                label="Повтор"
                icon="repeat-outline"
                field="regularity"
                testID="plans-form-regularity"
                options={[
                  { value: 'daily', label: PLANS_REGULARITY_OPTIONS.daily },
                  { value: 'weekly', label: PLANS_REGULARITY_OPTIONS.weekly },
                  { value: 'monthly', label: PLANS_REGULARITY_OPTIONS.monthly },
                  { value: 'yearly', label: PLANS_REGULARITY_OPTIONS.yearly },
                ]}
              />
              <OptionFieldRow
                label="Подтверждение"
                icon="checkmark-circle-outline"
                field="confirmMode"
                testID="plans-form-confirm-mode"
                options={[
                  {
                    value: 'manual',
                    label: PLANS_CONFIRM_MODE_LABELS.manual,
                    caption: PLANS_CONFIRM_MODE_DESCRIPTIONS.manual,
                  },
                  {
                    value: 'auto',
                    label: PLANS_CONFIRM_MODE_LABELS.auto,
                    caption: PLANS_CONFIRM_MODE_DESCRIPTIONS.auto,
                  },
                ]}
              />
              <OptionFieldRow
                label="Напоминание"
                icon="notifications-outline"
                field="reminder"
                testID="plans-form-reminder"
                options={[
                  { value: 'off', label: PLANS_REMINDER_LABELS.off },
                  { value: 'day_before', label: PLANS_REMINDER_LABELS.day_before },
                  { value: 'on_day', label: PLANS_REMINDER_LABELS.on_day },
                ]}
                onValueChange={(next, previous) => {
                  // Permission is requested when a reminder is first enabled;
                  // denial is silent — the setting is stored and synced anyway and
                  // the scheduler no-ops (design D9).
                  if (previous === 'off' && next !== 'off') {
                    void requestNotificationPermissions()
                  }
                }}
              />
              <PlansNoteFieldRow testID="plans-form-note" />

              <RootError />
            </BottomSheetScrollView>
          </FormProvider>
        </pickers.Provider>
      </BottomSheet>
    </>
  )
}
