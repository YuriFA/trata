// Debtor history sheet: the remaining balance of one debtor-direction
// ledger, the day-grouped operation history («Долг» / «Списание» with
// sign-colored amounts), the header's rename + destructive delete-debtor
// affordances (simplify-debt-domain: deletion lives here - the confirmation
// shows the live-operation count and warns on a non-zero net balance, and
// the confirmed remove cascades in the repository), a row tap opening the
// edit-operation sheet, and the «Новая операция» footer CTA opening the
// fixed-context operation form (design D9). Rename flows up to the page
// (invariant #15 - the page owns the sheet composition); the delete mutation
// runs here, its success closing this sheet.
import { Alert, View } from 'react-native'
import type { DebtDirection, DebtOperation, Debtor } from '@trata/api'
import { useDeleteDebtor } from '@/entities/debt'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetRef,
  BottomSheetScrollView,
  BottomSheetView,
} from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { cn } from '@/shared/lib/utils'
import { formatAmount } from '@/shared/lib/format/format'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { balanceInDirection } from '@trata/local-data'
import { DEBTS_COPY, DEBT_DIRECTION_VIEWS, DEBT_KIND_LABELS } from '../model/kind'
import { debtorHistoryGroups, type DebtAuthorContext } from '../model/selectors'

export interface DebtorHistorySheetProps {
  ref: React.Ref<BottomSheetRef>
  /** The debtor + direction of the ledger; renders nothing while unset. */
  debtor: Debtor | undefined
  direction: DebtDirection
  /** ALL live operations (the screen's single query - D7 perf invariant). */
  operations: DebtOperation[]
  /** Authorship context for the row markers (household-ux 2.4). */
  author?: DebtAuthorContext
  onEditOperation: (operation: DebtOperation) => void
  onRenameDebtor: (debtor: Debtor) => void
  onNewOperation: (debtorId: string, direction: DebtDirection) => void
}

export function DebtorHistorySheet({
  ref,
  debtor,
  direction,
  operations,
  author,
  onEditOperation,
  onRenameDebtor,
  onNewOperation,
}: DebtorHistorySheetProps) {
  // The sheet element mounts with the first selection and presents itself
  // (presentOnMount); later opens and debtor swaps go through the page's
  // imperative present() while the sheet stays mounted.
  const deleteDebtor = useDeleteDebtor()

  if (!debtor) return null

  const dismiss = () => {
    // TODO(sheet-dismiss): see the matching TODO in
    // features/cashflow-overview/ui/edit-category-sheet.tsx.
    if (ref && typeof ref !== 'function') ref.current?.dismiss()
  }

  const handleDeleteConfirm = async () => {
    try {
      await deleteDebtor.mutateAsync(debtor.id)
      dismiss()
    } catch (cause) {
      Alert.alert('Не удалось удалить должника', getRepositoryErrorText(cause))
    }
  }

  const groups = debtorHistoryGroups(operations, debtor.id, direction, debtor.currency, author)
  // The cascade deletes the debtor's WHOLE ledger: the confirmation counts
  // every live operation (both directions) and warns on the debtor's net
  // balance (receivable − payable), the only single figure of the debt left
  // behind. Formatting follows the app's money convention (minor units).
  const liveOperationCount = operations.filter((op) => op.debtorId === debtor.id).length
  const netBalance =
    balanceInDirection(operations, debtor.id, 'receivable') -
    balanceInDirection(operations, debtor.id, 'payable')
  const deleteMessage =
    `Должник будет удалён вместе со всеми своими операциями (${liveOperationCount}).` +
    (netBalance !== 0 ? ` Баланс ненулевой (${formatAmount(netBalance, debtor.currency)}).` : '')

  const handleDeleteDebtor = () => {
    // TODO(i18n): RU wording until mobile i18n wiring lands
    // (debts.deleteDebtorTitle / deleteDebtorMessage / deleteDebtorBalanceWarning).
    Alert.alert('Удалить должника?', deleteMessage, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void handleDeleteConfirm() },
    ])
  }

  return (
    <BottomSheet
      ref={ref}
      presentOnMount
      snapPoints={['75%']}
      testID="debts-history-sheet"
      stackBehavior="push"
    >
      {/* The visible element carrying the sheet testID (accounts-sheet
          pattern): the modal container is zero-bounds to Maestro. */}
      <BottomSheetView testID="debts-history-sheet" className="flex-1">
        <BottomSheetHeader
          title={debtor.name}
          right={
            <View className="flex-row items-center gap-1">
              <IconButton
                icon="create-outline"
                size="md"
                colorClassName="accent-muted-foreground"
                accessibilityLabel="Переименовать должника"
                testID="debts-history-rename-debtor"
                onPress={() => onRenameDebtor(debtor)}
              />
              <IconButton
                icon="trash-outline"
                size="md"
                colorClassName="accent-destructive"
                accessibilityLabel="Удалить должника"
                testID="debts-history-delete-debtor"
                disabled={deleteDebtor.isPending}
                onPress={handleDeleteDebtor}
              />
            </View>
          }
        />
        <BottomSheetScrollView testID="debts-history-list">
          <View className="gap-3 px-4 pb-4">
            <View className="gap-1">
              <Text variant="caption" className="uppercase text-muted-foreground">
                {DEBT_DIRECTION_VIEWS[direction].summaryLabel}
              </Text>
              <Text variant="h1" className="text-foreground" testID="debts-history-balance">
                {formatAmount(
                  balanceInDirection(operations, debtor.id, direction),
                  debtor.currency,
                )}
              </Text>
            </View>

            {groups.length === 0 ? (
              <Text variant="body-sm" className="py-2 text-muted-foreground">
                {DEBTS_COPY.historyEmpty}
              </Text>
            ) : (
              groups.map((group) => (
                <View key={group.key} className="gap-1" testID={`debts-history-day-${group.key}`}>
                  <Text variant="caption" className="text-muted-foreground">
                    {group.title}
                  </Text>
                  {group.rows.map((row) => (
                    <Pressable
                      key={row.id}
                      testID={`debts-history-op-${row.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${DEBT_KIND_LABELS[row.kind]}, ${row.amountText}`}
                      className="flex-row items-center gap-3 py-3 active:opacity-70"
                      onPress={() => {
                        const operation = operations.find((op) => op.id === row.id)
                        if (operation) onEditOperation(operation)
                      }}
                    >
                      <View className="flex-1 gap-0.5">
                        <Text variant="body" className="text-foreground" numberOfLines={1}>
                          {DEBT_KIND_LABELS[row.kind]}
                        </Text>
                        {row.authorLabel ? (
                          <Text
                            variant="caption"
                            className="text-muted-foreground"
                            testID={`debts-history-op-${row.id}-author`}
                          >
                            {row.authorLabel}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        variant="body"
                        className={cn(
                          'font-medium',
                          row.kind === 'debt' ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {row.amountText}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </View>
        </BottomSheetScrollView>

        <View className="px-4 pb-safe pt-3">
          <Button
            variant="primary"
            text={DEBTS_COPY.newOperation}
            testID="debts-new-repayment"
            onPress={() => onNewOperation(debtor.id, direction)}
          />
        </View>
      </BottomSheetView>
    </BottomSheet>
  )
}
