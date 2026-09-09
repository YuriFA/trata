// Pure parsing and validation of the CSV import template (web-data-transfer):
// RFC-4180 CSV (`;`-separated, quotes, CRLF, BOM), header-name mapping
// (RU/EN synonyms, order-independent), per-row validation, and deterministic
// row ids that make re-imports idempotent. Amounts are major units converted
// to int64 minor units exactly once, here at the row-mapper seam.

import { toMinorUnits } from '@trata/money'
import type { Account } from '@/entities/account'
import { CSV_NO_ACCOUNT_LABEL } from '@/features/export-csv'

type ImportDirection = 'income' | 'expense'

type ImportRowErrorCode =
  | 'bad-type'
  | 'bad-date'
  | 'bad-amount'
  | 'empty-category'
  | 'unknown-account'
  | 'category-conflict'

export interface ValidImportRow {
  status: 'valid'
  /** 1-based file line of the row (the header is line 1). */
  line: number
  direction: ImportDirection
  /** `YYYY-MM-DDT12:00:00.000Z` — the neutral import time. */
  occurredAt: string
  categoryName: string
  amountMinor: number
  note: string
  /** Resolved account id, or null for «Без счета». */
  accountId: string | null
  accountName: string | null
  /** Deterministic id: stable across imports of the same row content. */
  id: string
}

interface InvalidImportRow {
  status: 'invalid'
  line: number
  code: ImportRowErrorCode
}

export type ParsedImportRow = ValidImportRow | InvalidImportRow

export interface ImportParseResult {
  /** File-level error code, or null when the header parsed. */
  headerError: 'missing-columns' | 'empty-file' | null
  rows: ParsedImportRow[]
}

type ColumnKey = 'date' | 'type' | 'category' | 'amount' | 'note' | 'account'

const HEADER_ALIASES: Record<ColumnKey, readonly string[]> = {
  date: ['дата', 'date'],
  type: ['тип', 'type'],
  category: ['категория', 'category'],
  amount: ['сумма', 'amount'],
  note: ['примечание', 'комментарий', 'note', 'comment'],
  account: ['счёт', 'счет', 'account'],
}

/** RFC-4180 CSV cell grid: `;` delimiter, `"` quotes (doubled inside),
 * CRLF/LF/CR row breaks, leading BOM stripped. */
export function parseCsvGrid(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false

  const pushField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const pushRow = () => {
    pushField()
    // Skip fully-empty trailing lines produced by trailing line breaks.
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (char === ';') {
      pushField()
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i++
      pushRow()
      continue
    }
    field += char
    fieldStarted = true
  }
  if (fieldStarted || row.length > 0) pushRow()

  return rows
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

function mapHeaders(headerCells: string[]): Partial<Record<ColumnKey, number>> | null {
  const mapping: Partial<Record<ColumnKey, number>> = {}
  headerCells.forEach((cell, index) => {
    const normalized = normalizeHeader(cell)
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, string[]][]) {
      if (aliases.includes(normalized) && mapping[key] === undefined) mapping[key] = index
    }
  })
  if (
    mapping.date === undefined ||
    mapping.type === undefined ||
    mapping.category === undefined ||
    mapping.amount === undefined
  ) {
    return null
  }
  return mapping
}

/** `DD.MM.YYYY`, `DD.MM.YY` (→ 20YY), or `YYYY-MM-DD` → `YYYY-MM-DD`. */
function parseImportDate(value: string): string | null {
  const trimmed = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso) return validateDay(iso[1]!, iso[2]!, iso[3]!) ? trimmed : null
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/.exec(trimmed)
  if (ru) {
    const year = ru[3]!.length === 2 ? `20${ru[3]}` : ru[3]!
    const day = ru[1]!.padStart(2, '0')
    const month = ru[2]!.padStart(2, '0')
    return validateDay(year, month, day) ? `${year}-${month}-${day}` : null
  }
  return null
}

