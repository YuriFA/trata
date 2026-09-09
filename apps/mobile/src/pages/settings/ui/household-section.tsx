// The «Пространство» settings group (household-ux 2.1-2.3): the household's
// display name (owner rename sheet), the member list (label/email, role,
// joined date), role-aware actions - owner: invite, outgoing invitations,
// home code, remove member, rename, dissolve; member: leave (clean start
// only - contributions stay with the household per ADR-0002, so the local
// wipe is not a choice) - plus the «У меня есть код» join entry for everyone.
// Actions the role does not permit are hidden, not disabled (household spec).
// Renders only while authenticated; the household query and the sheet state
// are owned here (components-and-state.md §5).
//
// TODO(i18n): RU wording until mobile i18n wiring lands.

import { useState } from 'react'
import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import { fullDayLabel } from '@trata/dates'
import type { HouseholdMember } from '@trata/api'
import {
  householdApi,
  householdDisplayName,
  memberLabel,
  useHousehold,
  useHouseholdActions,
} from '@/entities/household'
import { useHouseholdJoin } from '@/features/household-join'
import { useAuth } from '@/entities/session'
import { useTransactionRepository } from '@/entities/transaction/api/repository'
import { useDebtOperationRepository } from '@/entities/debt/api/repository'
import { usePlannedPaymentRepository } from '@/entities/planned-payment/api/repository'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { IconButton } from '@/shared/ui/icon-button'
import { Text } from '@/shared/ui/text'
import { HouseholdCodeSheet } from './household-code-sheet'
import { HouseholdInvitationsSheet } from './household-invitations-sheet'
import { HouseholdInviteSheet } from './household-invite-sheet'
import { HouseholdRenameSheet } from './household-rename-sheet'
import { JoinByCodeSheet } from './join-by-code-sheet'

/** Which owner sheet is mounted; null = none (join sheet is separate). */
type OwnerSheet = 'rename' | 'invite' | 'invitations' | 'code'

