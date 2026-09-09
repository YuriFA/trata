import { createContext, useContext, type ReactNode } from 'react'
import type { TransactionRepository } from '@trata/api'

const TransactionRepositoryContext = createContext<TransactionRepository | null>(null)

export interface TransactionRepositoryProviderProps {
  repository: TransactionRepository
  children: ReactNode
}

export function TransactionRepositoryProvider({
  repository,
  children,
}: TransactionRepositoryProviderProps) {
  return (
    <TransactionRepositoryContext.Provider value={repository}>
      {children}
    </TransactionRepositoryContext.Provider>
  )
}

/** Injects the transaction repository; throws when the provider is missing. */
export function useTransactionRepository(): TransactionRepository {
  const repository = useContext(TransactionRepositoryContext)
  if (!repository) {
    throw new Error('useTransactionRepository requires <TransactionRepositoryProvider> in the tree')
  }
  return repository
}
