// Outgoing invitations sheet (household-ux 2.2, owner only): the household's
// invitations with status + expiry and the resend (re-invite refreshes the
// token/expiry) / revoke actions. Mounted per open; the query and the two
// mutation states are owned here.
//
// TODO(i18n): RU wording until mobile i18n wiring lands.

import { useRef } from 'react'
import { Alert, View } from 'react-native'
import { dateTimeLabel } from '@trata/dates'
import type { HouseholdInvitation } from '@trata/api'
import { useHouseholdActions, useHouseholdInvitations } from '@/entities/household'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetHeader,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { Text } from '@/shared/ui/text'

export interface HouseholdInvitationsSheetProps {
  onClose: () => void
}

const STATUS_LABELS: Record<HouseholdInvitation['status'], string> = {
  pending: 'Ожидает',
  accepted: 'Принято',
  revoked: 'Отозвано',
  expired: 'Истекло',
}

export function HouseholdInvitationsSheet({ onClose }: HouseholdInvitationsSheetProps) {
  const sheetRef = useRef<BottomSheetRef>(null)
  // The sheet only mounts for the owner, so the listing runs unconditionally.
  const invitationsQuery = useHouseholdInvitations()
  const actions = useHouseholdActions()

  const handleResend = (invitation: HouseholdInvitation) => {
    actions.invite
      .mutateAsync(invitation.email)
      .catch((cause: unknown) =>
        Alert.alert('Не удалось отправить приглашение', getRepositoryErrorText(cause)),
      )
  }

  const handleRevoke = (invitation: HouseholdInvitation) => {
    actions.revokeInvitation
      .mutateAsync(invitation.id)
      .catch((cause: unknown) =>
        Alert.alert('Не удалось отозвать приглашение', getRepositoryErrorText(cause)),
      )
  }

  return (
    <BottomSheet
      ref={sheetRef}
      presentOnMount
      testID="settings-household-invitations-sheet"
      snapPoints={['60%']}
      stackBehavior="push"
      onDismiss={onClose}
    >
      <BottomSheetView testID="settings-household-invitations-sheet">
        <BottomSheetHeader title="Приглашения" />
        <BottomSheetBody>
          <BottomSheetScrollView showsVerticalScrollIndicator={false}>
            <View className="gap-3 pb-4">
              {invitationsQuery.isLoading ? (
                <Text variant="body-sm" className="text-muted-foreground">
                  Загружаем приглашения…
                </Text>
              ) : null}
              {!invitationsQuery.isLoading && !invitationsQuery.data?.length ? (
                <Text variant="body-sm" className="text-muted-foreground">
                  Нет отправленных приглашений
                </Text>
              ) : null}
              {invitationsQuery.data?.map((invitation) => (
                <View
                  key={invitation.id}
                  className="gap-1.5"
                  testID={`settings-household-invitation-${invitation.id}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Text variant="body" className="text-foreground flex-1">
                      {invitation.email}
                    </Text>
                    <Text
                      variant="caption"
                      className="text-muted-foreground"
                      testID={`settings-household-invitation-${invitation.id}-status`}
                    >
                      {STATUS_LABELS[invitation.status]}
                    </Text>
                  </View>
                  <Text variant="caption" className="text-muted-foreground">
                    {`Истекает ${dateTimeLabel(invitation.expiresAt)}`}
                  </Text>
                  {invitation.status === 'pending' ? (
                    <View className="flex-row gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        text="Отправить снова"
                        loading={
                          actions.invite.isPending && actions.invite.variables === invitation.email
                        }
                        disabled={actions.invite.isPending || actions.revokeInvitation.isPending}
                        onPress={() => handleResend(invitation)}
                        testID={`settings-household-invitation-${invitation.id}-resend`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        text="Отозвать"
                        loading={
                          actions.revokeInvitation.isPending &&
                          actions.revokeInvitation.variables === invitation.id
                        }
                        disabled={actions.invite.isPending || actions.revokeInvitation.isPending}
                        onPress={() => handleRevoke(invitation)}
                        testID={`settings-household-invitation-${invitation.id}-revoke`}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </BottomSheetScrollView>
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}
