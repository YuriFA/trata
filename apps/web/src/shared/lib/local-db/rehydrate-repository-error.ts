// Comlink's throw transfer preserves only an Error's message/name/stack -
// structured clone drops the class, and with it the machine `code` every
// frontend maps errors by (invariant #4). The worker-side repositories throw
// the typed RepositoryError subclasses from @trata/api; each class
// has a unique `name`, so the main-thread bridge rehydrates the exact subclass
// from the surviving name and rethrows it. `instanceof` and `error.code` keep
// working across the worker boundary; `apiCode`/`retryAfter` do not cross
// (no web repository flow consumes them).

import {
  AlreadyExistsError,
  ConflictError,
  InvalidPayloadError,
  NotFoundError,
  RateLimitedError,
  ReferentialIntegrityError,
  RepositoryError,
  UnauthorizedError,
  UnknownReferencesError,
  VersionConflictError,
} from '@trata/api'

const FACTORIES: Record<string, (message: string) => RepositoryError> = {
  NotFoundError: (message) => new NotFoundError(message),
  ReferentialIntegrityError: (message) => new ReferentialIntegrityError(message),
  InvalidPayloadError: (message) => new InvalidPayloadError(message),
  UnknownReferencesError: (message) => new UnknownReferencesError(message),
  VersionConflictError: (message) => new VersionConflictError(message),
  AlreadyExistsError: (message) => new AlreadyExistsError(message),
  UnauthorizedError: (message) => new UnauthorizedError(message),
  RateLimitedError: (message) => new RateLimitedError(message),
  ConflictError: (message) => new ConflictError(message),
}

/**
 * Restores the typed RepositoryError subclass for an error that crossed the
 * Comlink bridge (identified by its surviving `name`); anything else is
 * returned unchanged. Used as `catch (error) => { throw rehydrate(error) }` in
 * the main-thread forwarding seam.
 */
export function rehydrateRepositoryError(error: unknown): unknown {
  if (error instanceof RepositoryError) return error
  if (!(error instanceof Error)) return error

  const factory = FACTORIES[error.name]
  if (!factory) return error

  const rehydrated = factory(error.message)
  rehydrated.stack = error.stack
  return rehydrated
}
