import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Mechanical posture guards for the custom service worker source
// (web-push change, ADR-0007): the worker may add push handling, but the
// settled web-pwa invariants must not drift - no runtime response caching,
// API navigations bypass the shell fallback, updates stay prompted, and
// notification activation navigates via postMessage (never a reload).

const here = dirname(fileURLToPath(import.meta.url))
const swSource = readFileSync(join(here, '..', 'sw.ts'), 'utf8')

describe('service worker posture', () => {
  it('introduces no runtime response caching', () => {
    expect(swSource).not.toMatch(/\bcaches\s*\./)
    expect(swSource).not.toMatch(/cache\s*\.\s*(put|match)/)
  })

  it('keeps API navigations out of the shell fallback', () => {
    expect(swSource).toContain('denylist: [/^\\/api\\//]')
  })

  it('activates a new build only when the page asks (prompted updates)', () => {
    expect(swSource).toContain('SKIP_WAITING')
  })

  it('navigates the focused window via postMessage, not client.navigate', () => {
    expect(swSource).toMatch(/postMessage\(\{\s*type:\s*'NAVIGATE'/)
    expect(swSource).not.toMatch(/\.navigate\(/)
  })
})
