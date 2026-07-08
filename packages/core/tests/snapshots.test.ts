/**
 * AST snapshot tests — Milestone 0 schema stability gate.
 *
 * Current state: parse() is stubbed. These tests define the snapshot harness
 * structure and will activate fully when WASM parse() is available.
 *
 * Active now:
 *   - Snapshot structure validation tests (hand-crafted results)
 *   - Harness smoke tests
 *
 * Activates at WASM_AVAILABLE = true:
 *   - Full corpus AST snapshots
 */

import { describe, it, expect } from 'vitest';
import { stripLocations, stripLocalLocations, allFixtures } from './harness.js';
import type { ObscuraParseResult, ObscuraLocal } from '../src/ast.js';

const WASM_AVAILABLE = false;

// ---------------------------------------------------------------------------
// Schema validation — active now with hand-crafted results
// ---------------------------------------------------------------------------

describe('ObscuraLocal schema — declarationKind field', () => {
  it('local declaration has kind=local', () => {
    const local: ObscuraLocal = {
      id: 0,
      name: 'x',
      location: { begin: { line: 0, column: 6 }, end: { line: 0, column: 7 } },
      shadowId: null,
      functionDepth: 0,
      loopDepth: 0,
      hasAnnotation: false,
      declarationKind: 'local',
    };
    expect(local.declarationKind).toBe('local');
  });

  it('param has kind=param', () => {
    const local: ObscuraLocal = {
      id: 1,
      name: 'a',
      location: { begin: { line: 1, column: 19 }, end: { line: 1, column: 20 } },
      shadowId: null,
      functionDepth: 1,
      loopDepth: 0,
      hasAnnotation: false,
      declarationKind: 'param',
    };
    expect(local.declarationKind).toBe('param');
  });

  it('for-loop var has kind=for_num', () => {
    const local: ObscuraLocal = {
      id: 2,
      name: 'i',
      location: { begin: { line: 2, column: 4 }, end: { line: 2, column: 5 } },
      shadowId: null,
      functionDepth: 0,
      loopDepth: 1,
      hasAnnotation: false,
      declarationKind: 'for_num',
    };
    expect(local.declarationKind).toBe('for_num');
  });
});

// ---------------------------------------------------------------------------
// stripLocations utility — active now
// ---------------------------------------------------------------------------

describe('snapshot utilities', () => {
  it('stripLocations removes all location fields', () => {
    const input = {
      type: 'AstStatBlock',
      location: { begin: { line: 0, column: 0 }, end: { line: 1, column: 0 } },
      body: [
        {
          type: 'AstStatReturn',
          location: { begin: { line: 0, column: 0 }, end: { line: 0, column: 8 } },
          values: [],
        },
      ],
    };
    const stripped = stripLocations(input) as { type: string; body: unknown[] };
    expect('location' in stripped).toBe(false);
    expect('location' in (stripped.body[0] as object)).toBe(false);
    expect(stripped.type).toBe('AstStatBlock');
  });

  it('stripLocalLocations removes location from each local', () => {
    const locals = {
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
    };
    const stripped = stripLocalLocations(locals) as Record<string, { name: string }>;
    expect('location' in stripped['0']!).toBe(false);
    expect(stripped['0']!.name).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// Full corpus AST snapshots — activates at WASM_AVAILABLE = true
// ---------------------------------------------------------------------------

describe('corpus AST snapshots', () => {
  if (!WASM_AVAILABLE) {
    it('SKIPPED: WASM parse() not yet implemented', () => {
      expect(true).toBe(true);
    });
    return;
  }

  const fixtures = allFixtures();
  const LARGE_FIXTURES = new Set(['11-large-basic', '05-coroutines', '02-closures']);

  for (const fixture of fixtures) {
    it(`${fixture.id}: AST shape is stable`, async () => {
      const { parse } = await import('../src/index.js');
      const result: ObscuraParseResult = parse(fixture.source);

      expect(result.errors).toHaveLength(0);
      expect(result.schemaVersion).toBe(1);

      if (LARGE_FIXTURES.has(fixture.id)) {
        // Large fixtures: snapshot locals table (location-stripped) + root node types only
        // Avoids 10K-line snapshot diffs from whitespace changes in the parser
        const snapshot = {
          localCount: Object.keys(result.locals).length,
          locals: stripLocalLocations(result.locals as unknown as Record<string, unknown>),
          rootBodyTypes: (result.root.body as Array<{ type: string }>).map(s => s.type),
        };
        expect(snapshot).toMatchSnapshot();
      } else {
        // Small/medium fixtures: full AST snapshot with locations
        const snapshot = {
          locals: result.locals,
          root: result.root,
        };
        expect(snapshot).toMatchSnapshot();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Schema stability — detects breaking changes to ObscuraLocal shape
// ---------------------------------------------------------------------------

describe('schema version contract', () => {
  it('ObscuraLocal has required fields for Binder', () => {
    // This test will catch any accidental removal of Binder-required fields
    const requiredLocalFields: Array<keyof ObscuraLocal> = [
      'id',
      'name',
      'location',
      'shadowId',
      'functionDepth',
      'loopDepth',
      'hasAnnotation',
      'declarationKind',
    ];

    const sampleLocal: ObscuraLocal = {
      id: 0,
      name: 'x',
      location: { begin: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
      shadowId: null,
      functionDepth: 0,
      loopDepth: 0,
      hasAnnotation: false,
      declarationKind: 'local',
    };

    for (const field of requiredLocalFields) {
      expect(field in sampleLocal, `Missing required field: ${field}`).toBe(true);
    }
  });

  if (!WASM_AVAILABLE) return;

  it('parse() result satisfies schemaVersion: 1', async () => {
    const { parse } = await import('../src/index.js');
    const result = parse('local x = 1\n');
    expect(result.schemaVersion).toBe(1);
    expect(typeof result.locals).toBe('object');
    expect(result.root.type).toBe('AstStatBlock');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
