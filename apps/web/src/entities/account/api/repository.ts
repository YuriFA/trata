import { inject, type InjectionKey } from 'vue'
import type { AccountRepository, CreateAccountPayload, UpdateAccountPayload } from '@trata/api'

export type { AccountRepository, CreateAccountPayload, UpdateAccountPayload } from '@trata/api'

export const ACCOUNT_REPOSITORY_KEY: InjectionKey<AccountRepository> = Symbol('account-repository')

export function useAccountRepository(): AccountRepository {
  const repo = inject(ACCOUNT_REPOSITORY_KEY)
  if (!repo) {
    throw new Error('AccountRepository not provided. Call provideRepositories(app) in main.ts.')
  }
  return repo
}
