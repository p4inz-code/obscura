/**
 * Binder tests — v0.2.0
 * Tests rename-safety classification, reference counting, and global flags.
 * Uses parseNative for real AST input.
 */

import { describe, it, expect } from 'vitest';
import { bind } from '../src/binder.js';
import { parseNative } from '../src/parser-native.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(src: string) {
  const result = parseNative(src);
  expect(result.errors).toHaveLength(0);
  return result;
}

function bindSrc(src: string) {
  return bind(parse(src));
}

function localByName(result: ReturnType<typeof bindSrc>, name: string) {
  for (const [, entry] of result.symbols) {
    if (entry.local.name === name) return entry;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Basic classification
// ---------------------------------------------------------------------------

describe('basic classification', () => {
  it('simple local is safe', () => {
    const r = bindSrc('local x = 1\nprint(x)\n');
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('safe');
    expect(x?.unsafeReasons).toHaveLength(0);
    expect(x?.readCount).toBe(1);
    expect(x?.writeCount).toBe(0);
  });

  it('unreferenced local is skip', () => {
    const r = bindSrc('local x = 1\n');
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('skip');
    expect(x?.unsafeReasons).toContain('zero_references');
  });

  it('function param is safe', () => {
    const r = bindSrc('local function f(a) return a end\n');
    const a = localByName(r, 'a');
    expect(a?.renameClass).toBe('safe');
    expect(a?.local.declarationKind).toBe('param');
    expect(a?.readCount).toBe(1);
  });

  it('self param is unsafe', () => {
    const r = bindSrc('local t = {}\nfunction t:m() return self end\n');
    const self = localByName(r, 'self');
    expect(self?.renameClass).toBe('unsafe');
    expect(self?.unsafeReasons).toContain('declaration_kind_self');
  });

  it('for-loop var is safe', () => {
    const r = bindSrc('for i = 1, 10 do print(i) end\n');
    const i = localByName(r, 'i');
    expect(i?.renameClass).toBe('safe');
    expect(i?.local.declarationKind).toBe('for_num');
    expect(i?.readCount).toBe(1);
  });

  it('for-in vars are safe', () => {
    const r = bindSrc('for k, v in pairs({}) do print(k, v) end\n');
    const k = localByName(r, 'k');
    const v = localByName(r, 'v');
    expect(k?.renameClass).toBe('safe');
    expect(v?.renameClass).toBe('safe');
  });

  it('local function binding is safe', () => {
    const r = bindSrc('local function foo() return 1 end\nfoo()\n');
    const foo = localByName(r, 'foo');
    expect(foo?.renameClass).toBe('safe');
    expect(foo?.local.declarationKind).toBe('function');
    expect(foo?.readCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reference counting
// ---------------------------------------------------------------------------

describe('reference counting', () => {
  it('counts multiple reads', () => {
    const r = bindSrc('local x = 1\nprint(x + x + x)\n');
    const x = localByName(r, 'x');
    expect(x?.readCount).toBe(3);
    expect(x?.writeCount).toBe(0);
  });

  it('counts write site in assignment', () => {
    const r = bindSrc('local x = 1\nx = 2\nprint(x)\n');
    const x = localByName(r, 'x');
    expect(x?.writeCount).toBe(1);
    expect(x?.readCount).toBe(1);
  });

  it('counts compound assignment as write', () => {
    const r = bindSrc('local x = 0\nx += 1\n');
    const x = localByName(r, 'x');
    expect(x?.writeCount).toBe(1);
  });

  it('upvalue reference recorded', () => {
    const r = bindSrc('local x = 1\nlocal function f() return x end\n');
    const x = localByName(r, 'x');
    // x is read inside f() as an upvalue
    expect(x?.readCount).toBe(1);
    expect(x?.references.some(ref => ref.upvalue)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Safety flags
// ---------------------------------------------------------------------------

describe('global flags', () => {
  it('getfenv disables all renaming', () => {
    const r = bindSrc('local x = 1\ngetfenv()\nprint(x)\n');
    expect(r.flags.hasGetfenv).toBe(true);
    const x = localByName(r, 'x');
    // Post-walk: getfenv flag forces unsafe on all
    expect(x?.renameClass).toBe('unsafe');
    expect(x?.unsafeReasons).toContain('getfenv_in_scope');
  });

  it('setfenv disables all renaming', () => {
    const r = bindSrc('local x = 1\nsetfenv(1, {})\nprint(x)\n');
    expect(r.flags.hasGetfenv).toBe(true);
  });

  it('loadstring with variable arg flags dynamic load', () => {
    const r = bindSrc('local code = "return 1"\nloadstring(code)()\n');
    expect(r.flags.hasDynamicLoadstring).toBe(true);
  });

  it('loadstring with constant arg does NOT flag dynamic load', () => {
    const r = bindSrc('loadstring("return 1")()\n');
    expect(r.flags.hasDynamicLoadstring).toBe(false);
  });

  // Regression: hasDynamicLoadstring was computed but never enforced —
  // locals stayed renameable even when the script had a dynamic loadstring.
  it('dynamic loadstring disables renaming for all locals', () => {
    const r = bindSrc('local code = "return 1"\nlocal x = 1\nloadstring(code)()\nprint(x)\n');
    expect(r.flags.hasDynamicLoadstring).toBe(true);
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('unsafe');
    expect(x?.unsafeReasons).toContain('dynamic_loadstring_in_scope');
    expect(r.safeToRename.size).toBe(0);
  });

  it('constant-arg loadstring still allows renaming', () => {
    const r = bindSrc('local x = 1\nloadstring("return 1")()\nprint(x)\n');
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// Dynamic string key safety
// ---------------------------------------------------------------------------

describe('dynamic string key safety', () => {
  it('local name used as string key is unsafe', () => {
    const r = bindSrc('local x = 1\nlocal t = {}\nt["x"] = 5\nprint(x)\n');
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('unsafe');
    expect(x?.unsafeReasons).toContain('dynamic_string_key');
  });

  it('local with different name than string key is safe', () => {
    const r = bindSrc('local x = 1\nlocal t = {}\nt["y"] = 5\nprint(x)\n');
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('safe');
  });

  it('_G write sets global table write flag', () => {
    const r = bindSrc('local x = 1\n_G["x"] = x\n');
    expect(r.flags.hasGlobalTableWrite).toBe(true);
    const x = localByName(r, 'x');
    expect(x?.renameClass).toBe('unsafe');
  });
});

// ---------------------------------------------------------------------------
// safeToRename set
// ---------------------------------------------------------------------------

describe('safeToRename', () => {
  it('only safe locals appear in safeToRename', () => {
    const r = bindSrc(
      [
        'local x = 1', // safe
        'local t = {}',
        'function t:m() return self end', // self = unsafe
        'print(x)',
      ].join('\n'),
    );

    // x should be safe
    const x = localByName(r, 'x');
    expect(x).toBeDefined();
    expect(r.safeToRename.has(x!.local.id)).toBe(true);

    // self should not be in safeToRename
    const self = localByName(r, 'self');
    expect(self).toBeDefined();
    expect(r.safeToRename.has(self!.local.id)).toBe(false);
  });

  it('empty script has empty safeToRename', () => {
    const r = bindSrc('');
    expect(r.safeToRename.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Corpus-scale smoke tests
// ---------------------------------------------------------------------------

describe('corpus smoke tests', () => {
  it('binds all 9 full-mode corpus fixtures without throwing', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const fixturesDir = join(__dirname, 'golden/fixtures');
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
      const parsed = parseNative(source);
      expect(parsed.errors).toHaveLength(0);

      const bound = bind(parsed);
      expect(bound.symbols.size).toBe(Object.keys(parsed.locals).length);
      expect(bound.safeToRename.size).toBeGreaterThanOrEqual(0);
    }
  });

  it('closure fixture: upvalue locals are tracked', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const src = readFileSync(
      join(__dirname, 'golden/fixtures/02-closures.luau'),
      'latin1',
    ) as string;
    const parsed = parseNative(src);
    const bound = bind(parsed);

    // At least some locals should have upvalue references
    let upvalueCount = 0;
    for (const [, entry] of bound.symbols) {
      if (entry.references.some(r => r.upvalue)) upvalueCount++;
    }
    expect(upvalueCount).toBeGreaterThan(0);
  });
});
