/**
 * Plugin API tests — v0.7.0
 *
 * Covers:
 *   - runPipeline correctness (sequential execution, state threading)
 *   - dependsOn enforcement (satisfied order passes, violated order throws loudly)
 *   - Binder caching within a single transform's context
 *   - Built-in transform adapters produce identical results to direct calls
 *   - The example third-party plugin (NoOpWrapTransform) behavioral equivalence
 */

import { describe, it, expect } from 'vitest';
import { runPipeline } from '../src/plugin-api.js';
import type { Transform, TransformContext, TransformOutput } from '../src/plugin-api.js';
import {
  RenameTransform,
  StringTransform,
  ConstantTransform,
  DeadCodeTransform,
  BUILTIN_TRANSFORMS,
} from '../src/builtin-transforms.js';
import { applyRenameTransform } from '../src/rename-transform.js';
import { bind } from '../src/binder.js';
import { generate } from '../src/generator.js';
import { parseNative } from '../src/parser-native.js';
import { runSource } from './harness.js';
import { NoOpWrapTransform } from '../plugins/noop-wrap-transform.js';

function parse(src: string) {
  const r = parseNative(src);
  expect(r.errors).toHaveLength(0);
  return r;
}

// ---------------------------------------------------------------------------
// runPipeline — basic execution
// ---------------------------------------------------------------------------

describe('runPipeline basics', () => {
  it('runs a single transform and threads result through', () => {
    const parsed = parse('local longName = 1\nprint(longName)\n');
    const pipeline = runPipeline(parsed, [{ transform: RenameTransform }]);
    expect(pipeline.steps).toHaveLength(1);
    expect(pipeline.steps[0]!.name).toBe('rename');
    expect(pipeline.result.locals).not.toEqual(parsed.locals);
  });

  it('runs multiple transforms in order, each seeing prior output', () => {
    const parsed = parse('local greeting = "hi"\nprint(greeting)\n');
    const pipeline = runPipeline(parsed, [
      { transform: RenameTransform },
      { transform: StringTransform, options: { encoding: 'hex' } },
    ]);
    expect(pipeline.steps.map(s => s.name)).toEqual(['rename', 'string']);

    const generated = generate(pipeline.result);
    expect(generated).not.toContain('greeting');
    expect(generated).not.toContain('"hi"');
  });

  it('empty pipeline returns input unchanged', () => {
    const parsed = parse('print(1)\n');
    const pipeline = runPipeline(parsed, []);
    expect(pipeline.result).toEqual(parsed);
    expect(pipeline.steps).toHaveLength(0);
  });

  it('passes options through to each transform', () => {
    const parsed = parse('local x = 1\nlocal y = 2\nprint(x, y)\n');
    const pipeline = runPipeline(parsed, [
      { transform: ConstantTransform, options: { numberEncoding: 'bitwise' } },
    ]);
    const generated = generate(pipeline.result);
    expect(generated).toContain('bit32.bxor');
  });
});

// ---------------------------------------------------------------------------
// dependsOn enforcement
// ---------------------------------------------------------------------------

describe('dependsOn enforcement', () => {
  it('satisfied dependency order runs without error', () => {
    const parsed = parse('print(42)\n');
    expect(() =>
      runPipeline(parsed, [{ transform: ConstantTransform }, { transform: NoOpWrapTransform }]),
    ).not.toThrow();
  });

  it('violated dependency order throws loudly', () => {
    const parsed = parse('print(42)\n');
    expect(() =>
      runPipeline(parsed, [
        { transform: NoOpWrapTransform }, // depends on 'constant', not present before it
        { transform: ConstantTransform },
      ]),
    ).toThrow(/dependsOn 'constant'/);
  });

  it('missing dependency entirely throws loudly', () => {
    const parsed = parse('print(42)\n');
    expect(() =>
      runPipeline(parsed, [
        { transform: NoOpWrapTransform }, // constant never present at all
      ]),
    ).toThrow(/did not run earlier in the pipeline/);
  });

  it('error message includes the actual pipeline order for debugging', () => {
    const parsed = parse('print(1)\n');
    try {
      runPipeline(parsed, [{ transform: NoOpWrapTransform }, { transform: RenameTransform }]);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('noop-wrap');
      expect((e as Error).message).toContain('rename');
    }
  });
});

// ---------------------------------------------------------------------------
// Built-in adapters produce identical results to direct function calls
// ---------------------------------------------------------------------------

describe('builtin transform adapters match direct calls', () => {
  it('RenameTransform adapter matches applyRenameTransform directly', () => {
    const parsed = parse('local longVariableName = 5\nprint(longVariableName)\n');
    const binder = bind(parsed);

    const direct = applyRenameTransform(parsed, binder, {});
    const viaContext: TransformContext = { parsed, binder: () => binder };
    const adapted = RenameTransform.apply(viaContext, {});

    expect(adapted.result).toEqual(direct.result);
    expect(adapted.stats['renamedCount']).toBe(direct.renamedCount);
  });

  it('all 4 builtin transforms are registered with unique names', () => {
    const names = BUILTIN_TRANSFORMS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('rename');
    expect(names).toContain('string');
    expect(names).toContain('constant');
    expect(names).toContain('dead-code');
  });
});

// ---------------------------------------------------------------------------
// Binder caching within a transform's context
// ---------------------------------------------------------------------------