function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`
  return `${count} ${many}`
}

export function HouseholdSection() {
  const { status, user } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const actions = useHouseholdActions()
  const { performHouseholdJoin } = useHouseholdJoin()
  const transactionsRepository = useTransactionRepository()
  const debtOperationsRepository = useDebtOperationRepository()
  const plannedPaymentsRepository = usePlannedPaymentRepository()
  const [isLeaving, setIsLeaving] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  // A fresh session id per open mounts a keyed, clean sheet (forms.md §3,
  // the new-debtor-debt-sheet pattern); null = closed.
  const [joinSheetSession, setJoinSheetSession] = useState<number | null>(null)
  const [ownerSheet, setOwnerSheet] = useState<OwnerSheet | null>(null)
  const [ownerSheetSession, setOwnerSheetSession] = useState(0)

  if (status !== 'authenticated') return null

  const household = householdQuery.data
  const myMember = household?.members.find((member) => member.userId === user?.id)
  const isOwner = myMember?.role === 'owner'
  // The backend rejects an owner leaving while members remain; for everyone
  // else (and a solo owner) leave is offered.
  const canLeave = !isOwner || (household ? household.members.length === 1 : false)

  const openOwnerSheet = (sheet: OwnerSheet) => {
    setOwnerSheetSession((session) => session + 1)
    setOwnerSheet(sheet)
  }

  const handleJoinByCode = () => setJoinSheetSession((session) => (session ?? 0) + 1)

  const handleJoined = () => {
    setJoinSheetSession(null)
    router.navigate('/')
  }

  const handleLeaveConfirm = async () => {
    if (!household) return
    setIsLeaving(true)
    try {
      const personalHousehold = await householdApi.leave()
      // Clean start only (household-ux design D5): contributions stay with
      // the household (ADR-0002), so the local copy is wiped - never carried.
      await performHouseholdJoin(personalHousehold, 'clean')
      router.navigate('/')
    } catch (cause) {
      // Maps e.g. HOUSEHOLD_OWNER_WITH_MEMBERS to its RU wording.
      Alert.alert('Не удалось выйти', getRepositoryErrorText(cause))
    } finally {
      setIsLeaving(false)
    }
  }

  const handleLeave = () => {
    Alert.alert(
      'Покинуть домохозяйство?',
      'Ваши записи останутся в домохозяйстве и будут доступны оставшимся участникам. Это устройство начнёт с чистого листа.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Выйти', style: 'destructive', onPress: () => void handleLeaveConfirm() },
      ],
    )
  }

  const handleRemoveMember = (member: HouseholdMember) => {
    Alert.alert(
      'Удалить участника?',
      `${memberLabel(member)} потеряет доступ к общим данным домохозяйства.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            setRemovingMemberId(member.userId)
            actions.removeMember
              .mutateAsync(member.userId)
              .catch((cause: unknown) =>
                Alert.alert('Не удалось удалить участника', getRepositoryErrorText(cause)),
              )
              .finally(() => setRemovingMemberId(null))
          },
        },
      ],
    )
  }

  /** Local mirror counts for the destructive-confirm copy (design risk D3). */
  const fetchDissolveCounts = async () => {
    const [transactions, debtOperations, plans] = await Promise.all([
      transactionsRepository.query({}),
      debtOperationsRepository.getAll(),
      plannedPaymentsRepository.query({}),
    ])
    return [
      pluralRu(transactions.length, 'транзакция', 'транзакции', 'транзакций'),
      pluralRu(
        debtOperations.length,
        'долговая операция',
        'долговые операции',
        'долговых операций',
      ),
      pluralRu(plans.length, 'план', 'плана', 'планов'),
    ]
  }

  const handleDissolve = () => {
    void (async () => {
      let countsText = ''
      try {
        const [tx, ops, plans] = await fetchDissolveCounts()
        countsText = `\n\nБудет удалено: ${tx}, ${ops}, ${plans}.`
      } catch {
        // Counts are copy, not a gate - dissolve proceeds without them.
      }
      Alert.alert(
        'Распустить домохозяйство?',
        `Домохозяйство и все его общие данные будут безвозвратно удалены.${countsText}`,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Распустить',
            style: 'destructive',
            onPress: () => void handleDissolveConfirm(),
          },
        ],
      )
    })()
  }

  const handleDissolveConfirm = async () => {
    try {
      await actions.dissolve.mutateAsync(undefined)
      // The dissolving owner lands in a fresh personal household - the same
      // clean start as leave.
      const personalHousehold = await householdApi.getHousehold()
      await performHouseholdJoin(personalHousehold, 'clean')
      router.navigate('/')
    } catch (cause) {
      Alert.alert('Не удалось распустить домохозяйство', getRepositoryErrorText(cause))
    }
  }

  return (
    <>
      <Card variant="elevated" className="gap-3" testID="settings-household-section">
        <View className="flex-row items-center gap-2">
          <Icon name="people-outline" size={20} colorClassName="accent-primary" />
          <Text variant="h4">Пространство</Text>
        </View>
        {household ? (
          <>
            <Text variant="body" className="text-foreground" testID="settings-household-name">
              {householdDisplayName(household)}
            </Text>
            <Text
              variant="body-sm"
              className="text-muted-foreground"
              testID="settings-household-members"
            >
              {`Участников: ${household.members.length}`}
            </Text>

            <View className="gap-2" testID="settings-household-member-list">
              {household.members.map((member) => (
                <View
                  key={member.userId}
                  className="flex-row items-center gap-2"
                  testID={`settings-household-member-${member.userId}`}
                >
                  <View className="flex-1 gap-0.5">
                    <Text variant="body" className="text-foreground">
                      {memberLabel(member)}
                      {member.userId === user?.id ? ' (вы)' : ''}
                    </Text>
                    <Text variant="caption" className="text-muted-foreground">
                      {member.email}
                    </Text>
                  </View>
                  <View className="gap-0.5 items-end">
                    <Text variant="caption" className="text-muted-foreground">
                      {member.role === 'owner' ? 'Владелец' : 'Участник'}
                    </Text>
                    <Text variant="caption" className="text-muted-foreground">
                      {`С нами с ${fullDayLabel(member.joinedAt)}`}
                    </Text>
                  </View>
                  {isOwner && member.role !== 'owner' ? (
                    <IconButton
                      icon="person-remove-outline"
                      accessibilityLabel="Удалить участника"
                      colorClassName="accent-destructive"
                      disabled={removingMemberId !== null}
                      onPress={() => handleRemoveMember(member)}
                      testID={`settings-household-remove-${member.userId}`}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text variant="body-sm" className="text-muted-foreground">
            Загружаем домохозяйство…
          </Text>
        )}

        {isOwner ? (
          <View className="gap-2" testID="settings-household-owner-actions">
            <Button
              variant="outline"
              text="Пригласить по email"
              onPress={() => openOwnerSheet('invite')}
              testID="settings-household-invite-button"
            />
            <Button
              variant="outline"
              text="Приглашения"
              onPress={() => openOwnerSheet('invitations')}
              testID="settings-household-invitations-button"
            />
            <Button
              variant="outline"
              text="Код вступления"
              onPress={() => openOwnerSheet('code')}
              testID="settings-household-code-button"
            />
            <Button
              variant="ghost"
              text="Переименовать"
              onPress={() => openOwnerSheet('rename')}
              testID="settings-household-rename-button"
            />
            <Button
              variant="destructive"
              text="Распустить домохозяйство"
              onPress={handleDissolve}
              loading={actions.dissolve.isPending}
              disabled={actions.dissolve.isPending}
              testID="settings-household-dissolve-button"
            />
          </View>
        ) : null}

        <Button
          variant="outline"
          text="У меня есть код"
          onPress={handleJoinByCode}
          testID="settings-join-by-code-button"
        />
        {canLeave ? (
          <Button
            variant="destructive"
            text="Покинуть домохозяйство"
            loading={isLeaving}
            disabled={isLeaving}
            onPress={handleLeave}
            testID="settings-leave-household-button"
          />
        ) : null}
      </Card>
      {ownerSheet === 'rename' && household ? (
        <HouseholdRenameSheet
          key={`rename-${ownerSheetSession}`}
          household={household}
          onClose={() => setOwnerSheet(null)}
        />
      ) : null}
      {ownerSheet === 'invite' ? (
        <HouseholdInviteSheet
          key={`invite-${ownerSheetSession}`}
          onClose={() => setOwnerSheet(null)}
        />
      ) : null}
      {ownerSheet === 'invitations' ? (
        <HouseholdInvitationsSheet
          key={`invitations-${ownerSheetSession}`}
          onClose={() => setOwnerSheet(null)}
        />
      ) : null}
      {ownerSheet === 'code' ? (
        <HouseholdCodeSheet key={`code-${ownerSheetSession}`} onClose={() => setOwnerSheet(null)} />
      ) : null}
      {joinSheetSession !== null ? (
        <JoinByCodeSheet key={joinSheetSession} onJoined={handleJoined} />
      ) : null}
    </>
  )
}
