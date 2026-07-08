/**
 * Obscura Plugin API — v0.7.0
 *
 * FROZEN as of v0.9.0 (audit pass, 2026-07): `Transform`, `TransformContext`,
 * `PipelineResult`, and `runPipeline()`'s signature are the locked v1 surface.
 * Reviewed line-by-line for this freeze — dependency validation, lazy/cached
 * binder access, and per-step error isolation all confirmed correct. No
 * changes needed. Any further change to these four requires a major version
 * bump per TECH_DECISIONS.md governance policy; see CONTRIBUTING.md's
 * "Locked / Frozen Surfaces" table.
 *
 * Public, stable interface for transforms. This is the contract third-party
 * plugins implement against. Internal transforms (Rename, String, Constant,
 * DeadCode) are migrated to this interface as the reference implementation
 * and dogfooding proof — see plugins/ directory for the example.
 *
 * STABILITY: Once published, breaking changes to `Transform`, `TransformContext`,
 * or `PipelineResult` require a major version bump per TECH_DECISIONS.md
 * governance policy. This file is the API surface — keep it minimal.
 *
 * Design decisions (see PLUGIN_API_DESIGN.md for full rationale):
 *   1. Every transform receives a TransformContext, not raw ObscuraParseResult.
 *      This resolves the asymmetry where RenameTransform needs BinderResult
 *      and the other three don't — context.binder() is lazy and cached,
 *      so transforms that never call it pay zero Binder cost.
 *   2. Transforms declare `name` and `dependsOn` explicitly (Rule 5, revised:
 *      "Ordering constraints must be explicit, documented, and deterministic").
 *      Today no shipped transform has a real dependency, but the field exists
 *      from v0.7.0 onward so a future transform can declare one without an
 *      interface change.
 *   3. Transform output shape is uniform: { result, stats }. `stats` is an
 *      open record (Record<string, unknown>) so each transform can report
 *      whatever counters are meaningful to it (renamedCount, encodedCount,
 *      insertedBlocks, ...) without the interface needing to enumerate them.
 *   4. Pipeline execution order is the array order the caller provides,
 *      topologically adjusted only by `dependsOn` — no implicit reordering
 *      beyond satisfying declared dependencies. This keeps execution
 *      predictable and debuggable.
 */

import type { ObscuraParseResult } from './ast.js';
import { bind, type BinderResult } from './binder.js';

// ---------------------------------------------------------------------------
// TransformContext
// ---------------------------------------------------------------------------

export interface TransformContext {
  /** The current parse result. Transforms read from this, never mutate it. */
  readonly parsed: ObscuraParseResult;

  /**
   * Lazily computes (and caches) the BinderResult for `parsed`.
   * Calling this multiple times within the same pipeline run returns the
   * same cached result — the Binder is a pure O(n) function of `parsed`,
   * so caching is always safe as long as `parsed` hasn't changed since
   * the cache was populated (the pipeline runner invalidates the cache
   * automatically between transform steps — see runPipeline below).
   */
  binder(): BinderResult;
}

function makeContext(parsed: ObscuraParseResult): TransformContext {
  let cached: BinderResult | null = null;
  return {
    parsed,
    binder(): BinderResult {
      if (cached === null) cached = bind(parsed);
      return cached;
    },
  };
}

// ---------------------------------------------------------------------------
// Transform interface — the public plugin contract
// ---------------------------------------------------------------------------

export interface TransformOutput<Stats extends Record<string, unknown> = Record<string, unknown>> {
  result: ObscuraParseResult;
  stats: Stats;
}

export interface Transform<
  Options = unknown,
  Stats extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique, stable identifier. Used for dependsOn references and diagnostics. */
  readonly name: string;

  /** Human-readable description — shown in CLI --help / docs generation. */
  readonly description: string;

  /**
   * Names of other transforms (by `name`) that must run before this one,
   * if both are present in the same pipeline. Empty array (the common case)
   * means no ordering constraint — this transform is isolated per Rule 5.
   */
  readonly dependsOn: readonly string[];

  /**
   * Run the transform. Must be side-effect free with respect to `ctx.parsed` —
   * return a new ObscuraParseResult, never mutate the input.
   */
  apply(ctx: TransformContext, options?: Options): TransformOutput<Stats>;
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export interface PipelineStep {
  // `any, any` is deliberate here: PipelineStep must hold transforms with
  // different Options/Stats type params in one heterogeneous list (existential
  // type), not an accidental type-safety gap. Each transform's own apply()
  // stays fully typed; only this collection point erases it.
  transform: Transform<any, any>;
  options?: unknown;
}

export interface PipelineStepResult {
  name: string;
  stats: Record<string, unknown>;
}

export interface PipelineResult {
  result: ObscuraParseResult;
  steps: PipelineStepResult[];
}

/**
 * Runs a sequence of transforms in order, threading the ObscuraParseResult
 * through each step. Validates declared dependencies are satisfied by
 * the order given — throws if a transform's dependsOn references a
 * transform not present earlier in the pipeline (fail loud, per
 * ARCHITECTURE.md fail-loud principle, rather than silently reordering).
 */
export function runPipeline(parsed: ObscuraParseResult, steps: PipelineStep[]): PipelineResult {
  const seenNames = new Set<string>();
  for (const step of steps) {
    for (const dep of step.transform.dependsOn) {
      if (!seenNames.has(dep)) {
        throw new Error(
          `Transform '${step.transform.name}' declares dependsOn '${dep}', ` +
            `but '${dep}' did not run earlier in the pipeline. ` +
            `Pipeline order: [${steps.map(s => s.transform.name).join(', ')}]`,
        );
      }
    }
    seenNames.add(step.transform.name);
  }

  let current = parsed;
  const stepResults: PipelineStepResult[] = [];

  for (const step of steps) {
    const ctx = makeContext(current); // fresh context per step — binder cache
    // does not leak stale data across steps
    const output = step.transform.apply(ctx, step.options);
    current = output.result;
    // output.stats is `any` here because PipelineStep.transform is deliberately
    // Transform<any, any> (an existential type — see this file's header comment).
    // Each transform's own apply() is still fully typed; only the heterogeneous
    // pipeline collection erases it.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    stepResults.push({ name: step.transform.name, stats: output.stats });
  }

  return { result: current, steps: stepResults };
}
