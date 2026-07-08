/**
 * Generator unit tests
 *
 * These tests use hand-crafted ObscuraParseResult objects — no WASM parse required.
 * They verify the generator produces correct Luau for every node type defined in ast.ts.
 * Behavioral equivalence (run the output through the Luau binary) happens in integration tests.
 */

import { describe, it, expect } from 'vitest';
import { generate } from '../src/generator.js';
import type { ObscuraParseResult, AstStatBlock } from '../src/ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOC = { begin: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

function makeResult(
  block: AstStatBlock,
  locals: ObscuraParseResult['locals'] = {},
  source = '',
): ObscuraParseResult {
  return { schemaVersion: 1, source, locals, root: block, errors: [], hotcomments: [] };
}

function block(...body: AstStatBlock['body']): AstStatBlock {
  return { type: 'AstStatBlock', location: LOC, body };
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

describe('literals', () => {
  it('emits nil', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprConstantNil', location: LOC }],
      }),
    );
    expect(generate(r)).toBe('return nil\n');
  });

  it('emits true / false', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprConstantBool', location: LOC, value: true }],
      }),
    );
    expect(generate(r)).toBe('return true\n');
  });

  it('emits integers', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprConstantNumber', location: LOC, value: 42 }],
      }),
    );
    expect(generate(r)).toBe('return 42\n');
  });

  it('emits floats with enough precision', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprConstantNumber', location: LOC, value: 3.14 }],
      }),
    );
    const out = generate(r);
    expect(out).toContain('3.14');
  });

  it('emits double-quoted strings with escapes', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprConstantString', location: LOC, value: 'hello\nworld' }],
      }),
    );
    expect(generate(r)).toBe('return "hello\\nworld"\n');
  });

  it('emits varargs', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprVarargs', location: LOC }],
      }),
    );
    expect(generate(r)).toBe('return ...\n');
  });
});

// ---------------------------------------------------------------------------
// Local variables
// ---------------------------------------------------------------------------

