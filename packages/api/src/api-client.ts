import createClient from 'openapi-fetch'
import { errorMiddleware } from './api-errors'
import type { paths } from './schema'

/**
 * Fetch-like function the factory wraps: receives the fully-built Request
 * (whose `signal` carries any per-call abort signal) and may receive an
 * overriding `init.signal` from the timeout composition.
 */
type FetchLike = (request: Request, init?: RequestInit) => Promise<Response>

export interface CreateApiClientOptions {
  /**
   * Base URL the generated client builds absolute Request URLs from. Omit (or
   * pass `''`) for same-origin relative requests, which is the default in the
   * web app via its dev/preview proxy. Each app resolves its own base URL from
   * its environment - the factory itself never touches `window`.
   */
  baseUrl?: string
  /** Cookie/credential mode for outgoing requests (default `'include'`). */
  credentials?: RequestCredentials
  /**
   * Custom fetch used for requests. Defaults to the global `fetch` (resolved
   * lazily per request so tests can spy on it between calls).
   */
  fetch?: FetchLike
  /**
   * Upper bound for a single request, milliseconds. Prevents an unreachable
   * backend (carrier-whitelisted networks blackhole foreign IPs - requests
   * neither fail nor respond) from stalling callers for the browser's full
   * TCP timeout (minutes on mobile). An aborted request rejects through the
   * same path as any other network failure, so existing retry/backoff
   * handling applies unchanged. Pass `Infinity` to disable. Default 10s.
   */
  timeoutMs?: number
}

/** Default single-request bound: see {@link CreateApiClientOptions.timeoutMs}. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/**
 * Creates an `openapi-fetch` client typed against the generated OpenAPI
 * contract, with the error middleware attached so every non-2xx response is
 * thrown as a typed {@link RepositoryError}. Works in any environment that
 * provides the fetch-family globals (browser, Node, React Native).
 */
export function createApiClient(options: CreateApiClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((request) => globalThis.fetch(request))

  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: options.credentials ?? 'include',
    // Resolve `fetch` lazily so tests can spy on the global between calls.
    // The wrapper bounds every request: a controller aborts after
    // `timeoutMs`, forwarding any abort of the caller's own signal so both
    // sources reject the in-flight fetch. Aborts surface as ordinary fetch
    // rejections - the same path as any network failure.
    fetch: (request) => {
      if (!Number.isFinite(timeoutMs)) return doFetch(request)
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
        timeoutMs,
      )
      const forwardAbort = () => controller.abort(request.signal.reason)
      if (request.signal.aborted) return Promise.reject(request.signal.reason)
      request.signal.addEventListener('abort', forwardAbort, { once: true })
      return doFetch(request, { signal: controller.signal }).finally(() => {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', forwardAbort)
      })
    },
  })

  // Every non-2xx response is mapped to a thrown RepositoryError (api-errors.ts).
  client.use(errorMiddleware)
  return client
}

export type ApiClient = ReturnType<typeof createApiClient>
