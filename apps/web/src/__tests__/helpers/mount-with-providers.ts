import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia, type Pinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import i18n from '@/shared/i18n'
import type {
  AccountRepository,
  CategoryRepository,
  TransactionRepository,
  DebtorRepository,
  DebtOperationRepository,
} from '@trata/api'
import type { LocalPlannedPaymentRepository } from '@trata/local-data'
import { ACCOUNT_REPOSITORY_KEY } from '@/entities/account'
import { CATEGORY_REPOSITORY_KEY } from '@/entities/category'
import { TRANSACTION_REPOSITORY_KEY } from '@/entities/transaction'
import { DEBTOR_REPOSITORY_KEY } from '@/entities/debtor'
import { DEBT_OPERATION_REPOSITORY_KEY } from '@/entities/debt-operation'
import { PLANNED_PAYMENT_REPOSITORY_KEY } from '@/entities/planned-payment'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockTransactionRepository,
  createMockDebtorRepository,
  createMockDebtOperationRepository,
  createMockPlannedPaymentRepository,
} from './mock-repositories'

export interface MountWithProvidersOptions {
  pinia?: Pinia
  router?: Router
  repositories?: {
    accounts?: AccountRepository
    categories?: CategoryRepository
    transactions?: TransactionRepository
    debtors?: DebtorRepository
    debtOperations?: DebtOperationRepository
    plannedPayments?: LocalPlannedPaymentRepository
  }
  props?: Record<string, unknown>
  attrs?: Record<string, unknown>
  slots?: Record<string, unknown>
  global?: Record<string, unknown>
}

export function mountWithProviders<T>(
  component: T,
  options: MountWithProvidersOptions = {},
): VueWrapper {
  const { pinia, router, repositories, props, attrs, slots } = options

  const provide: Record<symbol, unknown> = {}
  if (options.repositories !== undefined) {
    provide[ACCOUNT_REPOSITORY_KEY as unknown as symbol] =
      repositories?.accounts ?? createMockAccountRepository()
    provide[CATEGORY_REPOSITORY_KEY as unknown as symbol] =
      repositories?.categories ?? createMockCategoryRepository()
    provide[TRANSACTION_REPOSITORY_KEY as unknown as symbol] =
      repositories?.transactions ?? createMockTransactionRepository()
    provide[DEBTOR_REPOSITORY_KEY as unknown as symbol] =
      repositories?.debtors ?? createMockDebtorRepository()
    provide[DEBT_OPERATION_REPOSITORY_KEY as unknown as symbol] =
      repositories?.debtOperations ?? createMockDebtOperationRepository()
    provide[PLANNED_PAYMENT_REPOSITORY_KEY as unknown as symbol] =
      repositories?.plannedPayments ?? createMockPlannedPaymentRepository()
  }

  const memoryRouter =
    router ??
    createRouter({
      history: createMemoryHistory(),
      // The mobile shell renders a sign-in link to the named login route
      // (web-screens: mobile top bar account access), so it must resolve.
      routes: [
        { path: '/', component: { template: '<div/>' } },
        { path: '/login', name: 'login', component: { template: '<div/>' } },
        { path: '/settings', name: 'settings', component: { template: '<div/>' } },
        {
          path: '/settings/categories',
          name: 'settings-categories',
          component: { template: '<div/>' },
        },
        {
          path: '/settings/data',
          name: 'settings-data',
          component: { template: '<div/>' },
        },
      ],
    })

  const globalOptions = options.global ?? {}
  const providedGlobals =
    typeof globalOptions.provide === 'object' && globalOptions.provide !== null
      ? (globalOptions.provide as Record<PropertyKey, unknown>)
      : {}

  return mount(component as never, {
    props: props as never,
    attrs: attrs as never,
    slots: slots as never,
    global: {
      ...globalOptions,
      plugins: [i18n, pinia ?? createPinia(), memoryRouter, PiniaColada],
      provide: {
        ...provide,
        ...providedGlobals,
      } as never,
    },
  }) as VueWrapper
}