describe('locals', () => {
  it('emits local declaration without value', () => {
    const r = makeResult(
      block({ type: 'AstStatLocal', location: LOC, varLocalIds: [0], values: [] }),
      {
        0: {
          id: 0,
          name: 'x',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('local x\n');
  });

  it('emits local declaration with value', () => {
    const r = makeResult(
      block({
        type: 'AstStatLocal',
        location: LOC,
        varLocalIds: [0],
        values: [{ type: 'AstExprConstantNumber', location: LOC, value: 1 }],
      }),
      {
        0: {
          id: 0,
          name: 'x',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('local x = 1\n');
  });

  it('emits multiple locals', () => {
    const r = makeResult(
      block({
        type: 'AstStatLocal',
        location: LOC,
        varLocalIds: [0, 1],
        values: [
          { type: 'AstExprConstantNumber', location: LOC, value: 1 },
          { type: 'AstExprConstantNumber', location: LOC, value: 2 },
        ],
      }),
      {
        0: {
          id: 0,
          name: 'a',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
        1: {
          id: 1,
          name: 'b',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('local a, b = 1, 2\n');
  });

  it('emits local reference', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprLocal', location: LOC, localId: 0, upvalue: false }],
      }),
      {
        0: {
          id: 0,
          name: 'myVar',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('return myVar\n');
  });

  it('emits global reference', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprGlobal', location: LOC, name: 'print' }],
      }),
    );
    expect(generate(r)).toBe('return print\n');
  });
});

// ---------------------------------------------------------------------------
// Binary operators and precedence
// ---------------------------------------------------------------------------

describe('binary operators', () => {
  it('emits addition', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprBinary',
            location: LOC,
            op: 'Add',
            left: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
            right: { type: 'AstExprConstantNumber', location: LOC, value: 2 },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return 1 + 2\n');
  });

  it('does NOT add unnecessary parens for same-precedence left-assoc', () => {
    // (1 + 2) + 3 — left-assoc, no parens needed
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprBinary',
            location: LOC,
            op: 'Add',
            left: {
              type: 'AstExprBinary',
              location: LOC,
              op: 'Add',
              left: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
              right: { type: 'AstExprConstantNumber', location: LOC, value: 2 },
            },
            right: { type: 'AstExprConstantNumber', location: LOC, value: 3 },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return 1 + 2 + 3\n');
  });

  it('adds parens for lower-precedence sub-expression on left of higher-precedence', () => {
    // (1 + 2) * 3 — + has lower prec than *, needs parens
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprBinary',
            location: LOC,
            op: 'Mul',
            left: {
              type: 'AstExprBinary',
              location: LOC,
              op: 'Add',
              left: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
              right: { type: 'AstExprConstantNumber', location: LOC, value: 2 },
            },
            right: { type: 'AstExprConstantNumber', location: LOC, value: 3 },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return (1 + 2) * 3\n');
  });

  it('handles right-associative concat without parens', () => {
    // a .. (b .. c) — right-assoc, no parens needed on right
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprBinary',
            location: LOC,
            op: 'Concat',
            left: { type: 'AstExprConstantString', location: LOC, value: 'a' },
            right: {
              type: 'AstExprBinary',
              location: LOC,
              op: 'Concat',
              left: { type: 'AstExprConstantString', location: LOC, value: 'b' },
              right: { type: 'AstExprConstantString', location: LOC, value: 'c' },
            },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return "a" .. "b" .. "c"\n');
  });

  it('emits logical and / or', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprBinary',
            location: LOC,
            op: 'Or',
            left: {
              type: 'AstExprBinary',
              location: LOC,
              op: 'And',
              left: { type: 'AstExprConstantBool', location: LOC, value: true },
              right: { type: 'AstExprConstantBool', location: LOC, value: false },
            },
            right: { type: 'AstExprConstantNil', location: LOC },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return true and false or nil\n');
  });

  it('emits floor division', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprBinary',
            location: LOC,
            op: 'FloorDiv',
            left: { type: 'AstExprConstantNumber', location: LOC, value: 10 },
            right: { type: 'AstExprConstantNumber', location: LOC, value: 3 },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return 10 // 3\n');
  });
});

// ---------------------------------------------------------------------------
// Unary operators
// ---------------------------------------------------------------------------

describe('unary operators', () => {
  it('emits not', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprUnary',
            location: LOC,
            op: 'Not',
            expr: { type: 'AstExprConstantBool', location: LOC, value: true },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return not true\n');
  });

  it('emits unary minus', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprUnary',
            location: LOC,
            op: 'Minus',
            expr: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return -1\n');
  });

  it('emits length', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprUnary',
            location: LOC,
            op: 'Len',
            expr: { type: 'AstExprGlobal', location: LOC, name: 't' },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return #t\n');
  });
});

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

