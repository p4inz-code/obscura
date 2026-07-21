# VERSION_MAP.md — Obscura

| Version | Milestone | Description |
|---|---|---|
| v0.0.1 | Milestone 0 | Project scaffold — monorepo, tsconfig, vitest, turbo |
| v0.0.2 | Milestone 0 | AST contract finalized — `ast.ts`, schema v1, `declarationKind` |
| v0.0.3 | Milestone 0 | Generator complete — 39 unit tests passing |
| v0.0.4 | Milestone 0 | Corpus framework — 9 full-mode fixtures, test harness, equivalence + snapshot tests |
| v0.0.5 | Milestone 0 | WASM integration — `ObscuraSerializer.cpp` built, `parse()` wired |
| v0.1.0 | Milestone 0 complete | Walking Skeleton — full corpus CI green, schema frozen |
| v0.2.0 | Milestone 1 | Binder — scope resolution, symbol table, rename-safety classification |
| v0.3.0 | Milestone 2 | Safe Rename Transform — variables, functions, parameters |
| v0.4.0 | Milestone 3 | String Transform |
| v0.5.0 | Milestone 4 | Constant Transform |
| v0.6.0 | Milestone 5 | Dead Code Transform |
| v0.7.0 | Milestone 6 | Plugin System |
| v0.8.0 | Milestone 7 | CLI |
| v0.9.0 | Milestone 8 | Release Candidate — audit pass, WASM parser (0.1b) complete, plugin API frozen, CI/lint/docs |
| v1.0.0 | Stable release | Production-ready Obscura — 340/340 tests, all fixtures restored, pending push + CI confirmation |

## Schema Version History

| Schema version | Released in | Breaking changes |
|---|---|---|
| 1 | v0.0.2 | Initial schema |

## Pinned Dependencies

| Dependency | Version | Pinned in |
|---|---|---|
| luau-lang/luau | tag `0.701` | `ARCHITECTURE.md`, `ObscuraSerializer.cpp` |
| Node.js | ≥18 | `package.json` |
| TypeScript | ^5.4 | `packages/core/package.json` |
| Vitest | ^1.6 | `packages/core/package.json` |
