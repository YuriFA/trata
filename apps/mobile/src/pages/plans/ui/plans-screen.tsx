// Plans screen (openspec mobile-local-data "Plans screen data behavior"):
// two type cards («Расходы» / «Доходы») each showing the live plan count and
// the normalized «X ₽/мес» figure, replacing the former placeholder. Tapping
// a card opens the per-type list sheet; its footer CTA and every row open
// the add/edit form; manual rows open the confirm sheet.
//
// Performance invariant (design D6/D7): every figure derives from ONE
// `usePlannedPayments()` read — counts, totals, and both lists are in-memory
// selectors; a single `useCategories()` read feeds the name-or-category row
// titles. The page owns ALL sheet refs and the `{type, session}` creation
// context (invariant #15).

import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { PlannedPayment, PlannedPaymentType } from '@trata/api'
import { useCategories } from '@/entities/category'
import { usePlannedPayments, reschedule } from '@/entities/planned-payment'
import { useHousehold } from '@/entities/household'
import { useAuth } from '@/entities/session'
import { Screen } from '@/shared/ui/screen'
import { Text } from '@/shared/ui/text'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { PLANS_COPY } from '../model/kind'
import { plansFigures } from '../model/selectors'
import { ConfirmSheet } from './confirm-sheet'
import { PlanFormSheet } from './plan-form-sheet'
import { PlansListSheet } from './plans-list-sheet'
import { PlansTypeCard } from './plans-card'

export function PlansScreen() {
  const plansQuery = usePlannedPayments()
  const categoriesQuery = useCategories()
  const plans = plansQuery.data ?? []
  const categories = categoriesQuery.data ?? []

  // Authorship markers context (household-ux 2.4): members cache + user id.
  const { status, user } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const author =
    status === 'authenticated'
      ? { members: householdQuery.data?.members ?? [], currentUserId: user?.id }
      : undefined

  // Reminder driver (design D9): re-sync local notifications whenever the
  // plans or categories query data identity changes — that covers local
  // mutations and pull-driven invalidation alike. Categories changes
  // re-run an idempotent no-op (the copy derives from plans only).
  const plansData = plansQuery.data
  const categoriesData = categoriesQuery.data
  useEffect(() => {
    void reschedule(plansData ?? [])
  }, [plansData, categoriesData])

  // Sheet composition state (invariant #15): the page owns every ref and the
  // subject each sheet acts on. The create context starts as a placeholder -
  // openCreate always sets it before the keyed form mounts.
  const listRef = useRef<BottomSheetRef>(null)
  const [listType, setListType] = useState<PlannedPaymentType>('expense')
  const [createContext, setCreateContext] = useState<
    { type: PlannedPaymentType; session: number } | undefined
  >(undefined)
  const [editingPlan, setEditingPlan] = useState<PlannedPayment | undefined>(undefined)
  const [confirmingPlan, setConfirmingPlan] = useState<PlannedPayment | undefined>(undefined)

  const openList = (type: PlannedPaymentType) => {
    setListType(type)
    listRef.current?.present()
  }
  const openCreate = (type: PlannedPaymentType) => {
    // A fresh session key per open remounts the sheet with clean values.
    setCreateContext((context) => ({ type, session: (context?.session ?? 0) + 1 }))
  }
  const openEdit = (plan: PlannedPayment) => setEditingPlan(plan)
  const openConfirm = (plan: PlannedPayment) => setConfirmingPlan(plan)

  return (
    <Screen testID="screen-plans">
      <ScrollView>
        <View className="gap-6 p-6">
          <Text variant="display">{PLANS_COPY.screenTitle}</Text>
          <PlansTypeCard
            type="expense"
            figures={plansFigures(plans, 'expense')}
            onPress={() => openList('expense')}
          />
          <PlansTypeCard
            type="income"
            figures={plansFigures(plans, 'income')}
            onPress={() => openList('income')}
          />
        </View>
      </ScrollView>

      <PlansListSheet
        ref={listRef}
        type={listType}
        plans={plans}
        categories={categories}
        author={author}
        onAdd={openCreate}
        onEdit={openEdit}
        onConfirm={openConfirm}
      />
      {createContext ? (
        <PlanFormSheet key={createContext.session} type={createContext.type} />
      ) : null}
      {editingPlan ? <PlanFormSheet key={editingPlan.id} plan={editingPlan} /> : null}
      {confirmingPlan ? <ConfirmSheet plan={confirmingPlan} /> : null}
    </Screen>
  )
}