describe('control flow', () => {
  it('emits while loop', () => {
    const r = makeResult(
      block({
        type: 'AstStatWhile',
        location: LOC,
        condition: { type: 'AstExprConstantBool', location: LOC, value: true },
        body: block({ type: 'AstStatBreak', location: LOC }),
      }),
    );
    expect(generate(r)).toBe('while true do\n\tbreak\nend\n');
  });

  it('emits numeric for loop', () => {
    const r = makeResult(
      block({
        type: 'AstStatFor',
        location: LOC,
        varLocalId: 0,
        from: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
        to: { type: 'AstExprConstantNumber', location: LOC, value: 10 },
        step: null,
        body: block({ type: 'AstStatBreak', location: LOC }),
      }),
      {
        0: {
          id: 0,
          name: 'i',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('for i = 1, 10 do\n\tbreak\nend\n');
  });

  it('emits numeric for loop with step', () => {
    const r = makeResult(
      block({
        type: 'AstStatFor',
        location: LOC,
        varLocalId: 0,
        from: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
        to: { type: 'AstExprConstantNumber', location: LOC, value: 10 },
        step: { type: 'AstExprConstantNumber', location: LOC, value: 2 },
        body: block({ type: 'AstStatBreak', location: LOC }),
      }),
      {
        0: {
          id: 0,
          name: 'i',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('for i = 1, 10, 2 do\n\tbreak\nend\n');
  });

  it('emits for-in loop', () => {
    const r = makeResult(
      block({
        type: 'AstStatForIn',
        location: LOC,
        varLocalIds: [0, 1],
        values: [{ type: 'AstExprGlobal', location: LOC, name: 'ipairs' }],
        body: block({ type: 'AstStatBreak', location: LOC }),
      }),
      {
        0: {
          id: 0,
          name: 'k',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
        1: {
          id: 1,
          name: 'v',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('for k, v in ipairs do\n\tbreak\nend\n');
  });

  it('emits if / elseif / else', () => {
    const r = makeResult(
      block({
        type: 'AstStatIf',
        location: LOC,
        condition: { type: 'AstExprConstantBool', location: LOC, value: true },
        thenBody: block({ type: 'AstStatReturn', location: LOC, values: [] }),
        elseBody: {
          type: 'AstStatIf',
          location: LOC,
          condition: { type: 'AstExprConstantBool', location: LOC, value: false },
          thenBody: block({ type: 'AstStatReturn', location: LOC, values: [] }),
          elseBody: block({ type: 'AstStatReturn', location: LOC, values: [] }),
        },
      }),
    );
    const out = generate(r);
    expect(out).toContain('if true then');
    expect(out).toContain('elseif false then');
    expect(out).toContain('else');
    expect(out).toContain('end');
  });
});

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

describe('functions', () => {
  it('emits local function', () => {
    const r = makeResult(
      block({
        type: 'AstStatLocalFunction',
        location: LOC,
        nameLocalId: 0,
        func: {
          type: 'AstExprFunction',
          location: LOC,
          selfLocalId: null,
          argLocalIds: [],
          vararg: false,
          functionDepth: 0,
          debugname: '',
          attributes: [],
          body: block({
            type: 'AstStatReturn',
            location: LOC,
            values: [{ type: 'AstExprConstantNumber', location: LOC, value: 1 }],
          }),
        },
      }),
      {
        0: {
          id: 0,
          name: 'foo',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('local function foo()\n\treturn 1\nend\n');
  });

  it('emits function with args', () => {
    const r = makeResult(
      block({
        type: 'AstStatLocalFunction',
        location: LOC,
        nameLocalId: 0,
        func: {
          type: 'AstExprFunction',
          location: LOC,
          selfLocalId: null,
          argLocalIds: [1, 2],
          vararg: true,
          functionDepth: 0,
          debugname: '',
          attributes: [],
          body: block({ type: 'AstStatReturn', location: LOC, values: [] }),
        },
      }),
      {
        0: {
          id: 0,
          name: 'fn',
          location: LOC,
          shadowId: null,
          functionDepth: 0,
          loopDepth: 0,
          hasAnnotation: false,
        },
        1: {
          id: 1,
          name: 'a',
          location: LOC,
          shadowId: null,
          functionDepth: 1,
          loopDepth: 0,
          hasAnnotation: false,
        },
        2: {
          id: 2,
          name: 'b',
          location: LOC,
          shadowId: null,
          functionDepth: 1,
          loopDepth: 0,
          hasAnnotation: false,
        },
      },
    );
    expect(generate(r)).toBe('local function fn(a, b, ...)\n\treturn\nend\n');
  });

  it('emits function call', () => {
    const r = makeResult(
      block({
        type: 'AstStatExpr',
        location: LOC,
        expr: {
          type: 'AstExprCall',
          location: LOC,
          self: false,
          func: { type: 'AstExprGlobal', location: LOC, name: 'print' },
          args: [{ type: 'AstExprConstantString', location: LOC, value: 'hi' }],
        },
      }),
    );
    expect(generate(r)).toBe('print("hi")\n');
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('tables', () => {
  it('emits empty table', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [{ type: 'AstExprTable', location: LOC, items: [] }],
      }),
    );
    expect(generate(r)).toBe('return {}\n');
  });

  it('emits record table', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprTable',
            location: LOC,
            items: [
              {
                kind: 'record',
                key: { type: 'AstExprConstantString', location: LOC, value: 'x' },
                value: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
              },
            ],
          },
        ],
      }),
    );
    const out = generate(r);
    expect(out).toContain('x = 1');
  });

  it('emits list table', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprTable',
            location: LOC,
            items: [
              {
                kind: 'list',
                key: null,
                value: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
              },
              {
                kind: 'list',
                key: null,
                value: { type: 'AstExprConstantNumber', location: LOC, value: 2 },
              },
            ],
          },
        ],
      }),
    );
    const out = generate(r);
    expect(out).toContain('1,');
    expect(out).toContain('2,');
  });
});

// ---------------------------------------------------------------------------
// Luau-specific nodes
// ---------------------------------------------------------------------------

describe('luau-specific', () => {
  it('emits if-else expression', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprIfElse',
            location: LOC,
            hasThen: true,
            condition: { type: 'AstExprConstantBool', location: LOC, value: true },
            trueExpr: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
            falseExpr: { type: 'AstExprConstantNumber', location: LOC, value: 2 },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return if true then 1 else 2\n');
  });

  it('emits interpolated string', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprInterpString',
            location: LOC,
            strings: ['hello ', '!'],
            expressions: [{ type: 'AstExprGlobal', location: LOC, name: 'name' }],
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return `hello {name}!`\n');
  });

  // Regression: escapeInterpString used \u{XX} (Unicode codepoint escape, UTF-8
  // encoded at runtime) for high bytes instead of \xNN (raw byte). This silently
  // changed byte length/string.find() positions for any Latin-1/high-byte source —
  // the same class of bug already fixed in quoteString() for regular strings.
  it('preserves exact byte value for high bytes in interpolated strings', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprInterpString',
            location: LOC,
            strings: ['caf\u00e9 ', ''],
            expressions: [{ type: 'AstExprGlobal', location: LOC, name: 'x' }],
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return `caf\\xe9 {x}`\n');
  });

  it('preserves control bytes in interpolated strings as decimal escapes', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprInterpString',
            location: LOC,
            strings: ['a\u0001b', ''],
            expressions: [{ type: 'AstExprGlobal', location: LOC, name: 'x' }],
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return `a\\1b{x}`\n');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws when result has parse errors', () => {
    const r: ObscuraParseResult = {
      schemaVersion: 1,
      source: '',
      locals: {},
      root: block(),
      errors: [{ location: LOC, message: 'unexpected token' }],
      hotcomments: [],
    };
    expect(() => generate(r)).toThrow('cannot generate from a parse result with errors');
  });

  it('throws on AstStatError node', () => {
    const r = makeResult(
      block({
        type: 'AstStatError',
        location: LOC,
        errorIndex: 0,
      }),
    );
    expect(() => generate(r)).toThrow('AstStatError');
  });
});

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

