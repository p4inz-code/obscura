/**
 * Integration tests — full parse → generate → runtime equivalence.
 * Uses the native ObscuraSerializer binary (same C++ as WASM build).
 * These are the Milestone 0 completion tests. All must pass for v0.1.0.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseNative } from '../src/parser-native.js';
import { generate } from '../src/generator.js';
import { LUAU_BIN, fullFixtures, allFixtures, checkEquivalence, runSource } from './harness.js';

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

describe('milestone-0 pre-flight', () => {
  it('Luau binary available', () => {
    expect(existsSync(LUAU_BIN)).toBe(true);
  });

  it('native serializer binary available', () => {
    const bin =
      process.env['OBSCURA_NATIVE_BIN'] ??
      new URL('../../../luau/build/obscura_native', import.meta.url).pathname;
    expect(existsSync(bin), `Missing: ${bin}`).toBe(true);
  });

  it('parse returns valid schemaVersion:1 result', () => {
    const r = parseNative('local x = 1\nreturn x\n');
    expect(r.schemaVersion).toBe(1);
    expect(r.errors).toHaveLength(0);
    expect(r.root.type).toBe('AstStatBlock');
    expect(r.locals[0]?.name).toBe('x');
    expect(r.locals[0]?.declarationKind).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// Parse correctness — all 11 corpus fixtures
// ---------------------------------------------------------------------------

describe('parse — all corpus fixtures', () => {
  const fixtures = allFixtures();

  for (const fixture of fixtures) {
    it(`${fixture.id}: parses without errors`, () => {
      const result = parseNative(fixture.source);
      expect(
        result.errors,
        `Parse errors in ${fixture.id}: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0);
      expect(result.schemaVersion).toBe(1);
      expect(result.root.type).toBe('AstStatBlock');
    });
  }
});

// ---------------------------------------------------------------------------
// AST snapshot — structural stability
// ---------------------------------------------------------------------------

describe('AST snapshots — structural stability', () => {
  const LARGE = new Set(['11-large-basic', '05-coroutines', '02-closures']);
  const fixtures = allFixtures();

  for (const fixture of fixtures) {
    it(`${fixture.id}: AST shape is stable`, () => {
      const result = parseNative(fixture.source);
      expect(result.errors).toHaveLength(0);

      if (LARGE.has(fixture.id)) {
        // Large fixtures: snapshot locals count + root body node types only
        expect({
          localCount: Object.keys(result.locals).length,
          rootBodyTypes: result.root.body.map(s => s.type),
        }).toMatchSnapshot();
      } else {
        // Small fixtures: full locals table + root (locations included)
        expect({
          locals: result.locals,
          root: result.root,
        }).toMatchSnapshot();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// declarationKind correctness spot-checks
// ---------------------------------------------------------------------------

describe('declarationKind — all 6 kinds verified', () => {
  it('local, function, param, self, for_num, for_in all assigned correctly', () => {
    const src = [
      'local x = 1', // local
      'local function foo(a, b) return a end', // function + param
      'local t = {}',
      'function t:method(c) return c end', // self + param
      'for i = 1, 10 do end', // for_num
      'for k, v in pairs({}) do end', // for_in
    ].join('\n');

    const result = parseNative(src);
    expect(result.errors).toHaveLength(0);

    const byKind: Record<string, string[]> = {};
    for (const local of Object.values(result.locals)) {
      const k = local.declarationKind;
      if (!byKind[k]) byKind[k] = [];
      byKind[k].push(local.name);
    }

    expect(byKind['local']).toContain('x');
    expect(byKind['function']).toContain('foo');
    expect(byKind['param']).toContain('a');
    expect(byKind['param']).toContain('b');
    expect(byKind['self']).toContain('self');
    expect(byKind['for_num']).toContain('i');
    expect(byKind['for_in']).toContain('k');
    expect(byKind['for_in']).toContain('v');
  });
});

// ---------------------------------------------------------------------------
// Roundtrip equivalence — Walking Skeleton core
// ---------------------------------------------------------------------------

describe('roundtrip — parse → generate → runtime', () => {
  const fixtures = fullFixtures();

  for (const fixture of fixtures) {
    it(`${fixture.id}: output is behaviorally equivalent`, () => {
      const result = parseNative(fixture.source);

      expect(result.errors, `Parse errors prevent generation in ${fixture.id}`).toHaveLength(0);

      const generated = generate(result);
      const equiv = checkEquivalence(fixture, generated);

      if (!equiv.pass) {
        console.error(`\n=== FAILURE: ${fixture.id} ===`);
        console.error(`Generated exit: ${equiv.generatedExit}`);
        console.error(`Diff:\n${equiv.diff}`);
        console.error(`Generated source (first 800 chars):\n${generated.slice(0, 800)}`);
      }

      expect(
        equiv.pass,
        `Behavioral equivalence failed for ${fixture.id}\n${equiv.diff ?? ''}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Regression fixtures
// ---------------------------------------------------------------------------

describe('regression — known bug prevention', () => {
  it('reg-upvalue: upvalue x accessible inside inner closure', () => {
    const src = [
      'local x = 10',
      'local function outer()',
      '  local function inner()',
      '    return x',
      '  end',
      '  return inner() + x',
      'end',
      'assert(outer() == 20)',
      'print("upvalue-regression: ok")',
    ].join('\n');

    const result = parseNative(src);
    expect(result.errors).toHaveLength(0);

    const generated = generate(result);

    const xLocal = Object.values(result.locals).find(l => l.name === 'x');
    expect(xLocal).toBeDefined();
    expect(xLocal?.declarationKind).toBe('local');

    const runResult = runSource(generated, 'reg-upvalue');
    expect(runResult.exitCode).toBe(0);
    expect(runResult.stdout.trim()).toBe('upvalue-regression: ok');
  });
});
