/**
 * DeadCodeTransform tests — v0.6.0
 */

import { describe, it, expect } from 'vitest';
import { applyDeadCodeTransform } from '../src/dead-code-transform.js';
import { generate } from '../src/generator.js';
import { parseNative } from '../src/parser-native.js';
import { runSource } from './harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pipeline(src: string, options = {}) {
  const parsed = parseNative(src);
  expect(parsed.errors).toHaveLength(0);
  const transformed = applyDeadCodeTransform(parsed, options);
  const generated = generate(transformed.result);
  return { parsed, transformed, generated };
}

function run(src: string, options = {}) {
  const { generated } = pipeline(src, options);
  return runSource(generated, 'dc-test');
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed produces identical output', () => {
    const src = 'local x = 1\nif x > 0 then\n  print(x)\nend\n';
    const a = pipeline(src, { seed: 5, insertionRate: 1.0 }).generated;
    const b = pipeline(src, { seed: 5, insertionRate: 1.0 }).generated;
    expect(a).toBe(b);
  });

  it('insertionRate=0 inserts nothing', () => {
    const { transformed } = pipeline('print(1)\n', { insertionRate: 0 });
    expect(transformed.insertedBlocks).toBe(0);
  });

  it('insertionRate=1 inserts at every block', () => {
    const src = 'if true then\n  print(1)\nend\n';
    const { transformed } = pipeline(src, { insertionRate: 1.0, seed: 1 });
    // Top-level block + the if-then body = at least 2 blocks
    expect(transformed.insertedBlocks).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Structural correctness
// ---------------------------------------------------------------------------

describe('structural correctness', () => {
  it('inserted block uses a provably-false condition', () => {
    const { generated } = pipeline('print(1)\n', { insertionRate: 1.0, seed: 1 });
    // Should contain one of the false-identity patterns
    expect(generated).toMatch(/1 == 2|5 ~= 5|10 < 1/);
  });

  it('inserted block body contains only local declarations', () => {
    const { transformed } = pipeline('print(1)\n', { insertionRate: 1.0, seed: 1 });
    // Walk the result to find the inserted if-block and verify its body
    function findDeadBlocks(node: any, found: any[] = []): any[] {
      if (node?.type === 'AstStatIf' && node?.elseBody === null) {
        found.push(node);
      }
      for (const v of Object.values(node ?? {})) {
        if (v && typeof v === 'object') {
          if (Array.isArray(v)) v.forEach(x => findDeadBlocks(x, found));
          else if ('type' in (v as object)) findDeadBlocks(v, found);
        }
      }
      return found;
    }
    const blocks = findDeadBlocks(transformed.result.root);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      for (const stat of block.thenBody.body) {
        expect(stat.type).toBe('AstStatLocal');
        // Values must be constants only — no calls, no globals
        for (const val of stat.values) {
          expect(['AstExprConstantNumber', 'AstExprConstantString']).toContain(val.type);
        }
      }
    }
  });

  it('does not modify existing statements', () => {
    const src = 'local x = 42\nprint(x)\n';
    const { transformed } = pipeline(src, { insertionRate: 1.0, seed: 1 });
    // Original statements should still be present in the body (after insertion)
    const types = transformed.result.root.body.map((s: any) => s.type);
    expect(types).toContain('AstStatLocal');
    expect(types).toContain('AstStatExpr');
  });
});

// ---------------------------------------------------------------------------
// Behavioral equivalence — the critical safety property
// ---------------------------------------------------------------------------

describe('behavioral equivalence', () => {
  const cases = [
    { name: 'simple print', src: 'print("hello")\n', expected: 'hello' },
    { name: 'arithmetic', src: 'print(2 + 2)\n', expected: '4' },
    {
      name: 'if-else',
      src: 'local x = 5\nif x > 3 then print("big") else print("small") end\n',
      expected: 'big',
    },
    {
      name: 'while loop',
      src: 'local i = 0\nwhile i < 3 do i = i + 1 end\nprint(i)\n',
      expected: '3',
    },
    {
      name: 'for loop',
      src: 'local sum = 0\nfor i = 1, 5 do sum = sum + i end\nprint(sum)\n',
      expected: '15',
    },
    {
      name: 'function call',
      src: 'local function f(x) return x * 2 end\nprint(f(21))\n',
      expected: '42',
    },
    {
      name: 'nested blocks',
      src: 'do\n  do\n    print("nested")\n  end\nend\n',
      expected: 'nested',
    },
    {
      name: 'repeat-until',
      src: 'local n = 0\nrepeat n = n + 1 until n >= 5\nprint(n)\n',
      expected: '5',
    },
    {
      name: 'closure',
      src: 'local function make() local c = 0 return function() c = c + 1 return c end end\nlocal f = make()\nprint(f(), f(), f())\n',
      expected: '1\t2\t3',
    },
    {
      name: 'for-in',
      src: 'local sum = 0\nfor _, v in ipairs({1,2,3}) do sum = sum + v end\nprint(sum)\n',
      expected: '6',
    },
  ];

  for (const insertionRate of [0.3, 0.7, 1.0]) {
    describe(`insertionRate=${insertionRate}`, () => {
      for (const { name, src, expected } of cases) {
        it(name, () => {
          const r = run(src, { insertionRate, seed: 42 });
          if (r.exitCode !== 0 || r.stdout.trim() !== expected) {
            const { generated } = pipeline(src, { insertionRate, seed: 42 });
            console.error(`\nGenerated (rate=${insertionRate}):\n${generated}`);
          }
          expect(r.exitCode).toBe(0);
          expect(r.stdout.trim()).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Combined: all four transforms
// ---------------------------------------------------------------------------

describe('combined all four transforms', () => {
  it('rename + string + constant + deadcode: behaviorally equivalent', () => {
    const { bind } = require('../src/binder.ts');
    const { applyRenameTransform } = require('../src/rename-transform.ts');
    const { applyStringTransform } = require('../src/string-transform.ts');
    const { applyConstantTransform } = require('../src/constant-transform.ts');

    const src = [
      'local greeting = "hello"',
      'local count = 42',
      'local function describe(name)',
      '  return greeting .. " " .. name .. " (" .. tostring(count) .. ")"',
      'end',
      'print(describe("world"))',
    ].join('\n');

    const parsed = parseNative(src);
    const binder = bind(parsed);
    const renamed = applyRenameTransform(parsed, binder);
    const stringed = applyStringTransform(renamed.result, { encoding: 'hex' });
    const constanted = applyConstantTransform(stringed.result, {
      numberEncoding: 'mixed',
      seed: 99,
    });
    const deadcoded = applyDeadCodeTransform(constanted.result, { insertionRate: 0.5, seed: 77 });
    const generated = generate(deadcoded.result);

    const r = runSource(generated, 'all-four');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello world (42)');

    expect(deadcoded.insertedBlocks).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Corpus equivalence
// ---------------------------------------------------------------------------

describe('corpus: dead code transform equivalence', () => {
  it('all full-mode corpus fixtures pass after dead code insertion', () => {
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

      const transformed = applyDeadCodeTransform(parsed, { insertionRate: 0.5, seed: 23 });
      const generated = generate(transformed.result);
      const r = runSource(generated, name);

      if (r.exitCode !== 0 || r.stdout !== expectedStdout) {
        console.error(`\n=== CORPUS FAIL: ${name} ===`);
        console.error(`Exit: ${r.exitCode}, inserted: ${transformed.insertedBlocks}`);
        const outLines = r.stdout.split('\n');
        const expLines = expectedStdout.split('\n');
        for (let i = 0; i < Math.max(outLines.length, expLines.length); i++) {
          if (outLines[i] !== expLines[i]) {
            console.error(
              `  line ${i + 1}: got ${JSON.stringify(outLines[i])}, want ${JSON.stringify(expLines[i])}`,
            );
          }
        }
      }

      expect(r.exitCode, `${name}: exit`).toBe(0);
      expect(r.stdout, `${name}: stdout`).toBe(expectedStdout);
    }
  });
});