describe('assignment', () => {
  it('emits simple assignment', () => {
    const r = makeResult(
      block({
        type: 'AstStatAssign',
        location: LOC,
        vars: [{ type: 'AstExprGlobal', location: LOC, name: 'x' }],
        values: [{ type: 'AstExprConstantNumber', location: LOC, value: 5 }],
      }),
    );
    expect(generate(r)).toBe('x = 5\n');
  });

  it('emits compound assignment', () => {
    const r = makeResult(
      block({
        type: 'AstStatCompoundAssign',
        location: LOC,
        op: 'Add',
        var: { type: 'AstExprGlobal', location: LOC, name: 'x' },
        value: { type: 'AstExprConstantNumber', location: LOC, value: 1 },
      }),
    );
    expect(generate(r)).toBe('x += 1\n');
  });
});

// ---------------------------------------------------------------------------
// Index access
// ---------------------------------------------------------------------------

describe('index access', () => {
  it('emits dot access', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprIndexName',
            location: LOC,
            expr: { type: 'AstExprGlobal', location: LOC, name: 'obj' },
            index: 'field',
            op: '.',
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return obj.field\n');
  });

  it('emits bracket access', () => {
    const r = makeResult(
      block({
        type: 'AstStatReturn',
        location: LOC,
        values: [
          {
            type: 'AstExprIndexExpr',
            location: LOC,
            dynamicStringKey: false,
            expr: { type: 'AstExprGlobal', location: LOC, name: 'obj' },
            index: { type: 'AstExprConstantString', location: LOC, value: 'key' },
          },
        ],
      }),
    );
    expect(generate(r)).toBe('return obj["key"]\n');
  });
});