function validateDay(year: string, month: string, day: string): boolean {
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`).getUTCDate()
  return parsed === Number(day)
}

/** Major units (`1 234,56`, `1234.56`, `-1234`) → minor units (integer, ≥ 1). */
function parseImportAmount(value: string): number | null {
  const normalized = value.replace(/[\s ]/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const minor = toMinorUnits(Number(normalized))
  return Number.isSafeInteger(minor) && Math.abs(minor) >= 1 ? Math.abs(minor) : null
}

function parseImportType(value: string): ImportDirection | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'доход' || normalized === 'income') return 'income'
  if (normalized === 'расход' || normalized === 'expense') return 'expense'
  return null
}

const NO_ACCOUNT_NAMES = new Set([CSV_NO_ACCOUNT_LABEL.toLowerCase(), 'no account'])

/** Account column → id (matched by name, case-insensitive) or null («Без счета»). */
function parseImportAccount(
  value: string,
  accounts: readonly Account[],
): { accountId: string | null; accountName: string | null; ok: boolean } {
  const trimmed = value.trim()
  if (!trimmed || NO_ACCOUNT_NAMES.has(trimmed.toLowerCase())) {
    return { accountId: null, accountName: null, ok: true }
  }
  const match = accounts.find((account) => account.name.toLowerCase() === trimmed.toLowerCase())
  return match
    ? { accountId: match.id, accountName: match.name, ok: true }
    : { accountId: null, accountName: trimmed, ok: false }
}

// Pure SHA-256 (compact, dependency-free): deterministic ids must hash in
// every environment — crypto.subtle is absent in some runtimes (and async).

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const padded = [...bytes, 0x80]
  while (padded.length % 64 !== 56) padded.push(0)
  for (let i = 7; i >= 0; i--) padded.push((bitLength / 2 ** (8 * i)) & 0xff)

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  for (let block = 0; block < padded.length; block += 64) {
    const w = Array.from({ length: 64 }, () => 0)
    for (let i = 0; i < 16; i++) {
      w[i] =
        (padded[block + i * 4]! << 24) |
        (padded[block + i * 4 + 1]! << 16) |
        (padded[block + i * 4 + 2]! << 8) |
        padded[block + i * 4 + 3]!
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
    }
    let a = h[0]!,
      b = h[1]!,
      c = h[2]!,
      d = h[3]!,
      e = h[4]!,
      f = h[5]!,
      g = h[6]!,
      hh = h[7]!
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + SHA_K[i]! + w[i]!) | 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }
    h[0] = (h[0]! + a) | 0
    h[1] = (h[1]! + b) | 0
    h[2] = (h[2]! + c) | 0
    h[3] = (h[3]! + d) | 0
    h[4] = (h[4]! + e) | 0
    h[5] = (h[5]! + f) | 0
    h[6] = (h[6]! + g) | 0
    h[7] = (h[7]! + hh) | 0
  }

  return h.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('')
}

/** Deterministic UUID-shaped id from the normalized row key: the same file
 * row always maps to the same id, so re-imports skip instead of duplicating. */
export function importRowId(key: string): string {
  const hex = sha256Hex(`expense-tracker:import:${key}`)
  // v4-shaped (version + variant nibbles forced) purely for shape parity.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface ImportParseContext {
  accounts: readonly Account[]
}

export async function parseImportCsv(
  text: string,
  context: ImportParseContext,
): Promise<ImportParseResult> {
  const grid = parseCsvGrid(text)
  if (grid.length === 0) return { headerError: 'empty-file', rows: [] }

  const mapping = mapHeaders(grid[0]!)
  if (!mapping) return { headerError: 'missing-columns', rows: [] }

  const rows: ParsedImportRow[] = []
  // Category names already claimed by a direction in this file: the same
  // name under both directions cannot map to one category (types differ).
  const categoryDirection = new Map<string, ImportDirection>()

  for (let index = 1; index < grid.length; index++) {
    const cells = grid[index]!
    const line = index + 1
    const cell = (key: ColumnKey) => {
      const columnIndex = mapping[key]
      return columnIndex === undefined ? '' : (cells[columnIndex] ?? '')
    }

    const direction = parseImportType(cell('type'))
    if (!direction) {
      rows.push({ status: 'invalid', line, code: 'bad-type' })
      continue
    }
    const day = parseImportDate(cell('date'))
    if (!day) {
      rows.push({ status: 'invalid', line, code: 'bad-date' })
      continue
    }
    const amountMinor = parseImportAmount(cell('amount'))
    if (amountMinor === null) {
      rows.push({ status: 'invalid', line, code: 'bad-amount' })
      continue
    }
    const categoryName = cell('category').trim()
    if (!categoryName) {
      rows.push({ status: 'invalid', line, code: 'empty-category' })
      continue
    }
    const account = parseImportAccount(cell('account'), context.accounts)
    if (!account.ok) {
      rows.push({ status: 'invalid', line, code: 'unknown-account' })
      continue
    }
    const categoryKey = categoryName.toLowerCase()
    const claimedDirection = categoryDirection.get(categoryKey)
    if (claimedDirection !== undefined && claimedDirection !== direction) {
      rows.push({ status: 'invalid', line, code: 'category-conflict' })
      continue
    }
    categoryDirection.set(categoryKey, direction)

    const note = cell('note').trim()
    rows.push({
      status: 'valid',
      line,
      direction,
      occurredAt: `${day}T12:00:00.000Z`,
      categoryName,
      amountMinor,
      note,
      accountId: account.accountId,
      accountName: account.accountName,
      id: await importRowId(
        `${day}|${direction}|${categoryKey}|${amountMinor}|${note.toLowerCase()}`,
      ),
    })
  }

  return { headerError: null, rows }
}
