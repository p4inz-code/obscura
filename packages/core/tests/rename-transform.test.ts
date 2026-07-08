/**
 * RenameTransform tests — v0.3.0
 * Verifies rename correctness, safety constraints, and behavioral equivalence.
 */

import { describe, it, expect } from 'vitest';
import { bind } from '../src/binder.js';
import { applyRenameTransform, nameSequence } from '../src/rename-transform.js';
import { generate } from '../src/generator.js';
import { parseNative } from '../src/parser-native.js';
import { runSource } from './harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAndBind(src: string) {
  const parsed = parseNative(src);
  expect(parsed.errors).toHaveLength(0);
  const binder = bind(parsed);
  return { parsed, binder };
}

function fullPipeline(src: string) {
  const { parsed, binder } = parseAndBind(src);
  const transformed = applyRenameTransform(parsed, binder);
  const generated = generate(transformed.result);
  return { parsed, binder, transformed, generated };
}

// ---------------------------------------------------------------------------
// Name sequence
// ---------------------------------------------------------------------------

describe('nameSequence', () => {
  it('produces a, b, c ... z, aa, ab ...', () => {
    const gen = nameSequence();
    const first30 = Array.from({ length: 30 }, () => gen.next().value);
    expect(first30[0]).toBe('a');
    expect(first30[25]).toBe('z');
    expect(first30[26]).toBe('aa');
    expect(first30[27]).toBe('ab');
  });

  it('skips Luau keywords', () => {
    const gen = nameSequence();
    const first200 = new Set(Array.from({ length: 200 }, () => gen.next().value));
    const keywords = [
      'and',
      'break',
      'do',
      'else',
      'elseif',
      'end',
      'false',
      'for',
      'function',
      'if',
      'in',
      'local',
      'nil',
      'not',
      'or',
      'repeat',
      'return',
      'then',
      'true',
      'until',
      'while',
    ];
    for (const kw of keywords) {
      expect(first200.has(kw), `keyword '${kw}' appeared in name sequence`).toBe(false);
    }
  });

  it('produces unique names', () => {
    const gen = nameSequence();
    const names = Array.from({ length: 500 }, () => gen.next().value);
    expect(new Set(names).size).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Basic rename correctness
// ---------------------------------------------------------------------------

describe('rename correctness', () => {
  it('renames safe locals', () => {
    const { transformed } = fullPipeline('local longVariableName = 1\nprint(longVariableName)\n');
    expect(transformed.renamedCount).toBeGreaterThan(0);
    const names = Object.values(transformed.result.locals).map(l => l.name);
    expect(names).not.toContain('longVariableName');
  });

  it('does not rename self params', () => {
    const { transformed } = fullPipeline('local t = {}\nfunction t:method() return self end\n');
    const selfEntry = Object.values(transformed.result.locals).find(
      l => l.declarationKind === 'self',
    );
    expect(selfEntry?.name).toBe('self');
  });

  it('does not rename when getfenv is present', () => {
    const { transformed } = fullPipeline('local x = 1\ngetfenv()\nprint(x)\n');
    // Binder marks all locals unsafe when getfenv present
    expect(transformed.renamedCount).toBe(0);
    const names = Object.values(transformed.result.locals).map(l => l.name);
    expect(names).toContain('x');
  });

  it('does not rename dynamic string key matches', () => {
    const { transformed } = fullPipeline('local x = 1\nlocal t = {}\nt["x"] = 5\nprint(x)\n');
    const xEntry = Object.values(transformed.result.locals).find(l => l.name === 'x');
    expect(xEntry?.name).toBe('x'); // unchanged
  });

  it('renamed names do not collide with globals', () => {
    // 'print', 'pairs', 'ipairs' are globals — generated names must not use them
    // (they're single-word globals that may appear in the early name sequence)
    const src =
      Array.from({ length: 30 }, (_, i) => `local var${i} = ${i}`).join('\n') +
      '\nfor i = 1, 30 do print(i) end\n';
    const { transformed } = fullPipeline(src);
    const newNames = Object.values(transformed.result.locals).map(l => l.name);
    expect(newNames).not.toContain('print');
  });

  it('renamed names do not collide with each other', () => {
    const src =
      Array.from({ length: 50 }, (_, i) => `local var${i} = ${i}`).join('\n') +
      '\nprint(' +
      Array.from({ length: 50 }, (_, i) => `var${i}`).join('+') +
      ')\n';
    const { transformed } = fullPipeline(src);
    const newNames = new Set(Object.values(transformed.result.locals).map(l => l.name));
    // All names must be unique
    expect(newNames.size).toBe(Object.keys(transformed.result.locals).length);
  });
});

// ---------------------------------------------------------------------------
// Shadow chain safety
// ---------------------------------------------------------------------------

describe('shadow chain safety', () => {
  it('shadowing local gets different name from shadowed local', () => {
    const src = [
      'local x = 1',
      'do',
      '  local x = 2', // shadows outer x
      '  print(x)',
      'end',
      'print(x)',
    ].join('\n');
    const { transformed, generated } = fullPipeline(src);
    // Both 'x' locals should be renamed to different names
    const names = Object.values(transformed.result.locals).map(l => l.name);
    expect(new Set(names).size).toBe(names.length);

    // Runtime check
    const run = runSource(generated, 'shadow-safety');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe('2\n1');
  });

  it('does not conflate inner and outer scope locals', () => {
    const src = [
      'local result = 0',
      'for i = 1, 3 do',
      '  local i = i * 2', // shadows loop var
      '  result = result + i',
      'end',
      'print(result)',
    ].join('\n');
    const run = runSource(
      generate(applyRenameTransform(parseNative(src), bind(parseNative(src))).result),
      'shadow-loop',
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe('12'); // (1*2)+(2*2)+(3*2)=12
  });
});

// ---------------------------------------------------------------------------
// Behavioral equivalence — run original and renamed through Luau
// ---------------------------------------------------------------------------

describe('behavioral equivalence', () => {
  const cases: Array<{ name: string; src: string; expected: string }> = [
    {
      name: 'simple local and print',
      src: 'local value = 42\nprint(value)\n',
      expected: '42',
    },
    {
      name: 'function with params',
      src: 'local function add(a, b) return a + b end\nprint(add(3, 4))\n',
      expected: '7',
    },
    {
      name: 'closure captures upvalue',
      src: [
        'local count = 0',
        'local function increment() count = count + 1 end',
        'increment()',
        'increment()',
        'print(count)',
      ].join('\n'),
      expected: '2',
    },
    {
      name: 'for loop accumulator',
      src: ['local sum = 0', 'for i = 1, 5 do sum = sum + i end', 'print(sum)'].join('\n'),
      expected: '15',
    },
    {
      name: 'for-in pairs',
      src: [
        'local t = {a=1, b=2, c=3}',
        'local keys = {}',
        'for k, v in pairs(t) do keys[#keys+1] = k end',
        'table.sort(keys)',
        'print(table.concat(keys, ","))',
      ].join('\n'),
      expected: 'a,b,c',
    },
    {
      name: 'nested closures',
      src: [
        'local function makeAdder(n)',
        '  return function(x) return x + n end',
        'end',
        'local add5 = makeAdder(5)',
        'print(add5(3))',
      ].join('\n'),
      expected: '8',
    },
    {
      name: 'multiple returns',
      src: [
        'local function swap(a, b) return b, a end',
        'local x, y = swap(10, 20)',
        'print(x, y)',
      ].join('\n'),
      expected: '20\t10',
    },
    {
      name: 'if-else expression',
      src: ['local x = 5', 'local label = if x > 3 then "big" else "small"', 'print(label)'].join(
        '\n',
      ),
      expected: 'big',
    },
    {
      name: 'repeat-until',
      src: ['local n = 0', 'repeat n = n + 1 until n >= 3', 'print(n)'].join('\n'),
      expected: '3',
    },
    {
      name: 'local function recursive',
      src: [
        'local function fact(n)',
        '  if n <= 1 then return 1 end',
        '  return n * fact(n - 1)',
        'end',
        'print(fact(5))',
      ].join('\n'),
      expected: '120',
    },
  ];

  for (const { name, src, expected } of cases) {
    it(`${name}: renamed output matches expected`, () => {
      const parsed = parseNative(src);
      expect(parsed.errors).toHaveLength(0);

      const binder = bind(parsed);
      const transformed = applyRenameTransform(parsed, binder);
      const generated = generate(transformed.result);

      const run = runSource(generated, name.replace(/\s+/g, '-'));
      if (run.exitCode !== 0 || run.stdout.trim() !== expected) {
        console.error(`\n=== FAIL: ${name} ===`);
        console.error('Generated:\n', generated);
        console.error('Stdout:', JSON.stringify(run.stdout));
        console.error('Expected:', JSON.stringify(expected));
      }
      expect(run.exitCode).toBe(0);
      expect(run.stdout.trim()).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Corpus equivalence — full 9-fixture corpus renamed and re-run
// ---------------------------------------------------------------------------

describe('corpus rename equivalence', () => {
  it('all full-mode corpus fixtures pass after rename', () => {
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

      const binder = bind(parsed);
      const transformed = applyRenameTransform(parsed, binder);
      const generated = generate(transformed.result);

      const run = runSource(generated, name);

      if (run.exitCode !== 0 || run.stdout !== expectedStdout) {
        console.error(`\n=== CORPUS FAIL: ${name} ===`);
        console.error(`Exit: ${run.exitCode}`);
        console.error(`Stdout diff:`);
        const outLines = run.stdout.split('\n');
        const expLines = expectedStdout.split('\n');
        for (let i = 0; i < Math.max(outLines.length, expLines.length); i++) {
          if (outLines[i] !== expLines[i]) {
            console.error(
              `  line ${i + 1}: got ${JSON.stringify(outLines[i])}, want ${JSON.stringify(expLines[i])}`,
            );
          }
        }
        console.error(`\nRenamed: ${transformed.renamedCount} locals`);
      }

      expect(run.exitCode, `${name}: exit code`).toBe(0);
      expect(run.stdout, `${name}: stdout`).toBe(expectedStdout);
    }
  });
});
