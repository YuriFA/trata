# ADR-0004: Sync entity catalog - repo-level source of truth for structural sync knowledge

- **Status:** Accepted (2026-09-04)
- **Scope:** sync implementation structure across backend, `packages/local-data`, and app adapters; no sync protocol behavior change, no OpenAPI contract change
- **Related:** `docs/adr/0003-sync-push-protocol-engine.md`; `docs/architecture/invariants.md` #1 (OpenAPI is the HTTP contract source); `CONTEXT.md` (`Sync entity`, `Sync entity catalog`)

## Context

The sync protocol already has deep modules in the right places: backend push behavior is centralized behind the adapter-driven engine from ADR-0003, and the client sync engine in `@trata/local-data` is transport-agnostic and well-tested. The remaining friction is not the protocol skeleton but the structural per-entity sync knowledge around it. Today that knowledge is scattered across handwritten string-switch sites and parallel registries: backend entity registration, local-data row/payload mapping, conflict subject handling, restore decoding, forward-compat known-entity sets, the web worker surface, and app-level conflict presentation. Adding, removing, or auditing one sync entity requires a repo-wide hunt rather than one local change.

This is a real architectural decision because the obvious alternatives differ materially: keep local registries per runtime, make backend or `packages/local-data` the de facto owner, or introduce a repo-level source of truth. We choose the last one because the knowledge is cross-stack, structural rather than product-behavioral, and surprising enough that a future reader would otherwise wonder why a new repo-level tool exists outside OpenAPI.

## Decision

Introduce a repo-level **sync entity catalog** in `tools/sync-catalog` as the single source of truth for **structural sync knowledge**. The catalog is a declarative manifest, hand-maintained by humans, from which typed artifacts are generated and committed for the consuming runtimes. The rollout was a behavior-preserving strangler migration, entity by entity (`debtor` pilot, then `account`, `category`, `debt_operation`, `planned_payment`, `transaction`); it is complete and there is no legacy handwritten structural path left.

The sync entity catalog owns only structural per-entity sync knowledge: canonical entity ids, semantic label metadata, structural field metadata needed for sync concerns, conflict-subject hints, restore-decode metadata, and forward-compat participation metadata. It does **not** own domain write rules, repository persistence behavior, sync flow orchestration, UI composition, or any decision logic that determines whether create/replace/delete is applied, conflicted, or rejected. Those remain handwritten runtime adapters and domain modules.

OpenAPI remains the single source of truth for the HTTP contract. The sync entity catalog must complement OpenAPI, not duplicate it. It may reference existing sync wire shapes and add metadata that OpenAPI does not express, but it must not become a second contract definition system. Likewise, it must not embed raw storage details such as concrete Postgres or SQLite table/column names; those stay in runtime adapters.

## Considered options

- **Keep separate runtime-local registries** - rejected. This preserves the current shallow shape and poor locality.
- **Make backend canonical** - rejected. The knowledge is not backend-only; client conflict and restore handling are first-class consumers.
- **Make `packages/local-data` canonical** - rejected. Same problem in reverse; backend becomes a mirror.
- **Extend OpenAPI to carry this knowledge** - rejected. The catalog concerns are structural sync metadata, not HTTP contract ownership.

## Consequences

- `tools/sync-catalog` is a deliberate repo-level module with generation and drift-gate discipline matching the existing codegen flows (`pnpm sync-catalog:gen` / `sync-catalog:gen-check`).
- All six sync entities are catalog-backed. A new sync entity must be added to the manifest; the consuming type seams (`sync-data.ts`, `restore.ts`, app label dispatch) fail to compile or generate without it.
- Discriminated entities (e.g. `transaction` cashflow/transfer/adjustment variants) are expressed in the manifest as discriminator + per-variant field lists, not as code switches.
- This decision did **not** require an OpenSpec change: the rollout was strictly behavior-preserving. If future work changes observable sync behavior, that behavior change belongs in OpenSpec separately.
