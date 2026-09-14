#!/usr/bin/env node
// Parity gate between the sync entity catalog (manifest.json — the single
// source the generator renders the Go/TS catalogs from) and the OpenAPI
// contract (docs/api/openapi.yaml): the entity lists must be identical and
// every enum-typed sync field's value set must match the corresponding
// *SyncData schema property. Set semantics — order is not compared.
//
// Run via `pnpm sync-catalog:parity` (CI: ts-gen-check job).
//
// Non-goal: required-flag parity. manifest `required: true` is a generator
// concern (int fields that may not default to zero), while schema `required`
// is wire presence — e.g. PlannedPaymentSyncData deliberately has no required
// list although the catalog marks `amount` required.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

const manifest = JSON.parse(await fs.readFile(path.join(__dirname, 'manifest.json'), 'utf8'))
const spec = YAML.parse(await fs.readFile(path.join(repoRoot, 'docs/api/openapi.yaml'), 'utf8'))

const problems = []
const sameSet = (a, b) => a.length === b.length && a.every((value) => b.includes(value))

// 1. The SyncEntity enum is exactly the manifest entity list.
const manifestIds = manifest.entities.map((entity) => entity.id)
const specEntities = spec.components.schemas.SyncEntity?.enum
if (!specEntities || !sameSet(specEntities, manifestIds)) {
  problems.push(
    `SyncEntity enum [${specEntities ?? 'MISSING'}] != manifest entities [${manifestIds}]`,
  )
}

// 2. Every enum-typed sync field matches its schema property's enum. The
// catalog has two shapes: flat `fields` (most entities) and the transaction
// discriminated union (`discriminator` + `variants`), whose discriminator
// values map to the schema's `type` property enum.
let checkedEnums = 0
for (const entity of manifest.entities) {
  const schemaName = entity.syncData.type
  const schema = spec.components.schemas[schemaName]
  if (!schema) {
    problems.push(`${entity.id}: schema ${schemaName} not found in openapi components`)
    continue
  }
  const enumFields = []
  if (entity.syncData.discriminator) {
    const { field, values } = entity.syncData.discriminator
    enumFields.push({ name: field, values })
    for (const variant of entity.syncData.variants ?? []) {
      for (const field of variant.fields ?? []) {
        if (field.kind === 'enum') enumFields.push({ name: field.name, values: field.values })
      }
    }
  }
  for (const field of entity.syncData.fields ?? []) {
    if (field.kind === 'enum') enumFields.push({ name: field.name, values: field.values })
  }
  for (const { name, values } of enumFields) {
    checkedEnums += 1
    const property = schema.properties?.[name]
    // Properties reference the shared catalog enum via `$ref` (OAS 3.0
    // forbids siblings on `$ref`, so the enum lives only on the target).
    const target = property?.$ref ? spec.components.schemas[property.$ref.split('/').pop()] : property
    const specValues = target?.enum
    if (!specValues) {
      problems.push(`${entity.id}.${name}: no enum on ${schemaName}.${name}`)
    } else if (!sameSet(specValues, values)) {
      problems.push(
        `${entity.id}.${name}: catalog [${values}] != ${schemaName} [${specValues}]`,
      )
    }
  }
}

if (problems.length > 0) {
  console.error(`sync-catalog/openapi parity FAILED:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log(`sync-catalog/openapi parity ok: ${manifestIds.length} entities, ${checkedEnums} enum fields`)
