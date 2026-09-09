# Trata

A local-first family budget tracker with household sharing and a cross-device sync protocol. This glossary names project-specific concepts so architectural seams can use stable language.

## Language

**Sync entity**:
A record type that participates in the sync protocol and can travel through push, pull, conflict handling, and restore flows.
_Avoid_: synced table, sync model

**Sync entity catalog**:
The catalog of structural per-entity sync knowledge: the canonical list of sync entities plus the metadata needed to encode, decode, label, and handle them consistently across the sync protocol.
_Avoid_: sync registry, random string switches
