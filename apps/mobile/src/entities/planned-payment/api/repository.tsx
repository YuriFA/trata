import { createContext, useContext, type ReactNode } from 'react'
import type { LocalPlannedPaymentRepository } from '@trata/local-data'

const PlannedPaymentRepositoryContext = createContext<LocalPlannedPaymentRepository | null>(null)

export interface PlannedPaymentRepositoryProviderProps {
  repository: LocalPlannedPaymentRepository
  children: ReactNode
}

export function PlannedPaymentRepositoryProvider({
  repository,
  children,
}: PlannedPaymentRepositoryProviderProps) {
  return (
    <PlannedPaymentRepositoryContext.Provider value={repository}>
      {children}
    </PlannedPaymentRepositoryContext.Provider>
  )
}

/** Injects the planned-payment repository; throws when the provider is missing. */
export function usePlannedPaymentRepository(): LocalPlannedPaymentRepository {
  const repository = useContext(PlannedPaymentRepositoryContext)
  if (!repository) {
    throw new Error(
      'usePlannedPaymentRepository requires <PlannedPaymentRepositoryProvider> in the tree',
    )
  }
  return repository
}
