import { createContext, useContext, type ReactNode } from 'react'
import type { DebtOperationRepository, DebtorRepository } from '@trata/api'

interface DebtRepositories {
  debtorRepository: DebtorRepository
  debtOperationRepository: DebtOperationRepository
}

const DebtRepositoryContext = createContext<DebtRepositories | null>(null)

export interface DebtRepositoryProviderProps extends DebtRepositories {
  children: ReactNode
}

export function DebtRepositoryProvider({
  debtorRepository,
  debtOperationRepository,
  children,
}: DebtRepositoryProviderProps) {
  return (
    <DebtRepositoryContext.Provider value={{ debtorRepository, debtOperationRepository }}>
      {children}
    </DebtRepositoryContext.Provider>
  )
}

/** Injects the debt repositories; throws when the provider is missing. */
function useDebtRepositories(): DebtRepositories {
  const repositories = useContext(DebtRepositoryContext)
  if (!repositories) {
    throw new Error('useDebtRepositories requires <DebtRepositoryProvider> in the tree')
  }
  return repositories
}

export function useDebtorRepository(): DebtorRepository {
  return useDebtRepositories().debtorRepository
}

export function useDebtOperationRepository(): DebtOperationRepository {
  return useDebtRepositories().debtOperationRepository
}
