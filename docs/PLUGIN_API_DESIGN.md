# PLUGIN_API_DESIGN.md — Obscura Plugin System v0.7.0

**Status:** Implemented and dogfooded. Stable from this version — breaking
changes to `Transform`, `TransformContext`, or `PipelineResult` require a
major version bump per TECH_DECISIONS.md governance policy.

---

## Problem

Four transforms existed before this version (Rename, String, Constant,
DeadCode), each as a standalone function with its own signature:

```
applyRenameTransform(parsed, binder, options)   // needs BinderResult
applyStringTransform(parsed, options)            // doesn't
applyConstantTransform(parsed, options)          // doesn't
applyDeadCodeTransform(parsed, options)          // doesn't
```

This asymmetry — one transform needs `BinderResult`, three don't — is the
actual problem a plugin interface has to resolve, not a hypothetical one.

## Decisions

### 1. Every transform receives a `TransformContext`, not raw `ObscuraParseResult`

```typescript
interface TransformContext {
  readonly parsed: ObscuraParseResult;
  binder(): BinderResult; // lazy, cached
}
```

Resolves the asymmetry: RenameTransform calls `ctx.binder()`, the other
three never call it and pay zero Binder cost. The Binder is a pure O(n)
function of `parsed`, so caching is always safe within one transform's
execution — the cache is created fresh per pipeline step (see `runPipeline`),
never leaked across steps where `parsed` has changed.

**Alternative considered:** pass `BinderResult | undefined` as a third
positional argument, matching the existing `applyRenameTransform` shape
exactly. Rejected — this leaks an implementation detail (which transforms
happen to need binding) into the public signature every plugin author has to
think about, even when irrelevant to their transform.

### 2. Explicit `dependsOn`, not implicit phase ordering

```typescript
interface Transform {
  readonly name: string;
  readonly dependsOn: readonly string[];
  apply(ctx, options?): TransformOutput;
}
```

Per ARCHITECTURE.md Rule 5 (revised): *"Ordering constraints must be
explicit, documented, and deterministic."* `runPipeline` validates every
declared dependency is satisfied by execution order and throws loudly
(not silently reorders) if violated.

Before this version, no transform had a real ordering dependency — all four
are genuinely isolated. The example plugin (`NoOpWrapTransform`) is the
first real `dependsOn` use case: it wraps numbers ConstantTransform left
untouched, so running it before ConstantTransform is pointless (it would
wrap numbers ConstantTransform then can't see as plain literals anymore).

**Alternative considered:** a numeric `phase` or `priority` field with
implicit sorting. Rejected — implicit sorting makes pipeline behavior harder
to predict from reading the caller's code; explicit `dependsOn` plus a
loud failure on violation keeps execution order exactly what the caller
wrote, with validation rather than silent correction.

### 3. Open `stats` record, not an enumerated result type

```typescript
interface TransformOutput<Stats extends Record<string, unknown> = Record<string, unknown>> {
  result: ObscuraParseResult;
  stats: Stats;
}
```

Each transform reports whatever counters matter to it (`renamedCount`,
`encodedNumbers`, `insertedBlocks`, ...) without the interface needing to
enumerate every possible stat across every current and future transform.
Generic `Stats` parameter lets a transform's own type still be precise
(see `NoOpWrapStats` in the example plugin) while `runPipeline`'s aggregate
`PipelineStepResult.stats` stays a simple `Record<string, unknown>`.

### 4. Pipeline order is caller-provided array order, period

No automatic topological sort beyond dependency *validation*. If a caller
writes `[A, B, C]`, that's the execution order — `dependsOn` only checks
it, never rewrites it. This trades a small amount of convenience (a smarter
runner could auto-sort to satisfy dependencies) for predictability: reading
the pipeline array tells you the actual execution order, full stop.

---

## Dogfooding

Per ROADMAP.md v0.7.0 requirement — at least one non-trivial example plugin
built against the real API before calling it done:

- **Internal dogfooding:** all four existing transforms (`RenameTransform`,
  `StringTransform`, `ConstantTransform`, `DeadCodeTransform`) wrapped as
  conforming `Transform` implementations in `builtin-transforms.ts`. Thin
  adapters over the unchanged underlying functions — existing direct callers
  of `applyRenameTransform` etc. are unaffected.
- **External-style dogfooding:** `plugins/noop-wrap-transform.ts` —
  imports *only* from the public `src/index.ts` barrel (never reaches into
  internal modules), implements `Transform` directly rather than wrapping
  an internal function, and exercises a real `dependsOn` constraint.
  Type-checked in isolation (outside the `src/**/*` tsconfig scope) to
  confirm it compiles the way an actual third-party consumer's code would.

## Test coverage

17 tests in `plugin-api.test.ts`: pipeline execution and state threading,
`dependsOn` satisfied/violated/missing (including error message content),
binder caching (reference-equality proof), builtin adapter output matches
direct function calls exactly, full 5-step pipeline behavioral equivalence,
and the complete 9-fixture corpus run through `runPipeline` with all four
builtin transforms chained.

## What's deliberately NOT in v0.7.0

- No plugin discovery/loading mechanism (npm package convention, config
  file schema). The interface is proven; packaging/distribution is a
  separate, later concern.
- No async transform support. All current and example transforms are
  synchronous; adding `Promise<TransformOutput>` support is an additive
  change deferrable until a real use case needs it.
- No transform versioning/compatibility declarations. Premature without
  a second real external consumer to learn from.
