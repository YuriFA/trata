// Coverage for the week/month/year period model from @trata/dates.
// Same constraint as month-to-utc-day-range.test.ts (see there for the full
// rationale): the model's output is timezone-dependent by design and a Jest
// process cannot change its own zone, so each case spawns a child Node process
// with the target TZ running the real helpers. Node 24 loads the TS source via
// type stripping, and the generated resolve hook appends `.ts` to
// extensionless relative specifiers used inside the package.

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'

const periodTsPath = resolve(__dirname, '../../../../../packages/dates/src/period.ts')
const periodTsUrl = pathToFileURL(periodTsPath).href

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

let registerEntry: string
let hookDir: string

beforeAll(() => {
  hookDir = join(tmpdir(), `period-model-${process.pid}`)
  mkdirSync(hookDir, { recursive: true })
  writeFileSync(join(hookDir, 'resolve-hook.mjs'), RESOLVE_HOOK)
  writeFileSync(join(hookDir, 'register.mjs'), REGISTER)
  registerEntry = join(hookDir, 'register.mjs')
})

afterAll(() => {
  rmSync(hookDir, { recursive: true, force: true })
})

/** Run `body` (importing the real period module as `period`) in TZ=`zone`. */
function runInZone<T>(zone: string, body: string): T {
  const script = `
import * as period from ${JSON.stringify(periodTsUrl)}
${body}
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
  return JSON.parse(result.stdout.trim().split('\n').at(-1) as string) as T
}

const TIMEOUT = 30_000

describe('period model · UTC anchors, ranges, labels, shifts', () => {
  it(
    'snaps the current week to Monday and maps it onto itself',
    () => {
      expect(
        runInZone(
          'UTC',
          `
  const cursor = period.currentPeriod('week', new Date(2026, 7, 7, 15, 0))
  console.log(JSON.stringify({
    start: cursor.start.toISOString().slice(0, 10),
    range: period.periodToUtcDayRange(cursor),
    label: period.periodRangeLabel(cursor),
  }))
`,
        ),
      ).toEqual({
        start: '2026-08-03',
        range: { fromDate: '2026-08-03', toDate: '2026-08-09' },
        label: '3 августа – 9 августа',
      })
    },
    TIMEOUT,
  )

  it(
    'maps the current month onto itself',
    () => {
      expect(
        runInZone(
          'UTC',
          `
  const cursor = period.currentPeriod('month', new Date(2026, 7, 15))
  console.log(JSON.stringify({
    start: cursor.start.toISOString().slice(0, 10),
    range: period.periodToUtcDayRange(cursor),
    label: period.periodRangeLabel(cursor),
  }))
`,
        ),
      ).toEqual({
        start: '2026-08-01',
        range: { fromDate: '2026-08-01', toDate: '2026-08-31' },
        label: '1 августа – 31 августа',
      })
    },
    TIMEOUT,
  )

  it(
    'maps the current year with the year in the label',
    () => {
      expect(
        runInZone(
          'UTC',
          `
  const cursor = period.currentPeriod('year', new Date(2026, 7, 15))
  console.log(JSON.stringify({
    start: cursor.start.toISOString().slice(0, 10),
    range: period.periodToUtcDayRange(cursor),
    label: period.periodRangeLabel(cursor),
  }))
`,
        ),
      ).toEqual({
        start: '2026-01-01',
        range: { fromDate: '2026-01-01', toDate: '2026-12-31' },
        label: '1 января – 31 декабря 2026',
      })
    },
    TIMEOUT,
  )

  it(
    'shifts weeks, wraps months across the year, and steps years',
    () => {
      expect(
        runInZone(
          'UTC',
          `
  const week = period.currentPeriod('week', new Date(2026, 7, 7))
  const december = period.currentPeriod('month', new Date(2026, 11, 15))
  const year = period.currentPeriod('year', new Date(2026, 3, 1))
  const decemberNext = period.shiftPeriod(december, 1)
  console.log(JSON.stringify({
    prevWeekStart: period.shiftPeriod(week, -1).start.toISOString().slice(0, 10),
    januaryStart: decemberNext.start.toISOString().slice(0, 10),
    nextYearStart: period.shiftPeriod(year, 1).start.toISOString().slice(0, 10),
    sameZeroShift: period.isSamePeriod(week, period.shiftPeriod(week, 0)),
    sameNextFalse: period.isSamePeriod(december, decemberNext),
    sameKindFalse: period.isSamePeriod(
      period.currentPeriod('month', new Date(2026, 7, 7)),
      period.currentPeriod('year', new Date(2026, 7, 7)),
    ),
  }))
`,
        ),
      ).toEqual({
        prevWeekStart: '2026-07-27',
        januaryStart: '2027-01-01',
        nextYearStart: '2027-01-01',
        sameZeroShift: true,
        sameNextFalse: false,
        sameKindFalse: false,
      })
    },
    TIMEOUT,
  )

  it(
    'labels a week spanning Dec 31 → Jan 1 with both years',
    () => {
      expect(
        runInZone(
          'UTC',
          `
  const cursor = { kind: 'week', start: new Date(2027, 11, 27) }
  console.log(JSON.stringify({
    range: period.periodToUtcDayRange(cursor),
    label: period.periodRangeLabel(cursor),
  }))
`,
        ),
      ).toEqual({
        range: { fromDate: '2027-12-27', toDate: '2028-01-02' },
        label: '27 декабря 2027 – 2 января 2028',
      })
    },
    TIMEOUT,
  )
})

describe('period model · UTC+3 (Europe/Moscow) widening', () => {
  it(
    'widens the week range into the previous UTC day',
    () => {
      expect(
        runInZone(
          'Europe/Moscow',
          `
  const cursor = { kind: 'week', start: new Date(2026, 7, 3) }
  console.log(JSON.stringify({ range: period.periodToUtcDayRange(cursor) }))
`,
        ),
      ).toEqual({ range: { fromDate: '2026-08-02', toDate: '2026-08-09' } })
    },
    TIMEOUT,
  )

  it(
    'widens the year range across New Year',
    () => {
      expect(
        runInZone(
          'Europe/Moscow',
          `
  const cursor = { kind: 'year', start: new Date(2026, 0, 1) }
  console.log(JSON.stringify({ range: period.periodToUtcDayRange(cursor) }))
`,
        ),
      ).toEqual({ range: { fromDate: '2025-12-31', toDate: '2026-12-31' } })
    },
    TIMEOUT,
  )
})

interface PeriodContract {
  range: { fromDate: string; toDate: string }
  firstBoundary: string
  lastBoundary: string
  firstInPeriod: boolean
  firstInPrev: boolean
  lastInPeriod: boolean
  lastInNext: boolean
}

/** Range + membership contract holds in any zone; literals pin the zone math. */
function expectPeriodContract(contract: PeriodContract) {
  const { range, firstBoundary, lastBoundary } = contract
  // Repository day-filter window admits both local-period boundary instants.
  expect(firstBoundary >= `${range.fromDate}T00:00:00.000Z`).toBe(true)
  expect(firstBoundary <= `${range.toDate}T23:59:59.999Z`).toBe(true)
  expect(lastBoundary >= `${range.fromDate}T00:00:00.000Z`).toBe(true)
  expect(lastBoundary <= `${range.toDate}T23:59:59.999Z`).toBe(true)
  // Local-period membership: boundaries count toward this period only.
  expect(contract.firstInPeriod).toBe(true)
  expect(contract.firstInPrev).toBe(false)
  expect(contract.lastInPeriod).toBe(true)
  expect(contract.lastInNext).toBe(false)
}

describe('period model · UTC-4 (America/New_York, EDT) boundaries', () => {
  it(
    'keeps the week range a superset of local-week membership',
    () => {
      expectPeriodContract(
        runInZone(
          'America/New_York',
          `
  const cursor = { kind: 'week', start: new Date(2026, 7, 3) }
  const prev = { kind: 'week', start: new Date(2026, 6, 27) }
  const next = { kind: 'week', start: new Date(2026, 7, 10) }
  const firstBoundary = new Date(2026, 7, 3, 0, 30).toISOString()
  const lastBoundary = new Date(2026, 7, 9, 23, 30).toISOString()
  const inCursor = (iso, c) => period.transactionsInPeriod([{ occurredAt: iso }], c).length === 1
  console.log(JSON.stringify({
    range: period.periodToUtcDayRange(cursor),
    firstBoundary,
    lastBoundary,
    firstInPeriod: inCursor(firstBoundary, cursor),
    firstInPrev: inCursor(firstBoundary, prev),
    lastInPeriod: inCursor(lastBoundary, cursor),
    lastInNext: inCursor(lastBoundary, next),
  }))
`,
        ),
      )
    },
    TIMEOUT,
  )

  it(
    'keeps the year range a superset of local-year membership at New Year',
    () => {
      expectPeriodContract(
        runInZone(
          'America/New_York',
          `
  const cursor = { kind: 'year', start: new Date(2026, 0, 1) }
  const prev = { kind: 'year', start: new Date(2025, 0, 1) }
  const next = { kind: 'year', start: new Date(2027, 0, 1) }
  const firstBoundary = new Date(2026, 0, 1, 0, 30).toISOString()
  const lastBoundary = new Date(2026, 11, 31, 23, 30).toISOString()
  const inCursor = (iso, c) => period.transactionsInPeriod([{ occurredAt: iso }], c).length === 1
  console.log(JSON.stringify({
    range: period.periodToUtcDayRange(cursor),
    firstBoundary,
    lastBoundary,
    firstInPeriod: inCursor(firstBoundary, cursor),
    firstInPrev: inCursor(firstBoundary, prev),
    lastInPeriod: inCursor(lastBoundary, cursor),
    lastInNext: inCursor(lastBoundary, next),
  }))
`,
        ),
      )
    },
    TIMEOUT,
  )
})
