// Invitation accept screen (household-join design D6): previews the
// invitation by its token, then accepts with an explicit local-data choice.
// States:
// - unauthenticated (no session, or 401 from the preview) → no error UI;
//   auto-navigate to login carrying the invite path as the return
//   `redirect` param (design D1),
// - wrong account (403 EMAIL_MISMATCH) → a card naming the signed-in email,
// - dead invitations (expired / revoked / accepted / not found) → a dead
//   card with a «Понятно» back-home button,
// - success → the accept view: household name (inviter email prefix
//   fallback), members count, the inviter line, the carry/clean choice
//   (carry preselected, decided HERE - no second dialog), and the accept
//   button.
//
// The choice is applied through the shared household-join feature
// (rebase/wipe + cache invalidation + forced sync), then the app lands on
// the tabs home.
//
// TODO(i18n): RU wording until mobile i18n wiring lands.

import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { UnauthorizedError, RepositoryError } from '@trata/api'
import { emailLocalPart, householdApi } from '@/entities/household'
import { useAuth } from '@/entities/session'
import { useHouseholdJoin, type HouseholdDataChoice } from '@/features/household-join'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { FormError } from '@/shared/ui/form'
import { Icon } from '@/shared/ui/icon'
import { Pressable } from '@/shared/ui/pressable'
import { Screen } from '@/shared/ui/screen'
import { ScreenHeader, ScreenScrollView } from '@/shared/ui/screen-header'
import { Text } from '@/shared/ui/text'

function isApiCode(error: unknown, code: string): boolean {
  return error instanceof RepositoryError && error.apiCode === code
}

/** One radio-style row of the carry/clean choice. */
function ChoiceRow({
  testID,
  label,
  caption,
  selected,
  onPress,
}: {
  testID: string
  label: string
  caption: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      className={cn(
        'flex-row items-center gap-3 rounded-2xl border p-4',
        selected ? 'border-primary bg-primary/10' : 'border-border',
      )}
      onPress={onPress}
    >
      <View className="flex-1 gap-0.5">
        <Text variant="body" className="text-foreground">
          {label}
        </Text>
        <Text variant="caption" className="text-muted-foreground">
          {caption}
        </Text>
      </View>
      {selected ? <Icon name="checkmark-circle" size={22} colorClassName="accent-primary" /> : null}
    </Pressable>
  )
}

export function InviteScreen({ token }: { token: string }) {
  const { status, user } = useAuth()
  const { performHouseholdJoin } = useHouseholdJoin()
  const [choice, setChoice] = useState<HouseholdDataChoice>('carry')
  const [isAccepting, setIsAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  // The query key carries the auth status so the login round-trip restarts
  // the preview on return (the screen itself stays mounted in the stack).
  const previewQuery = useQuery({
    queryKey: ['invite-preview', token, status],
    queryFn: () => householdApi.previewInvitation(token),
    enabled: status === 'authenticated',
    retry: false,
  })

  // 401 → no error UI; hand the user to login with the way back (design D1).
  const redirectRef = useRef(false)
  useEffect(() => {
    if (redirectRef.current) return
    if (status === 'anonymous' || previewQuery.error instanceof UnauthorizedError) {
      redirectRef.current = true
      router.push({ pathname: '/login', params: { redirect: `/invite/${token}` } })
    }
  }, [previewQuery.error, status, token])

  const handleAccept = async () => {
    setIsAccepting(true)
    setAcceptError(null)
    try {
      const household = await householdApi.acceptInvitation(token)
      // The choice was made on this screen - apply it directly, no dialog.
      await performHouseholdJoin(household, choice)
      router.navigate('/')
    } catch (cause) {
      setAcceptError(getRepositoryErrorText(cause))
      setIsAccepting(false)
    }
  }

  const handleGoHome = () => router.navigate('/')

  const renderBody = () => {
    const unauthorized = previewQuery.error instanceof UnauthorizedError
    if (status === 'restoring' || !previewQuery.isError || unauthorized) {
      const preview = previewQuery.data
      if (!preview) {
        return (
          <View className="items-center gap-3 py-12" testID="invite-screen-loading">
            <ActivityIndicator size="large" />
            <Text variant="body" className="text-muted-foreground">
              Загружаем приглашение…
            </Text>
          </View>
        )
      }

      const householdName = preview.householdName ?? emailLocalPart(preview.inviterEmail)
      return (
        <Card variant="elevated" className="gap-4" testID="invite-screen-card">
          <View className="gap-1">
            <Text variant="h3" className="text-foreground" testID="invite-household-name">
              {householdName}
            </Text>
            <Text variant="body-sm" className="text-muted-foreground" testID="invite-members-count">
              {`Участников: ${preview.membersCount}`}
            </Text>
          </View>
          <Text variant="body" className="text-muted-foreground" testID="invite-inviter">
            {`Вас пригласил: ${preview.inviterDisplayName ?? preview.inviterEmail}`}
          </Text>

          <View className="gap-2">
            <Text variant="body-sm" className="text-muted-foreground">
              Данные на этом устройстве
            </Text>
            <ChoiceRow
              testID="invite-choice-carry"
              label="Перенести данные"
              caption="Локальные записи попадут в новое домохозяйство"
              selected={choice === 'carry'}
              onPress={() => setChoice('carry')}
            />
            <ChoiceRow
              testID="invite-choice-clean"
              label="Начать с чистого листа"
              caption="Локальные записи будут удалены"
              selected={choice === 'clean'}
              onPress={() => setChoice('clean')}
            />
          </View>

          <FormError testID="invite-accept-error">{acceptError}</FormError>

          <Button
            variant="primary"
            text="Присоединиться"
            loading={isAccepting}
            disabled={isAccepting}
            onPress={handleAccept}
            testID="invite-accept-button"
          />
        </Card>
      )
    }

    if (isApiCode(previewQuery.error, 'HOUSEHOLD_INVITATION_EMAIL_MISMATCH')) {
      return (
        <Card variant="elevated" className="gap-3" testID="invite-screen-email-mismatch">
          <Text variant="h4">Приглашение отправлено на другой адрес</Text>
          <Text variant="body" className="text-muted-foreground">
            {user ? `Вы вошли как ${user.email}.` : null}
          </Text>
          <Button
            variant="outline"
            text="Понятно"
            onPress={handleGoHome}
            testID="invite-screen-ok"
          />
        </Card>
      )
    }

    // Dead invitations (lifecycle codes) and anything else (e.g. offline):
    // the mapped RU text with a way out.
    return (
      <Card variant="elevated" className="gap-3" testID="invite-screen-error">
        <Text variant="h4">Приглашение недоступно</Text>
        <Text variant="body" className="text-muted-foreground" testID="invite-screen-error-text">
          {getRepositoryErrorText(previewQuery.error)}
        </Text>
        <Button variant="outline" text="Понятно" onPress={handleGoHome} testID="invite-screen-ok" />
      </Card>
    )
  }

  return (
    <Screen testID="screen-invite" topInset={false}>
      <ScreenHeader title="Приглашение" />
      <ScreenScrollView>
        <View className="gap-6 px-6 pb-8">{renderBody()}</View>
      </ScreenScrollView>
    </Screen>
  )
}
