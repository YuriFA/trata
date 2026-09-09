// Coverage for `monthToUtcDayRange` from @trata/dates. The
// helper's output is timezone-dependent by design, but a Jest test process
// cannot change its own zone: Jest sandboxes `process.env` (TZ writes never
// reach the real environment) and fake timers' `timeZone` only overrides
// `getTimezoneOffset` — V8 resolves local Date construction against the real
// process environment at construction time. So each case spawns a child Node
// process with the target TZ running the real helper. Node 24 loads the TS
// source via type stripping, and the generated resolve hook appends `.ts` to
// extensionless relative specifiers (bundler-style) used inside the package.

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'

const monthTsPath = resolve(__dirname, '../../../../../packages/dates/src/month.ts')
const monthTsUrl = pathToFileURL(monthTsPath).href

const RESOLVE_HOOK = `export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return nextResolve(specifier + '.ts', context)
    }
    throw error
  }
}
`

const REGISTER = `import { register } from 'node:module'
register(new URL('./resolve-hook.mjs', import.meta.url))
`

interface ZoneEvaluation {
  range: { fromDate: string; toDate: string }
  /** 00:30 local on the 1st and 23:30 local on the last day, as UTC ISO. */
  firstBoundary: string
  lastBoundary: string
  firstInMonth: boolean
  firstInPrevMonth: boolean
  lastInMonth: boolean
  lastInNextMonth: boolean
}

let registerEntry: string
let hookDir: string

beforeAll(() => {
  hookDir = join(tmpdir(), `month-to-utc-day-range-${process.pid}`)
  mkdirSync(hookDir, { recursive: true })
  writeFileSync(join(hookDir, 'resolve-hook.mjs'), RESOLVE_HOOK)
  writeFileSync(join(hookDir, 'register.mjs'), REGISTER)
  registerEntry = join(hookDir, 'register.mjs')
})

afterAll(() => {
  rmSync(hookDir, { recursive: true, force: true })
})

function evaluateInZone(
  zone: string,
  { year, month, lastDay }: { year: number; month: number; lastDay: number },
): ZoneEvaluation {
  const prevMonth = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
  const nextMonth = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
  const script = `
import { monthToUtcDayRange, transactionsInMonth } from ${JSON.stringify(monthTsUrl)}
const cursor = { year: ${year}, month: ${month} }
const firstBoundary = new Date(${year}, ${month}, 1, 0, 30).toISOString()
const lastBoundary = new Date(${year}, ${month}, ${lastDay}, 23, 30).toISOString()
const inMonth = (iso, c) => transactionsInMonth([{ occurredAt: iso }], c).length === 1
console.log(JSON.stringify({
  range: monthToUtcDayRange(cursor),
  firstBoundary,
  lastBoundary,
  firstInMonth: inMonth(firstBoundary, cursor),
  firstInPrevMonth: inMonth(firstBoundary, ${JSON.stringify(prevMonth)}),
  lastInMonth: inMonth(lastBoundary, cursor),
  lastInNextMonth: inMonth(lastBoundary, ${JSON.stringify(nextMonth)}),
}))
`
  const result = spawnSync(
    process.execPath,
    ['--import', registerEntry, '--input-type=module', '-e', script],
    { env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 15_000 },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`node child failed in TZ=${zone}: ${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim().split('\n').at(-1) as string)
}

/** Range + membership contract holds in any zone; literals pin the zone math. */
function expectMonthContract(evaluation: ZoneEvaluation, cursor: { year: number; month: number }) {
  const { range, firstBoundary, lastBoundary } = evaluation
  // Repository day-filter window admits both local-month boundary instants.
  expect(firstBoundary >= `${range.fromDate}T00:00:00.000Z`).toBe(true)
  expect(firstBoundary <= `${range.toDate}T23:59:59.999Z`).toBe(true)
  expect(lastBoundary >= `${range.fromDate}T00:00:00.000Z`).toBe(true)
  expect(lastBoundary <= `${range.toDate}T23:59:59.999Z`).toBe(true)
  // Local-month membership: boundaries count toward this month only.
  expect(evaluation.firstInMonth).toBe(true)
  expect(evaluation.firstInPrevMonth).toBe(false)
  expect(evaluation.lastInMonth).toBe(true)
  expect(evaluation.lastInNextMonth).toBe(false)
  void cursor
}

const TIMEOUT = 30_000

describe('monthToUtcDayRange · UTC', () => {
  it(
    'maps a 31-day month onto itself',
    () => {
      expect(evaluateInZone('UTC', { year: 2026, month: 7, lastDay: 31 }).range).toEqual({
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
      })
    },
    TIMEOUT,
  )

  it(
    'maps a 30-day month onto itself',
    () => {
      expect(evaluateInZone('UTC', { year: 2026, month: 3, lastDay: 30 }).range).toEqual({
        fromDate: '2026-04-01',
        toDate: '2026-04-30',
      })
    },
    TIMEOUT,
  )
})

describe('monthToUtcDayRange · UTC+3 (Europe/Moscow)', () => {
  it(
    'widens fromDate into the previous UTC day (31-day month)',
    () => {
      expect(evaluateInZone('Europe/Moscow', { year: 2026, month: 7, lastDay: 31 }).range).toEqual({
        fromDate: '2026-07-31',
        toDate: '2026-08-31',
      })
    },
    TIMEOUT,
  )

  it(
    'wraps the year in January: fromDate lands in the previous year',
    () => {
      expect(evaluateInZone('Europe/Moscow', { year: 2027, month: 0, lastDay: 31 }).range).toEqual({
        fromDate: '2026-12-31',
        toDate: '2027-01-31',
      })
    },
    TIMEOUT,
  )

  it(
    'keeps December inside its own UTC days',
    () => {
      expect(evaluateInZone('Europe/Moscow', { year: 2026, month: 11, lastDay: 31 }).range).toEqual(
        {
          fromDate: '2026-11-30',
          toDate: '2026-12-31',
        },
      )
    },
    TIMEOUT,
  )

  it(
    'is a superset of local-month membership at month boundaries',
    () => {
      expectMonthContract(evaluateInZone('Europe/Moscow', { year: 2026, month: 7, lastDay: 31 }), {
        year: 2026,
        month: 7,
      })
    },
    TIMEOUT,
  )
})

describe('monthToUtcDayRange · UTC-5 (America/New_York)', () => {
  it(
    'widens toDate into the next UTC month (summer, EDT)',
    () => {
      expect(
        evaluateInZone('America/New_York', { year: 2026, month: 7, lastDay: 31 }).range,
      ).toEqual({
        fromDate: '2026-08-01',
        toDate: '2026-09-01',
      })
    },
    TIMEOUT,
  )

  it(
    'widens toDate into the next UTC month at standard time (EST, 31-day month)',
    () => {
      expect(
        evaluateInZone('America/New_York', { year: 2027, month: 0, lastDay: 31 }).range,
      ).toEqual({
        fromDate: '2027-01-01',
        toDate: '2027-02-01',
      })
    },
    TIMEOUT,
  )

  it(
    'is a superset of local-month membership at month boundaries',
    () => {
      expectMonthContract(
        evaluateInZone('America/New_York', { year: 2027, month: 0, lastDay: 31 }),
        { year: 2027, month: 0 },
      )
    },
    TIMEOUT,
  )
})
