/**
 * Built-in transforms — Plugin API adapters
 *
 * Wraps the four existing transform functions (rename, string, constant,
 * dead-code) as conforming `Transform` implementations. This is the
 * dogfooding requirement from ROADMAP.md v0.7.0: the plugin API is proven
 * against real, already-shipped transforms before any third party uses it.
 *
 * The underlying transform functions (applyRenameTransform, etc.) are
 * unchanged — these are thin adapters, not reimplementations. Existing
 * direct callers of applyRenameTransform/etc. continue to work exactly
 * as before; this file adds the Transform-conforming wrapper alongside.
 */

import type { Transform, TransformContext, TransformOutput } from './plugin-api.js';
import { applyRenameTransform, type RenameTransformOptions } from './rename-transform.js';
import { applyStringTransform, type StringTransformOptions } from './string-transform.js';
import { applyConstantTransform, type ConstantTransformOptions } from './constant-transform.js';
import { applyDeadCodeTransform, type DeadCodeTransformOptions } from './dead-code-transform.js';

// ---------------------------------------------------------------------------
// RenameTransform — the one transform that genuinely needs BinderResult
// ---------------------------------------------------------------------------

export const RenameTransform: Transform<RenameTransformOptions> = {
  name: 'rename',
  description: 'Renames safe local variables to short, deterministic identifiers.',
  dependsOn: [],
  apply(ctx: TransformContext, options?: RenameTransformOptions): TransformOutput {
    const out = applyRenameTransform(ctx.parsed, ctx.binder(), options);
    return {
      result: out.result,
      stats: { renamedCount: out.renamedCount, skippedCount: out.skippedCount },
    };
  },
};

// ---------------------------------------------------------------------------
// StringTransform
// ---------------------------------------------------------------------------

export const StringTransform: Transform<StringTransformOptions> = {
  name: 'string',
  description: 'Encodes string literals using decimal, hex, or split concatenation.',
  dependsOn: [],
  apply(ctx: TransformContext, options?: StringTransformOptions): TransformOutput {
    const out = applyStringTransform(ctx.parsed, options);
    return {
      result: out.result,
      stats: { encodedCount: out.encodedCount, skippedCount: out.skippedCount },
    };
  },
};

// ---------------------------------------------------------------------------
// ConstantTransform
// ---------------------------------------------------------------------------

export const ConstantTransform: Transform<ConstantTransformOptions> = {
  name: 'constant',
  description: 'Obfuscates numeric and boolean constants via equivalent expressions.',
  dependsOn: [],
  apply(ctx: TransformContext, options?: ConstantTransformOptions): TransformOutput {
    const out = applyConstantTransform(ctx.parsed, options);
    return {
      result: out.result,
      stats: {
        encodedNumbers: out.encodedNumbers,
        encodedBooleans: out.encodedBooleans,
        skippedCount: out.skippedCount,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// DeadCodeTransform
// ---------------------------------------------------------------------------

export const DeadCodeTransform: Transform<DeadCodeTransformOptions> = {
  name: 'dead-code',
  description: 'Inserts statically-unreachable code blocks for obfuscation noise.',
  dependsOn: [],
  apply(ctx: TransformContext, options?: DeadCodeTransformOptions): TransformOutput {
    const out = applyDeadCodeTransform(ctx.parsed, options);
    return {
      result: out.result,
      stats: { insertedBlocks: out.insertedBlocks },
    };
  },
};

// ---------------------------------------------------------------------------
// Registry — convenience lookup, used by CLI (future) and tests.
// `any` here is deliberate: this is a heterogeneous collection of transforms
// with different Options/Stats type params (an existential type), not an
// accidental type-safety gap. Each transform's own apply() stays fully typed.
export const BUILTIN_TRANSFORMS: ReadonlyArray<Transform<any>> = [
  RenameTransform,
  StringTransform,
  ConstantTransform,
  DeadCodeTransform,
];
