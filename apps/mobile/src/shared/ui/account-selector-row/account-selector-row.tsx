import type { AccountWithBalance } from '@trata/api'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import { cn } from '@/shared/lib/utils'

/**
 * The account row at the top of the sheet ("Счёт · Выберите счёт ›").
 * Tapping opens the account picker sheet stacked above this one.
 */
export function AccountSelectorRow({
  label,
  account,
  placeholder = 'Выберите счёт',
  disabled = false,
  onPress,
  testID,
}: {
  /** Field label: "Счёт" for cash flows, "Откуда"/"Куда" for transfers. */
  label: string
  account: AccountWithBalance | undefined
  placeholder?: string
  disabled?: boolean
  onPress: () => void
  testID: string
}) {
  const value = account?.name ?? placeholder
  const isPlaceholder = account === undefined

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      className="flex-row items-center gap-2 border-b border-border py-3"
      onPress={onPress}
    >
      <Text variant="body-sm" className="text-muted-foreground">
        {label}
      </Text>
      <Text
        variant="body"
        className={cn('flex-1', isPlaceholder ? 'text-muted-foreground' : 'text-foreground')}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Icon name="chevron-forward" size={16} colorClassName="accent-muted-foreground" />
    </Pressable>
  )
}