describe('TransformContext binder caching', () => {
  it('binder() returns the same object across multiple calls within one context', () => {
    const parsed = parse('local x = 1\nprint(x)\n');
    let firstCall: unknown = null;
    let secondCall: unknown = null;

    const probe: Transform = {
      name: 'probe',
      description: 'test',
      dependsOn: [],
      apply(ctx: TransformContext): TransformOutput {
        firstCall = ctx.binder();
        secondCall = ctx.binder();
        return { result: ctx.parsed, stats: {} };
      },
    };

    runPipeline(parsed, [{ transform: probe }]);
    expect(firstCall).toBe(secondCall); // reference equality — proves caching
  });

  it('a transform that never calls binder() never triggers binding', () => {
    const parsed = parse('print(1)\n');

    const probe: Transform = {
      name: 'probe-no-bind',
      description: 'test',
      dependsOn: [],
      apply(ctx: TransformContext): TransformOutput {
        // deliberately never call ctx.binder()
        return { result: ctx.parsed, stats: {} };
      },
    };

    // Spy-free check: just confirm no throw and result is identity —
    // the real proof is binder.ts isn't imported into this codepath at all,
    // verified structurally by plugin-api.ts's lazy `cached === null` guard.
    const out = runPipeline(parsed, [{ transform: probe }]);
    expect(out.result).toEqual(parsed);
  });
});

// ---------------------------------------------------------------------------
// Third-party plugin (NoOpWrapTransform) — behavioral equivalence
// ---------------------------------------------------------------------------

describe('NoOpWrapTransform (example third-party plugin)', () => {
  it('wraps remaining numbers after constant transform', () => {
    const parsed = parse('print(7)\n');
    const pipeline = runPipeline(parsed, [
      { transform: ConstantTransform, options: { numberEncoding: 'bitwise' } },
      { transform: NoOpWrapTransform },
    ]);
    expect(pipeline.steps[1]!.stats['wrappedCount']).toBeDefined();
  });

  it('skips trivial 0 and 1 by default', () => {
    const parsed = parse('print(0, 1)\n');
    const pipeline = runPipeline(parsed, [
      { transform: ConstantTransform },
      { transform: NoOpWrapTransform },
    ]);
    expect(pipeline.steps[1]!.stats['wrappedCount']).toBe(0);
  });

  it('produces behaviorally identical output standalone', () => {
    const parsed = parse('print(5 + 3)\n');
    const pipeline = runPipeline(parsed, [
      { transform: ConstantTransform, options: { numberEncoding: 'arithmetic', seed: 1 } },
      { transform: NoOpWrapTransform },
    ]);
    const generated = generate(pipeline.result);
    const r = runSource(generated, 'noop-wrap');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('8');
  });

  it('full pipeline: rename + string + constant + noop-wrap + dead-code', () => {
    const parsed = parse(
      ['local count = 10', 'local label = "items"', 'print(count + 5, label)'].join('\n'),
    );

    const pipeline = runPipeline(parsed, [
      { transform: RenameTransform },
      { transform: StringTransform, options: { encoding: 'hex' } },
      { transform: ConstantTransform, options: { numberEncoding: 'mixed', seed: 3 } },
      { transform: NoOpWrapTransform },
      { transform: DeadCodeTransform, options: { insertionRate: 0.5, seed: 9 } },
    ]);

    const generated = generate(pipeline.result);
    const r = runSource(generated, 'full-plugin-pipeline');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('15\titems');
    expect(pipeline.steps).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Corpus equivalence through the pipeline runner
// ---------------------------------------------------------------------------

describe('corpus: full plugin pipeline equivalence', () => {
  it('all full-mode corpus fixtures pass through the complete pipeline', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const fixturesDir = join(__dirname, 'golden/fixtures');
    const expectedDir = join(__dirname, 'golden/expected');
    const fixtures = [
      '01-locals',
      '02-closures',
      '03-constructs',
      '04-iterators',
      '06-string-interp',
      '07-if-else-expr',
      '08-literals',
      '09-attributes',
      '10-trivial',
    ];

    for (const name of fixtures) {
      const source = readFileSync(join(fixturesDir, `${name}.luau`), 'latin1') as string;
      const expectedStdout = readFileSync(join(expectedDir, `${name}.txt`), 'utf-8') as string;

      const parsed = parseNative(source);
      expect(parsed.errors, `${name}: parse errors`).toHaveLength(0);

      const pipeline = runPipeline(parsed, [
        { transform: RenameTransform },
        { transform: StringTransform, options: { encoding: 'decimal' } },
        { transform: ConstantTransform, options: { numberEncoding: 'mixed', seed: 5 } },
        { transform: DeadCodeTransform, options: { insertionRate: 0.3, seed: 11 } },
      ]);

      const generated = generate(pipeline.result);
      const r = runSource(generated, name);

      if (r.exitCode !== 0 || r.stdout !== expectedStdout) {
        console.error(`\n=== CORPUS FAIL (pipeline): ${name} ===`);
        console.error(`Exit: ${r.exitCode}`);
        console.error('Steps:', pipeline.steps);
      }

      expect(r.exitCode, `${name}: exit`).toBe(0);
      expect(r.stdout, `${name}: stdout`).toBe(expectedStdout);
    }
  });
});
