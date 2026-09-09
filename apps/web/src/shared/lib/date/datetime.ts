import { isIsoDateTime } from '@trata/api'
import type { BrandedIsoDateTime, IsoDateTime } from './types'

const asIsoDateTime = (value: string): BrandedIsoDateTime => value as BrandedIsoDateTime

const toNativeDate = (value: Date | IsoDateTime) => {
  return value instanceof Date ? value : new Date(value)
}

// The pure `isIsoDateTime` predicate is owned by the shared package (it backs
// the domain model's datetime normalization); re-exported for web consumers.
export { isIsoDateTime }

export const nowIsoString = (): IsoDateTime => asIsoDateTime(new Date().toISOString())

export const parseIsoDateTime = (value: string) => {
  if (!isIsoDateTime(value)) {
    throw new Error(`Invalid ISO datetime: ${value}`)
  }

  return toNativeDate(value)
}

export const getDateTimestamp = (value: Date | IsoDateTime) => toNativeDate(value).getTime()
