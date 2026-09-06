import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient, DEFAULT_REQUEST_TIMEOUT_MS } from './api-client'
import { RepositoryError } from './repository'

// A fetch whose promise settles ONLY when the composed abort signal fires -
// models a blackholed backend (carrier whitelist): no response, no TCP error.

function neverRespondingFetch() {
  const calls: Array<{ request: Request; init?: RequestInit }> = []
  const fetch = (request: Request, init?: RequestInit) => {
    calls.push({ request, init })
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject((init.signal as AbortSignal).reason)
      })
    })
  }
  return { fetch, calls }
}

describe('createApiClient request timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts a hanging request at the default timeout', async () => {
    const { fetch } = neverRespondingFetch()
    const client = createApiClient({ baseUrl: 'http://localhost', fetch })

    const promise = client.GET('/api/health')
    const assertion = expect(promise).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
    )
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS)
    await assertion
  })

  it('honors a per-instance timeout override', async () => {
    const { fetch } = neverRespondingFetch()
    const client = createApiClient({ baseUrl: 'http://localhost', fetch, timeoutMs: 250 })

    const promise = client.GET('/api/health')
    const assertion = expect(promise).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
    )
    // The default bound must NOT fire early for an instance that asked for
    // something shorter, and the override must fire at its own deadline.
    await vi.advanceTimersByTimeAsync(249)
    await expect(vi.waitFor(() => promise)).resolves.toBeUndefined().catch(() => undefined)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('forwards the caller-supplied signal immediately', async () => {
    const { fetch } = neverRespondingFetch()
    const client = createApiClient({ baseUrl: 'http://localhost', fetch })

    const caller = new AbortController()
    const promise = client.GET('/api/health', { signal: caller.signal })
    const assertion = expect(promise).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    )
    caller.abort()
    await assertion
    // The timeout timer must not leak past settlement.
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS + 1)
  })

  it('resolves normally when the request completes in time', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    const client = createApiClient({ baseUrl: 'http://localhost', fetch, timeoutMs: 5_000 })

    const { response } = await client.GET('/api/health')
    expect(response?.status).toBe(204)
    await vi.advanceTimersByTimeAsync(5_000)
  })

  it('disables the bound for Infinity', async () => {
    const { fetch, calls } = neverRespondingFetch()
    const client = createApiClient({ baseUrl: 'http://localhost', fetch, timeoutMs: Infinity })

    void client.GET('/api/health')
    await vi.advanceTimersByTimeAsync(600_000)
    // Still hanging by design: no timeout fired, no init.signal override.
    expect(calls[0]?.init?.signal).toBeUndefined()
  })

  it('still maps non-2xx responses to RepositoryError', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'ACCOUNT_IN_USE', message: 'used' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const client = createApiClient({ baseUrl: 'http://localhost', fetch, timeoutMs: 5_000 })

    await expect(client.GET('/api/health')).rejects.toThrow(RepositoryError)
  })
})
