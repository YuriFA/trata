// Debts screen (openspec mobile-local-data "Debts screen data behavior"):
// dual-total summary («Мне должны» / «Я должен», no period navigation), two
// direction sections of debtor rows that always render (empty hints + the
// per-section «+» opening the combined contact+debt sheet, design D9),
// settled debtors behind reveal rows, and the sheet flows - debtor history
// (with its header rename + delete), fixed-context new/edit operation, and
// the rename-only debtor sheet. A stack destination without the tab bar, so
// the collapsible ScreenHeader carries the title and back affordance.
//
// Performance invariant (design D7): the whole overview derives from ONE
// `useDebtOperations()` read - every figure is an in-memory selector; the
// repository is never called per debtor. The page owns all sheet refs and
// passes callbacks down (invariant #15).

import { useRef, useState } from 'react'
import { View } from 'react-native'
import type { DebtDirection, DebtOperation, Debtor } from '@trata/api'
import { useDebtOperations, useDebtors } from '@/entities/debt'
import { useDisplayCurrency, useHousehold } from '@/entities/household'
import { useRates } from '@/shared/lib/db/rates'
import { aggregateByCurrency, type CurrencyAggregate } from '@/shared/lib/money/aggregate'
import { useAuth } from '@/entities/session'
import { Screen } from '@/shared/ui/screen'
import { ScreenHeader, ScreenScrollView } from '@/shared/ui/screen-header'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { DEBTS_COPY } from '../model/kind'
import { debtorSection } from '../model/selectors'
import { DebtorHistorySheet } from './debtor-history-sheet'
import { DebtorRenameSheet } from './debtor-rename-sheet'
import { DebtorSection } from './debtor-section'
import { DebtsSummaryCard } from './debts-summary-card'
import { NewDebtorDebtSheet } from './new-debtor-debt-sheet'
import { OperationSheet } from './operation-sheet'

export function DebtsScreen() {
  const debtorsQuery = useDebtors()
  const operationsQuery = useDebtOperations()
  const debtors = debtorsQuery.data ?? []
  const operations = operationsQuery.data ?? []

  const { status, user } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const author =
    status === 'authenticated'
      ? { members: householdQuery.data?.members ?? [], currentUserId: user?.id }
      : undefined

  // Sheet composition state (invariant #15): the page owns every ref and the
  // selection each sheet acts on. The create-operation context starts as a
  // placeholder - openNewOperation always sets it before presenting.
  const historyRef = useRef<BottomSheetRef>(null)
  const [historyContext, setHistoryContext] = useState<
    { debtorId: string; direction: DebtDirection } | undefined
  >(undefined)
  const [newDebtContext, setNewDebtContext] = useState<
    { direction: DebtDirection; session: number } | undefined
  >(undefined)
  const renameDebtorRef = useRef<BottomSheetRef>(null)
  const [renamingDebtor, setRenamingDebtor] = useState<Debtor | undefined>(undefined)
  const newOperationRef = useRef<BottomSheetRef>(null)
  const [newOperationFixed, setNewOperationFixed] = useState<{
    debtorId: string
    direction: DebtDirection
  }>({ debtorId: '', direction: 'receivable' })
  const editOperationRef = useRef<BottomSheetRef>(null)
  const [editingOperation, setEditingOperation] = useState<DebtOperation | undefined>(undefined)

  // Multi-currency direction totals (6.4): each debtor's balance stays in
  // the debtor's own (immutable) currency; the card presents the per-currency
  // aggregate with the optional «≈» conversion into the display currency.
  const displayCurrency = useDisplayCurrency(householdQuery.data?.currency)
  const rates = useRates().data ?? null
  const directionAggregate = (direction: DebtDirection): CurrencyAggregate =>
    aggregateByCurrency(
      debtorSection(debtors, operations, direction).visible.map(({ debtor, balance }) => ({
        currency: debtor.currency,
        amount: balance,
      })),
      displayCurrency,
      rates,
    )
  const receivableAggregate = directionAggregate('receivable')
  const payableAggregate = directionAggregate('payable')
  const receivableSection = debtorSection(debtors, operations, 'receivable')
  const payableSection = debtorSection(debtors, operations, 'payable')

  const openHistory = (debtorId: string, direction: DebtDirection) => {
    setHistoryContext({ debtorId, direction })
    historyRef.current?.present()
  }
  const historyDebtor = historyContext
    ? debtors.find((debtor) => debtor.id === historyContext.debtorId)
    : undefined

  const openNewDebtorDebt = (direction: DebtDirection) => {
    // From a section's «+»: one submit creates the contact and their initial
    // debt in that direction (design D9). A fresh session key per open
    // remounts the sheet with clean values.
    setNewDebtContext((context) => ({
      direction,
      session: (context?.session ?? 0) + 1,
    }))
  }
  const openNewOperation = (debtorId: string, direction: DebtDirection) => {
    // From a contact's sheet: contact and direction are fixed context, kind
    // defaults to «Долг» (design D9).
    setNewOperationFixed({ debtorId, direction })
    newOperationRef.current?.present()
  }
  const openEditOperation = (operation: DebtOperation) => {
    setEditingOperation(operation)
    editOperationRef.current?.present()
  }
  const openRenameDebtor = (debtor: Debtor) => {
    setRenamingDebtor(debtor)
    renameDebtorRef.current?.present()
  }

  return (
    <Screen testID="screen-debts" topInset={false}>
      <ScreenHeader title={DEBTS_COPY.screenTitle} />

      <ScreenScrollView>
        <View className="gap-6 px-6 pb-8">
          <DebtsSummaryCard
            receivable={receivableAggregate}
            payable={payableAggregate}
            ratesAsOf={rates?.asOf}
          />
          <DebtorSection
            direction="receivable"
            section={receivableSection}
            onDebtorPress={openHistory}
            onAdd={openNewDebtorDebt}
          />
          <DebtorSection
            direction="payable"
            section={payableSection}
            onDebtorPress={openHistory}
            onAdd={openNewDebtorDebt}
          />
        </View>
      </ScreenScrollView>

      <DebtorHistorySheet
        ref={historyRef}
        debtor={historyDebtor}
        direction={historyContext?.direction ?? 'receivable'}
        operations={operations}
        author={author}
        onEditOperation={openEditOperation}
        onRenameDebtor={openRenameDebtor}
        onNewOperation={openNewOperation}
      />
      {newDebtContext ? (
        <NewDebtorDebtSheet key={newDebtContext.session} direction={newDebtContext.direction} />
      ) : null}
      {renamingDebtor ? <DebtorRenameSheet ref={renameDebtorRef} debtor={renamingDebtor} /> : null}
      <OperationSheet ref={newOperationRef} fixed={newOperationFixed} />
      {editingOperation ? (
        <OperationSheet ref={editOperationRef} operation={editingOperation} />
      ) : null}
    </Screen>
  )
}
