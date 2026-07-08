/**
 * Behavioral equivalence tests — Milestone 0 Walking Skeleton validation.
 *
 * Current state: parse() is stubbed (WASM not yet built).
 * These tests verify:
 *   1. The harness itself works correctly (fixture loading, runtime execution)
 *   2. Expected stdout files match what the pinned Luau binary produces NOW
 *   3. Full roundtrip will pass once parse() is implemented
 *
 * When WASM is available: remove the `skipRoundtrip` guard and the tests go live.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import {
  LUAU_BIN,
  FIXTURES_DIR,
  EXPECTED_DIR,
  fullFixtures,
  loadManifest,
  runFile,
  runSource,
  checkEquivalence,
} from './harness.js';
import { generate } from '../src/generator.js';
import type { ObscuraParseResult } from '../src/ast.js';

// ---------------------------------------------------------------------------
// Environment check
// ---------------------------------------------------------------------------

describe('environment', () => {
  it('Luau binary exists and is executable', () => {
    expect(existsSync(LUAU_BIN), `LUAU_BIN not found: ${LUAU_BIN}`).toBe(true);
    const result = runSource('print("ok")', 'env-check');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  it('all fixture files exist', () => {
    const manifest = loadManifest();
    for (const entry of manifest) {
      const path = `${FIXTURES_DIR}/${entry.id}.luau`;
      expect(existsSync(path), `Missing fixture: ${path}`).toBe(true);
    }
  });

  it('all full-mode expected stdout files exist', () => {
    const manifest = loadManifest();
    for (const entry of manifest.filter(e => e.mode === 'full')) {
      const path = `${EXPECTED_DIR}/${entry.id}.txt`;
      expect(existsSync(path), `Missing expected: ${path}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Corpus fixture validation — verifies expected outputs are still current
// ---------------------------------------------------------------------------

describe('corpus fixtures — expected output freshness', () => {
  const fixtures = fullFixtures();

  for (const fixture of fixtures) {
    it(`${fixture.id}: Luau binary produces expected stdout`, () => {
      const result = runFile(`${FIXTURES_DIR}/${fixture.id}.luau`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(fixture.expectedStdout);
    });
  }
});

// ---------------------------------------------------------------------------
// Parse-only fixtures — verify they parse without crashing the runtime
// (Luau binary can parse + run; we just verify exit=0 or expected error)
// ---------------------------------------------------------------------------

describe('corpus fixtures — parse-only mode', () => {
  const parseOnly = loadManifest().filter(e => e.mode === 'parse-only');

  for (const entry of parseOnly) {
    it(`${entry.id}: Luau binary accepts file (parse-only)`, () => {
      // Parse-only: we just verify the file is valid Luau syntax
      // by running it through luau --compile (syntax check without execution)
      // Standalone luau runs it; runtime errors are acceptable, parse errors are not
      const result = runFile(`${FIXTURES_DIR}/${entry.id}.luau`);
      // We don't assert on exit code — just that it's a runtime error not a parse error
      const isParseError =
        result.stdout.includes('Expected') ||
        result.stdout.includes('Incomplete statement') ||
        result.stdout.includes('unknown symbol');
      expect(isParseError, `Parse error in ${entry.id}: ${result.stdout}`).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Roundtrip equivalence — ACTIVE once WASM parse() is implemented
// Currently: demonstrates the test structure with a hand-crafted parse result
// ---------------------------------------------------------------------------

const WASM_AVAILABLE = false; // Set to true when 0.1b WASM build is complete

describe('roundtrip equivalence — Walking Skeleton', () => {
  if (!WASM_AVAILABLE) {
    it('SKIPPED: WASM parse() not yet implemented (Milestone 0 task 0.1b)', () => {
      // This test block is a no-op until WASM is built.
      // When ready: set WASM_AVAILABLE = true and import parse() from '../src/index.js'
      expect(true).toBe(true);
    });
    return;
  }

  // This block activates when WASM_AVAILABLE = true
  const fixtures = fullFixtures();

  for (const fixture of fixtures) {
    it(`${fixture.id}: parse → generate → runtime equivalent`, async () => {
      // Dynamic import to avoid failing at module load time when stub is in place
      const { parse } = await import('../src/index.js');
      const result: ObscuraParseResult = parse(fixture.source);

      // Hard stop on parse errors
      expect(
        result.errors,
        `Parse errors in ${fixture.id}: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0);
      expect(result.schemaVersion).toBe(1);

      // Generate
      const generated = generate(result);

      // Behavioral equivalence
      const equiv = checkEquivalence(fixture, generated);
      if (!equiv.pass) {
        console.error(`\nEquivalence failure: ${fixture.id}`);
        console.error(`Generated exit: ${equiv.generatedExit}`);
        console.error(`Diff:\n${equiv.diff}`);
        console.error(`\nGenerated source:\n${generated.slice(0, 500)}...`);
      }
      expect(equiv.pass, `Behavioral equivalence failed for ${fixture.id}\n${equiv.diff}`).toBe(
        true,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Roundtrip with hand-crafted AST (active now — validates generator end-to-end)
// ---------------------------------------------------------------------------

describe('roundtrip equivalence — hand-crafted AST (generator only)', () => {
  it('trivial: local x = 1; print(x) produces correct output', () => {
    const result: ObscuraParseResult = {
      schemaVersion: 1,
      source: 'local x = 2\nprint(x)\n',
      errors: [],
      hotcomments: [],
      locals: {
        0: {
          id: 0,
          name: 'x',
          location: { begin: { line: 0, column: 6 }, end: { line: 0, column: 7 } },
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
          declarationKind: 'local',
        },
      },
      root: {
        type: 'AstStatBlock',
        location: { begin: { line: 0, column: 0 }, end: { line: 2, column: 0 } },
        body: [
          {
            type: 'AstStatLocal',
            location: { begin: { line: 0, column: 0 }, end: { line: 0, column: 12 } },
            varLocalIds: [0],
            values: [
              {
                type: 'AstExprConstantNumber',
                location: { begin: { line: 0, column: 10 }, end: { line: 0, column: 11 } },
                value: 2,
              },
            ],
          },
          {
            type: 'AstStatExpr',
            location: { begin: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
            expr: {
              type: 'AstExprCall',
              location: { begin: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
              self: false,
              func: {
                type: 'AstExprGlobal',
                location: { begin: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
                name: 'print',
              },
              args: [
                {
                  type: 'AstExprLocal',
                  location: { begin: { line: 1, column: 6 }, end: { line: 1, column: 7 } },
                  localId: 0,
                  upvalue: false,
                },
              ],
            },
          },
        ],
      },
    };

    const generated = generate(result);
    const runResult = runSource(generated, 'handcrafted-trivial');

    expect(runResult.exitCode).toBe(0);
    expect(runResult.stdout.trim()).toBe('2');
  });

  it('for-loop: numeric for produces correct output', () => {
    const result: ObscuraParseResult = {
      schemaVersion: 1,
      source: 'local sum = 0\nfor i = 1, 3 do sum = sum + i end\nprint(sum)\n',
      errors: [],
      hotcomments: [],
      locals: {
        0: {
          id: 0,
          name: 'sum',
          location: { begin: { line: 0, column: 6 }, end: { line: 0, column: 9 } },
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
          declarationKind: 'local',
        },
        1: {
          id: 1,
          name: 'i',
          location: { begin: { line: 1, column: 4 }, end: { line: 1, column: 5 } },
          shadowId: null,
          functionDepth: 0,
          loopDepth: 1,
          hasAnnotation: false,
          declarationKind: 'for_num',
        },
      },
      root: {
        type: 'AstStatBlock',
        location: { begin: { line: 0, column: 0 }, end: { line: 3, column: 0 } },
        body: [
          {
            type: 'AstStatLocal',
            location: { begin: { line: 0, column: 0 }, end: { line: 0, column: 13 } },
            varLocalIds: [0],
            values: [
              {
                type: 'AstExprConstantNumber',
                location: { begin: { line: 0, column: 12 }, end: { line: 0, column: 13 } },
                value: 0,
              },
            ],
          },
          {
            type: 'AstStatFor',
            location: { begin: { line: 1, column: 0 }, end: { line: 1, column: 33 } },
            varLocalId: 1,
            from: {
              type: 'AstExprConstantNumber',
              location: { begin: { line: 1, column: 8 }, end: { line: 1, column: 9 } },
              value: 1,
            },
            to: {
              type: 'AstExprConstantNumber',
              location: { begin: { line: 1, column: 11 }, end: { line: 1, column: 12 } },
              value: 3,
            },
            step: null,
            body: {
              type: 'AstStatBlock',
              location: { begin: { line: 1, column: 17 }, end: { line: 1, column: 30 } },
              body: [
                {
                  type: 'AstStatAssign',
                  location: { begin: { line: 1, column: 17 }, end: { line: 1, column: 30 } },
                  vars: [
                    {
                      type: 'AstExprLocal',
                      location: { begin: { line: 1, column: 17 }, end: { line: 1, column: 20 } },
                      localId: 0,
                      upvalue: false,
                    },
                  ],
                  values: [
                    {
                      type: 'AstExprBinary',
                      op: 'Add',
                      location: { begin: { line: 1, column: 23 }, end: { line: 1, column: 30 } },
                      left: {
                        type: 'AstExprLocal',
                        location: { begin: { line: 1, column: 23 }, end: { line: 1, column: 26 } },
                        localId: 0,
                        upvalue: false,
                      },
                      right: {
                        type: 'AstExprLocal',
                        location: { begin: { line: 1, column: 29 }, end: { line: 1, column: 30 } },
                        localId: 1,
                        upvalue: false,
                      },
                    },
                  ],
                },
              ],
            },
          },
          {
            type: 'AstStatExpr',
            location: { begin: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
            expr: {
              type: 'AstExprCall',
              self: false,
              location: { begin: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
              func: {
                type: 'AstExprGlobal',
                location: { begin: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
                name: 'print',
              },
              args: [
                {
                  type: 'AstExprLocal',
                  location: { begin: { line: 2, column: 6 }, end: { line: 2, column: 9 } },
                  localId: 0,
                  upvalue: false,
                },
              ],
            },
          },
        ],
      },
    };

    const generated = generate(result);
    const runResult = runSource(generated, 'handcrafted-for');
    expect(runResult.exitCode).toBe(0);
    expect(runResult.stdout.trim()).toBe('6');
  });
});
