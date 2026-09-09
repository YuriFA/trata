import type { CalendarDay, IsoDateTime } from '@trata/api'

// The unbranded `CalendarDay` / `IsoDateTime` primitives live in the shared
// `@trata/api` package (used by the domain model + repository
// contracts). Re-exported here so the web date lib's historical import paths
// keep resolving.
export type { CalendarDay, IsoDateTime }

type Brand<TValue, TName extends string> = TValue & { readonly __brand: TName }

export type BrandedCalendarDay = Brand<string, 'CalendarDay'>

export type BrandedIsoDateTime = Brand<string, 'IsoDateTime'>
