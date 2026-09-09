// The home-code panel sheet (household-ux 2.2, owner only). The API offers
// no read for an existing code - only generate/rotate (one POST) and revoke -
// so the panel starts empty («код не создан»), and Create/Rotate produce the
// current code, displayed as selectable text (long-press to copy). Rotating
// asks first: the previous code stops working immediately.
//
// TODO(i18n): RU wording until mobile i18n wiring lands.

import { useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import type { HouseholdCode } from '@trata/api'
import { useHouseholdActions } from '@/entities/household'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetHeader,
  BottomSheetView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { Text } from '@/shared/ui/text'

export interface HouseholdCodeSheetProps {
  onClose: () => void
}

export function HouseholdCodeSheet({ onClose }: HouseholdCodeSheetProps) {
  const sheetRef = useRef<BottomSheetRef>(null)
  const actions = useHouseholdActions()
  // The code is only knowable by generating it; null = none created here.
  const [code, setCode] = useState<HouseholdCode | null>(null)

  const handleGenerate = async () => {
    try {
      setCode(await actions.generateCode.mutateAsync(undefined))
    } catch (cause) {
      Alert.alert('Не удалось создать код', getRepositoryErrorText(cause))
    }
  }

  const handleRotate = () => {
    Alert.alert('Обновить код?', 'Прежний код перестанет действовать.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Обновить', style: 'destructive', onPress: () => void handleGenerate() },
    ])
  }

  const handleRevoke = () => {
    actions.revokeCode
      .mutateAsync(undefined)
      .then(() => setCode(null))
      .catch((cause: unknown) =>
        Alert.alert('Не удалось отозвать код', getRepositoryErrorText(cause)),
      )
  }

  return (
    <BottomSheet
      ref={sheetRef}
      presentOnMount
      testID="settings-household-code-sheet"
      snapPoints={['45%']}
      stackBehavior="push"
      onDismiss={onClose}
    >
      <BottomSheetView testID="settings-household-code-sheet">
        <BottomSheetBody>
          <View className="gap-4">
            <BottomSheetHeader title="Код вступления" />

            {code ? (
              <View className="gap-1" testID="settings-household-code-value-block">
                {/* Selectable: long-press offers the system Copy menu. */}
                <Text
                  variant="h3"
                  className="text-foreground text-center tracking-[0.3em]"
                  selectable
                  testID="settings-household-code-value"
                >
                  {code.code}
                </Text>
                <Text variant="caption" className="text-muted-foreground text-center">
                  Долгое нажатие — копирование. Код можно передать участнику лично.
                </Text>
              </View>
            ) : (
              <Text
                variant="body-sm"
                className="text-muted-foreground"
                testID="settings-household-code-none"
              >
                Код ещё не создан
              </Text>
            )}

            <View className="gap-2">
              {code ? (
                <>
                  <Button
                    variant="outline"
                    text="Обновить код"
                    loading={actions.generateCode.isPending}
                    disabled={actions.generateCode.isPending || actions.revokeCode.isPending}
                    onPress={handleRotate}
                    testID="settings-household-code-rotate"
                  />
                  <Button
                    variant="ghost"
                    text="Отозвать код"
                    loading={actions.revokeCode.isPending}
                    disabled={actions.generateCode.isPending || actions.revokeCode.isPending}
                    onPress={handleRevoke}
                    testID="settings-household-code-revoke"
                  />
                </>
              ) : (
                <Button
                  variant="primary"
                  text="Создать код"
                  loading={actions.generateCode.isPending}
                  disabled={actions.generateCode.isPending}
                  onPress={() => void handleGenerate()}
                  testID="settings-household-code-generate"
                />
              )}
            </View>
          </View>
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}
