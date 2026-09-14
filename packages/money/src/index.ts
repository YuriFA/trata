// Platform-agnostic money model + formatting + balance math.
//
// All amounts are integer minor units (kopeks); float is forbidden in storage
// and calculation. Formatting is locale- and currency-aware via a small
// deterministic, `Intl`-free formatter (Hermes-safe on React Native;
// identical output on web). No DOM or framework APIs.

export { formatMoney, formatMoneyCompact, currencySymbol } from './format'
export { toMoney, type Money } from './money'
export {
  CURRENCY_MAP,
  AVAILABLE_CURRENCIES,
  DEFAULT_CURRENCY,
  isCurrencyCode,
  getDineroCurrency,
  type CurrencyCode,
} from './currencies'
export { toMinorUnits, toMajorUnits } from './convert'
export { fetchLatestRates, convert, type CurrencyRates, type FetchLike } from './rates'
export {
  getTransactionImpactForAccount,
  sumTransactionsImpactForAccount,
  getAccountsBalances,
  getComputedAccountBalance,
  type TransactionImpact,
  type BalanceAccount,
} from './balance-calculator'
