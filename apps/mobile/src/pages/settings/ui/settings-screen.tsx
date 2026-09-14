// Settings screen: pure composition of independently owned sections — the
// account card (auth + the logout interaction), the profile card (display
// name + preview), the household card (members + role-aware actions), the
// sync card (its own status query), and the dev-only offline gate (its own
// toggle). Each section subscribes to what it renders
// (components-and-state.md §5/§8); the screen holds no state of its own.

import { ScrollView, View } from 'react-native'
import { Screen } from '@/shared/ui/screen'
import { Text } from '@/shared/ui/text'
import { AccountSection } from './account-section'
import { DevOfflineSection } from './dev-offline-section'
import { DisplayCurrencySection } from './display-currency-section'
import { HouseholdSection } from './household-section'
import { ProfileSection } from './profile-section'
import { SyncSection } from './sync-section'

export function SettingsScreen() {
  return (
    <Screen testID="screen-settings">
      <ScrollView>
        <View className="p-6 gap-6">
          <View className="gap-2">
            <Text variant="h2">Настройки</Text>
          </View>
          <AccountSection />
          <ProfileSection />
          <HouseholdSection />
          <DisplayCurrencySection />
          <SyncSection />
          <DevOfflineSection />
        </View>
      </ScrollView>
    </Screen>
  )
}
