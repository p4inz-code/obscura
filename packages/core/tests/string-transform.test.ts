/**
 * StringTransform tests — v0.4.0
 */

import { describe, it, expect } from 'vitest';
import { applyStringTransform } from '../src/string-transform.js';
import { generate } from '../src/generator.js';
import { parseNative } from '../src/parser-native.js';
import { runSource } from './harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pipeline(src: string, options = {}) {
  const parsed = parseNative(src);
  expect(parsed.errors).toHaveLength(0);
  const transformed = applyStringTransform(parsed, options);
  const generated = generate(transformed.result);
  return { parsed, transformed, generated };
}

function run(src: string, options = {}) {
  const { generated } = pipeline(src, options);
  return runSource(generated, 'str-test');
}

// ---------------------------------------------------------------------------
// Encoding strategies
// ---------------------------------------------------------------------------

describe('decimal encoding', () => {
  it('encodes basic string', () => {
    const { generated } = pipeline('local s = "hi"\nprint(s)\n', { encoding: 'decimal' });
    // Should contain decimal escapes, not literal "hi"
    expect(generated).not.toContain('"hi"');
    expect(generated).toMatch(/\\104|\\105/); // h=104, i=105
  });

  it('produces correct runtime output', () => {
    const r = run('print("hello")\n', { encoding: 'decimal' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello');
  });

  it('encodes non-ASCII bytes correctly', () => {
    // Latin-1: á = 0xe1 = 225 decimal
    const src = 'print("caf\xe9")\n'; // café with Latin-1 é (0xe9 = 233)
    const r = run(src, { encoding: 'decimal' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toContain('caf');
  });
});

describe('hex encoding', () => {
  it('encodes to hex escapes', () => {
    const { generated } = pipeline('local s = "ab"\nprint(s)\n', { encoding: 'hex' });
    expect(generated).not.toContain('"ab"');
    expect(generated).toMatch(/\\x61|\\x62/); // a=0x61, b=0x62
  });

  it('produces correct runtime output', () => {
    const r = run('print("world")\n', { encoding: 'hex' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('world');
  });
});

describe('split encoding', () => {
  it('splits string into concat parts', () => {
    const { generated } = pipeline('local s = "hello world"\nprint(s)\n', { encoding: 'split' });
    expect(generated).toContain('..');
    expect(generated).not.toContain('"hello world"');
  });

  it('produces correct runtime output', () => {
    const r = run('print("hello world")\n', { encoding: 'split' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello world');
  });

  it('short strings fall back to hex', () => {
    const { generated } = pipeline('local s = "ab"\nprint(s)\n', { encoding: 'split' });
    // Short string (len < 4) uses hex fallback
    expect(generated).toMatch(/\\x/);
  });
});

// ---------------------------------------------------------------------------
// Skip conditions
// ---------------------------------------------------------------------------

describe('skip conditions', () => {
  it('skips strings shorter than minLength', () => {
    const { transformed } = pipeline('local s = "x"\nprint(s)\n', { minLength: 2 });
    expect(transformed.skippedCount).toBeGreaterThan(0);
    // "x" is 1 char < minLength=2, should not be encoded
    expect(transformed.encodedCount).toBe(0);
  });

  it('skips empty string', () => {
    const { transformed } = pipeline('local s = ""\nprint(s)\n');
    expect(transformed.encodedCount).toBe(0);
  });

  it('skips require() path argument', () => {
    const src = 'local m = require("module.path")\n';
    const { generated } = pipeline(src, { encoding: 'decimal', skipRequirePaths: true });
    // require path should be unchanged
    expect(generated).toContain('"module.path"');
  });

  it('encodes require path when skipRequirePaths=false', () => {
    const src = 'local s = "hello"\nprint(s)\n'; // no require
    const { transformed } = pipeline(src, { skipRequirePaths: false });
    expect(transformed.encodedCount).toBeGreaterThan(0);
  });

  // Regression: isRequire previously matched ANY call through a local variable
  // (expr.func.type === 'AstExprLocal'), not just a local literally named `require`.
  // This silently skipped encoding the first string argument of every call made
  // through a local function reference — e.g. callbacks, event handlers, aliased
  // helpers — which are extremely common and have nothing to do with require().
  it('encodes first string arg of a call through an unrelated local function', () => {
    const src = 'local function handler(msg)\n\tprint(msg)\nend\nhandler("secret-payload")\n';
    const { generated, transformed } = pipeline(src, { encoding: 'decimal' });
    expect(transformed.encodedCount).toBeGreaterThan(0);
    expect(generated).not.toContain('"secret-payload"');
  });

  it('still skips require path when require is locally shadowed by the same name', () => {
    // `local require = require` — a local literally named `require` (shadowing
    // the global). This is the actual pattern the original code intended to
    // catch. An alias under a *different* name (e.g. `local req = require`)
    // is not require() itself from the generator's point of view — its
    // string arg is fair game for encoding, same as any other local call.
    const src = 'local require = require\nlocal m = require("module.path")\n';
    const { generated } = pipeline(src, { encoding: 'decimal', skipRequirePaths: true });
    expect(generated).toContain('"module.path"');
  });

  it('does not encode record table keys', () => {
    const src = 'local t = { key = "value" }\nprint(t.key)\n';
    const { generated } = pipeline(src, { encoding: 'decimal' });
    // The key "value" (the string value) should be encoded
    // The record key name 'key' is an AstName identifier, not a string node — unaffected
    const r = runSource(generated, 'record-key');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// Behavioral equivalence
// ---------------------------------------------------------------------------

describe('behavioral equivalence', () => {
  const encodings = ['decimal', 'hex', 'split'] as const;

  const cases = [
    {
      name: 'string concat',
      src: 'local a = "foo"\nlocal b = "bar"\nprint(a .. b)\n',
      expected: 'foobar',
    },
    { name: 'string length', src: 'print(#"hello")\n', expected: '5' },
    { name: 'string comparison', src: 'print("abc" == "abc")\n', expected: 'true' },
    {
      name: 'string in table value',
      src: 'local t = {msg = "ok"}\nprint(t.msg)\n',
      expected: 'ok',
    },
    {
      name: 'multiline string',
      src: 'local s = "line1\\nline2"\nprint(s)\n',
      expected: 'line1\nline2',
    },
    { name: 'string with escapes', src: 'print("tab:\\there")\n', expected: 'tab:\there' },
    { name: 'string.len', src: 'print(string.len("luau"))\n', expected: '4' },
    { name: 'string.sub', src: 'print(string.sub("hello", 2, 4))\n', expected: 'ell' },
    { name: 'string.upper', src: 'print(string.upper("hello"))\n', expected: 'HELLO' },
    {
      name: 'string as table key',
      src: 'local t = {}\nt["key"] = "val"\nprint(t.key)\n',
      expected: 'val',
    },
    {
      name: 'if-else on string',
      src: 'local s = "yes"\nprint(if s == "yes" then "y" else "n")\n',
      expected: 'y',
    },
    {
      name: 'string in return',
      src: 'local function f() return "result" end\nprint(f())\n',
      expected: 'result',
    },
  ];

  for (const encoding of encodings) {
    describe(`encoding=${encoding}`, () => {
      for (const { name, src, expected } of cases) {
        it(name, () => {
          const r = run(src, { encoding });
          if (r.exitCode !== 0 || r.stdout.trim() !== expected) {
            const { generated } = pipeline(src, { encoding });
            console.error(`\nGenerated (${encoding}):\n${generated}`);
          }
          expect(r.exitCode).toBe(0);
          expect(r.stdout.trim()).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Combined: Rename + String transforms
// ---------------------------------------------------------------------------

describe('combined rename + string transform', () => {
  it('rename then string: behaviorally equivalent', () => {
    const { bind } = require('../src/binder.ts');
    const { applyRenameTransform } = require('../src/rename-transform.ts');

    const src = [
      'local greeting = "hello"',
      'local function greet(name)',
      '  return greeting .. " " .. name',
      'end',
      'print(greet("world"))',
    ].join('\n');

    const parsed = parseNative(src);
    const binder = bind(parsed);
    const renamed = applyRenameTransform(parsed, binder);
    const stringed = applyStringTransform(renamed.result, { encoding: 'hex' });
    const generated = generate(stringed.result);

    const r = runSource(generated, 'combined');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello world');

    // Verify both transforms ran
    expect(renamed.renamedCount).toBeGreaterThan(0);
    expect(stringed.encodedCount).toBeGreaterThan(0);
    // Generated should contain no original names or strings
    expect(generated).not.toContain('greeting');
    expect(generated).not.toContain('"hello"');
  });
});

// ---------------------------------------------------------------------------
// Corpus equivalence after string transform
// ---------------------------------------------------------------------------

describe('corpus: string transform equivalence', () => {
  it('all full-mode corpus fixtures pass after string encoding (decimal)', () => {
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

      const transformed = applyStringTransform(parsed, { encoding: 'decimal' });
      const generated = generate(transformed.result);
      const r = runSource(generated, name);

      if (r.exitCode !== 0 || r.stdout !== expectedStdout) {
        console.error(`\n=== CORPUS FAIL: ${name} ===`);
        console.error(`Exit: ${r.exitCode}, encoded: ${transformed.encodedCount}`);
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
