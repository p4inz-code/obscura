/**
 * ConstantTransform tests — v0.5.0
 */

import { describe, it, expect } from 'vitest';
import { applyConstantTransform } from '../src/constant-transform.js';
import { generate } from '../src/generator.js';
import { parseNative } from '../src/parser-native.js';
import { runSource } from './harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pipeline(src: string, options = {}) {
  const parsed = parseNative(src);
  expect(parsed.errors).toHaveLength(0);
  const transformed = applyConstantTransform(parsed, options);
  const generated = generate(transformed.result);
  return { parsed, transformed, generated };
}

function run(src: string, options = {}) {
  const { generated } = pipeline(src, options);
  return runSource(generated, 'const-test');
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed produces identical output', () => {
    const src = 'print(42, 100, 7, true, false)\n';
    const a = pipeline(src, { seed: 5 }).generated;
    const b = pipeline(src, { seed: 5 }).generated;
    expect(a).toBe(b);
  });

  it('different seeds may produce different output', () => {
    const src = 'print(42, 100, 7, 999, 12345)\n';
    const a = pipeline(src, { seed: 1 }).generated;
    const b = pipeline(src, { seed: 2 }).generated;
    // Not guaranteed different on every value, but across 5 numbers
    // extremely likely at least one differs
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Number encoding — arithmetic
// ---------------------------------------------------------------------------

describe('arithmetic encoding', () => {
  it('encodes integer constants', () => {
    const { generated, transformed } = pipeline('print(42)\n', {
      numberEncoding: 'arithmetic',
      seed: 1,
    });
    expect(transformed.encodedNumbers).toBe(1);
    expect(generated).not.toMatch(/print\(42\)/);
  });

  it('produces correct runtime output for various integers', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = run('print(42)\n', { numberEncoding: 'arithmetic', seed });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('42');
    }
  });

  it('handles negative integers correctly', () => {
    const r = run('print(-17)\n', { numberEncoding: 'arithmetic', seed: 3 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('-17');
  });

  it('handles floats correctly', () => {
    const r = run('print(3.14)\n', { numberEncoding: 'arithmetic', seed: 7 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('3.14');
  });

  it('handles negative floats correctly', () => {
    const r = run('print(-2.5)\n', { numberEncoding: 'arithmetic', seed: 11 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('-2.5');
  });
});

// ---------------------------------------------------------------------------
// Number encoding — bitwise
// ---------------------------------------------------------------------------

describe('bitwise encoding', () => {
  it('encodes integer via bit32.bxor', () => {
    const { generated } = pipeline('print(42)\n', { numberEncoding: 'bitwise' });
    expect(generated).toContain('bit32.bxor');
  });

  it('produces correct runtime output', () => {
    const r = run('print(42)\n', { numberEncoding: 'bitwise' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('42');
  });

  it('handles negative integers', () => {
    const r = run('print(-99)\n', { numberEncoding: 'bitwise' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('-99');
  });

  it('falls back to arithmetic for non-integer values', () => {
    const { generated } = pipeline('print(3.5)\n', { numberEncoding: 'bitwise' });
    expect(generated).not.toContain('bit32.bxor');
    const r = run('print(3.5)\n', { numberEncoding: 'bitwise' });
    expect(r.stdout.trim()).toBe('3.5');
  });
});

// ---------------------------------------------------------------------------
// Boolean encoding
// ---------------------------------------------------------------------------

describe('boolean encoding', () => {
  it('encodes true', () => {
    const { generated, transformed } = pipeline('print(true)\n', { seed: 1 });
    expect(transformed.encodedBooleans).toBe(1);
    expect(generated).not.toMatch(/print\(true\)/);
  });

  it('encodes false', () => {
    const { generated, transformed } = pipeline('print(false)\n', { seed: 1 });
    expect(transformed.encodedBooleans).toBe(1);
    expect(generated).not.toMatch(/print\(false\)/);
  });

  it('produces correct runtime output for true across seeds', () => {
    for (const seed of [0, 1, 2, 3, 4]) {
      const r = run('print(true)\n', { seed });
      expect(r.stdout.trim()).toBe('true');
    }
  });

  it('produces correct runtime output for false across seeds', () => {
    for (const seed of [0, 1, 2, 3, 4]) {
      const r = run('print(false)\n', { seed });
      expect(r.stdout.trim()).toBe('false');
    }
  });

  it('skips boolean encoding when encodeBooleans=false', () => {
    const { generated, transformed } = pipeline('print(true)\n', { encodeBooleans: false });
    expect(transformed.encodedBooleans).toBe(0);
    expect(generated).toContain('print(true)');
  });
});

// ---------------------------------------------------------------------------
// Skip conditions
// ---------------------------------------------------------------------------

describe('skip conditions', () => {
  it('skips 0', () => {
    const { transformed } = pipeline('local x = 0\nprint(x)\n');
    expect(transformed.encodedNumbers).toBe(0);
  });

  it('skips 1', () => {
    const { transformed } = pipeline('local x = 1\nprint(x)\n');
    expect(transformed.encodedNumbers).toBe(0);
  });

  it('skips for-loop bounds', () => {
    const { generated } = pipeline('for i = 1, 10 do print(i) end\n', { seed: 1 });
    // Loop bounds 1 and 10 should remain literal in the for statement
    expect(generated).toContain('for i = 1, 10 do');
  });

  it('does not skip non-loop-bound numbers near loops', () => {
    const { transformed } = pipeline('for i = 1, 10 do\n  print(42)\nend\n', { seed: 1 });
    expect(transformed.encodedNumbers).toBe(1); // only 42, not loop bounds
  });
});

// ---------------------------------------------------------------------------
// Behavioral equivalence
// ---------------------------------------------------------------------------

describe('behavioral equivalence', () => {
  const encodings: Array<'arithmetic' | 'bitwise' | 'mixed'> = ['arithmetic', 'bitwise', 'mixed'];

  const cases = [
    { name: 'arithmetic with constants', src: 'print(42 + 8)\n', expected: '50' },
    { name: 'comparison with constant', src: 'print(15 > 10)\n', expected: 'true' },
    {
      name: 'constant in function return',
      src: 'local function f() return 99 end\nprint(f())\n',
      expected: '99',
    },
    { name: 'constant as table value', src: 'local t = {x = 55}\nprint(t.x)\n', expected: '55' },
    {
      name: 'boolean in condition',
      src: 'if true then print("yes") else print("no") end\n',
      expected: 'yes',
    },
    { name: 'boolean in and/or', src: 'print(true and 5 or 10)\n', expected: '5' },
    { name: 'negative number arithmetic', src: 'print(-50 + 100)\n', expected: '50' },
    { name: 'float arithmetic', src: 'print(2.5 * 4)\n', expected: '10' },
    { name: 'large integer', src: 'print(123456)\n', expected: '123456' },
    {
      name: 'multiple constants',
      src: 'print(7, 13, 99, true, false)\n',
      expected: '7\t13\t99\ttrue\tfalse',
    },
  ];

  for (const numberEncoding of encodings) {
    describe(`numberEncoding=${numberEncoding}`, () => {
      for (const { name, src, expected } of cases) {
        it(name, () => {
          const r = run(src, { numberEncoding, seed: 42 });
          if (r.exitCode !== 0 || r.stdout.trim() !== expected) {
            const { generated } = pipeline(src, { numberEncoding, seed: 42 });
            console.error(`\nGenerated (${numberEncoding}):\n${generated}`);
          }
          expect(r.exitCode).toBe(0);
          expect(r.stdout.trim()).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Combined: Rename + String + Constant
// ---------------------------------------------------------------------------

describe('combined all three transforms', () => {
  it('rename + string + constant: behaviorally equivalent', () => {
    const { bind } = require('../src/binder.ts');
    const { applyRenameTransform } = require('../src/rename-transform.ts');
    const { applyStringTransform } = require('../src/string-transform.ts');

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
    const generated = generate(constanted.result);

    const r = runSource(generated, 'all-three');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello world (42)');

    expect(renamed.renamedCount).toBeGreaterThan(0);
    expect(stringed.encodedCount).toBeGreaterThan(0);
    expect(constanted.encodedNumbers).toBeGreaterThan(0);
    expect(generated).not.toContain('greeting');
    expect(generated).not.toContain('"hello"');
    expect(generated).not.toMatch(/\bcount = 42\b/);
  });
});

// ---------------------------------------------------------------------------
// Corpus equivalence
// ---------------------------------------------------------------------------

describe('corpus: constant transform equivalence', () => {
  it('all full-mode corpus fixtures pass after constant encoding', () => {
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

      const transformed = applyConstantTransform(parsed, { numberEncoding: 'mixed', seed: 17 });
      const generated = generate(transformed.result);
      const r = runSource(generated, name);

      if (r.exitCode !== 0 || r.stdout !== expectedStdout) {
        console.error(`\n=== CORPUS FAIL: ${name} ===`);
        console.error(
          `Exit: ${r.exitCode}, numbers: ${transformed.encodedNumbers}, bools: ${transformed.encodedBooleans}`,
        );
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
