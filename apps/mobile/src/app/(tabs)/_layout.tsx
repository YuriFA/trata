import { useRef, useState } from 'react'
import { View } from 'react-native'
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui'
import type { Href } from 'expo-router'
import { Icon } from '@/shared/ui/icon'
import { FAB_SIZE, SpeedDial, type SpeedDialAction } from '@/shared/ui/speed-dial'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { NewTransactionSheet, type TransactionFlowKind } from '@/features/create-transaction'
import {
  BottomTabBar,
  TabBarHeightProvider,
  useTabBarHeight,
  type TabConfig,
} from '@/widgets/bottom-tab-bar'

interface TabDef extends TabConfig {
  href: Href
}

// TODO(i18n): replace the hardcoded `label`s with the shared
// @trata/i18n bundle once react-i18next is wired in shared/i18n.
const TABS: readonly TabDef[] = [
  { name: 'index', href: '/', label: 'Главная', testId: 'tab-dashboard', icon: 'wallet-outline' },
  {
    name: 'plans',
    href: '/plans',
    label: 'Планы',
    testId: 'tab-plans',
    icon: 'document-text-outline',
  },
  {
    name: 'analytics',
    href: '/analytics',
    label: 'Аналитика',
    testId: 'tab-analytics',
    icon: 'analytics-outline',
  },
  {
    name: 'settings',
    href: '/settings',
    label: 'Настройки',
    testId: 'tab-settings',
    icon: 'settings-outline',
  },
] as const

// The speed dial opens the create-transaction sheet (a global overlay like
// the dial itself, not a route); the layout owns the open flow state.
function useTransactionActions(openFlow: (kind: TransactionFlowKind) => void): SpeedDialAction[] {
  return [
    {
      id: 'transfer',
      label: 'Transfer',
      accessibilityLabel: 'Add transfer',
      icon: <Icon name="swap-horizontal" size={24} colorClassName="accent-primary" />,
      className: 'bg-brand-aliceblue size-14',
      onPress: () => openFlow('transfer'),
    },
    {
      id: 'expense',
      label: 'Expense',
      accessibilityLabel: 'Add expense',
      icon: <Icon name="remove" size={36} colorClassName="accent-destructive-foreground" />,
      className: 'bg-destructive size-20',
      onPress: () => openFlow('expense'),
    },
    {
      id: 'income',
      label: 'Income',
      accessibilityLabel: 'Add income',
      icon: <Icon name="add" size={24} colorClassName="accent-success-foreground" />,
      className: 'bg-success size-14',
      onPress: () => openFlow('income'),
    },
  ]
}

export default function TabsLayout() {
  return (
    <TabBarHeightProvider>
      <TabsSurface />
    </TabBarHeightProvider>
  )
}

// The SpeedDial is a fullscreen overlay mounted as a SIBLING of <Tabs>, not
// inside the tab bar: its scrim must cover the whole screen (the bar slot is
// only ~80px), and rendered after <Tabs> it paints above the bar. The FAB is
// centered and straddles the bar's top edge via bottomOffset, so opening it
// never changes the active tab - it's a floating action, not a route.
function TabsSurface() {
  const tabBarHeight = useTabBarHeight()
  const transactionSheetRef = useRef<BottomSheetRef>(null)
  const [flow, setFlow] = useState<TransactionFlowKind>('expense')

  const openFlow = (kind: TransactionFlowKind) => {
    setFlow(kind)
    transactionSheetRef.current?.present()
  }
  const actions = useTransactionActions(openFlow)

  // Straddle the bar's top edge: FAB center at the bar top. tabBarHeight includes
  // the safe-area padding, so no separate inset is needed. Falls back to the
  // SpeedDial's safe-area default until the bar has laid out.
  const fabBottomOffset = tabBarHeight > 0 ? tabBarHeight - FAB_SIZE / 1.3 : undefined

  return (
    <View className="flex-1 bg-background">
      <Tabs>
        <TabSlot />
        <BottomTabBar tabs={TABS} />
        <TabList style={{ display: 'none' }}>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} />
          ))}
        </TabList>
      </Tabs>

      <SpeedDial
        bottomOffset={fabBottomOffset}
        actions={actions}
        label="Add transaction"
        closeLabel="Close transaction actions"
      />

      <NewTransactionSheet ref={transactionSheetRef} kind={flow} />
    </View>
  )
}
