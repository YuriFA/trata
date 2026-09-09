import { createContext, useContext, type ReactNode } from 'react'
import type { AccountRepository } from '@trata/api'

const AccountRepositoryContext = createContext<AccountRepository | null>(null)

export interface AccountRepositoryProviderProps {
  repository: AccountRepository
  children: ReactNode
}

export function AccountRepositoryProvider({
  repository,
  children,
}: AccountRepositoryProviderProps) {
  return (
    <AccountRepositoryContext.Provider value={repository}>
      {children}
    </AccountRepositoryContext.Provider>
  )
}

/** Injects the account repository; throws when the provider is missing. */
export function useAccountRepository(): AccountRepository {
  const repository = useContext(AccountRepositoryContext)
  if (!repository) {
    throw new Error('useAccountRepository requires <AccountRepositoryProvider> in the tree')
  }
  return repository
}
