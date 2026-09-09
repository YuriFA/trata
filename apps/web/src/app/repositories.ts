import type { App } from 'vue'
import { ACCOUNT_REPOSITORY_KEY } from '@/entities/account'
import { CATEGORY_REPOSITORY_KEY } from '@/entities/category'
import { TRANSACTION_REPOSITORY_KEY } from '@/entities/transaction'
import { DEBTOR_REPOSITORY_KEY } from '@/entities/debtor'
import { DEBT_OPERATION_REPOSITORY_KEY } from '@/entities/debt-operation'
import { PLANNED_PAYMENT_REPOSITORY_KEY } from '@/entities/planned-payment'
import { getLocalDbApi, rehydrateRepositoryError } from '@/shared/lib/local-db'
import type { LocalDbApi } from '@/shared/lib/local-db'

type RepositorySegment =
  | 'accounts'
  | 'categories'
  | 'transactions'
  | 'debtors'
  | 'debtOperations'
  | 'plannedPayments'

/**
 * The single repository variant (design D4): Comlink `Remote` repositories
 * from the local-db worker, cast to the shared `Repository` interfaces behind
 * DI keys from `@trata/api`. `provide()` is synchronous while the
 * worker handshake is not, so each repository is a forwarding Proxy - the
 * queueing contract of design D1: repository interfaces are entirely async,
 * and every method call awaits the ready handshake before RPCing into the
 * worker. Worker-side RepositoryErrors are rehydrated from their surviving
 * `name` so error mapping by `code` (invariant #4) keeps working.
 *
 * Comlink subtlety baked into this shape: only the ROOT remote proxy is ever
 * awaited (safe - its `then` trap fulfills with itself). A path-extended
 * proxy like `api.accounts` must never cross an `await`: its `then` trap
 * issues a wire GET for the whole repository object, which is not
 * structured-cloneable. So the segment is resolved and called per invocation,
 * never materialized as a promise.
 */
function localRepository<K extends RepositorySegment>(segment: K): LocalDbApi[K] {
  const apiPromise = getLocalDbApi()

  return new Proxy({} as LocalDbApi[K], {
    get(target, property, receiver) {
      // Never look like a thenable: something awaiting the repository object
      // itself must not hit the forwarding path.
      if (typeof property !== 'string' || property === 'then') {
        return Reflect.get(target, property, receiver)
      }
      return async (...args: unknown[]) => {
        const api = await apiPromise
        const repository = api[segment] as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
        const method = repository[property]
        if (!method) {
          throw new TypeError(`Unknown repository method: ${property}`)
        }
        try {
          return await method(...args)
        } catch (error) {
          throw rehydrateRepositoryError(error)
        }
      }
    },
  }) as LocalDbApi[K]
}

/** Provides the local (worker-backed) repositories under their DI keys. */
export function provideRepositories(app: App): void {
  app.provide(ACCOUNT_REPOSITORY_KEY, localRepository('accounts'))
  app.provide(CATEGORY_REPOSITORY_KEY, localRepository('categories'))
  app.provide(TRANSACTION_REPOSITORY_KEY, localRepository('transactions'))
  app.provide(DEBTOR_REPOSITORY_KEY, localRepository('debtors'))
  app.provide(DEBT_OPERATION_REPOSITORY_KEY, localRepository('debtOperations'))
  app.provide(PLANNED_PAYMENT_REPOSITORY_KEY, localRepository('plannedPayments'))
}
