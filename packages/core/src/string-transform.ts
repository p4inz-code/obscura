/**
 * StringTransform — v0.4.0
 *
 * Encodes AstExprConstantString nodes to make string literals harder to read.
 * Returns a new ObscuraParseResult with matching string nodes replaced by
 * AstExprRaw nodes containing encoded Luau source text.
 *
 * Three encoding strategies (configurable, combinable):
 *   'decimal'  — "hello" -> "\104\101\108\108\111"
 *   'hex'      — "hello" -> "\x68\x65\x6c\x6c\x6f"
 *   'split'    — "hello" -> "he" .. "ll" .. "o"  (splits into 2-4 char chunks)
 *
 * Skip conditions (string is left unchanged):
 *   - Empty string ""
 *   - String is a record table key  (t.key = v pattern — key is AstExprConstantString
 *     but used as record field, not a value expression)
 *   - String is a require() path argument (conservative — require breaks on encoded paths)
 *   - String length < minLength option (default: 2 chars)
 *
 * Schema: AstExprRaw is a transform-only node (not in parser output).
 * It is handled by the generator (emits rawSource verbatim) and the binder
 * (no-op — no locals inside raw source).
 */

import type { ObscuraParseResult, ObscuraExpr, ObscuraStat, AstExprRaw } from './ast.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type StringEncoding = 'decimal' | 'hex' | 'split';

export interface StringTransformOptions {
  /**
   * Encoding strategy. Default: 'decimal'.
   * 'decimal': \NNN decimal byte escapes
   * 'hex':     \xNN hex byte escapes
   * 'split':   concat-split into 2-4 char chunks
   */
  encoding?: StringEncoding;

  /**
   * Minimum string byte length to encode. Strings shorter than this
   * are left unchanged. Default: 2.
   */
  minLength?: number;

  /**
   * If true, skip strings that appear to be require() path arguments.
   * Default: true (conservative — encoding breaks require() paths).
   */
  skipRequirePaths?: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface StringTransformResult {
  result: ObscuraParseResult;
  encodedCount: number;
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// Core transform
// ---------------------------------------------------------------------------

export function applyStringTransform(
  parsed: ObscuraParseResult,
  options: StringTransformOptions = {},
): StringTransformResult {
  const encoding = options.encoding ?? 'decimal';
  const minLength = options.minLength ?? 2;
  const skipRequirePaths = options.skipRequirePaths ?? true;

  let encodedCount = 0;
  let skippedCount = 0;

  function encodeString(value: string): string | null {
    // Skip conditions
    if (value.length < minLength) {
      skippedCount++;
      return null;
    }

    switch (encoding) {
      case 'decimal':
        return encodeDecimal(value);
      case 'hex':
        return encodeHex(value);
      case 'split':
        return encodeSplit(value);
    }
  }

  function makeRaw(value: string, location: ObscuraExpr['location']): AstExprRaw | null {
    const encoded = encodeString(value);
    if (encoded === null) return null;
    encodedCount++;
    return { type: 'AstExprRaw', location, rawSource: encoded };
  }

  // Deep-clone the AST, replacing AstExprConstantString nodes
  const newRoot = transformBlock(parsed.root, makeRaw, skipRequirePaths, parsed.locals);

  return {
    result: { ...parsed, root: newRoot },
    encodedCount,
    skippedCount,
  };
}

// ---------------------------------------------------------------------------
// Encoding implementations
// ---------------------------------------------------------------------------

function encodeDecimal(value: string): string {
  // Encode each byte as \NNN decimal escape
  // Use JS charCodeAt which gives Unicode codepoints — for ASCII/Latin-1 these
  // match byte values directly. For multi-byte UTF-8 chars, encode each byte.
  const bytes = stringToBytes(value);
  return '"' + bytes.map(b => `\\${b}`).join('') + '"';
}

function encodeHex(value: string): string {
  const bytes = stringToBytes(value);
  return '"' + bytes.map(b => `\\x${b.toString(16).padStart(2, '0')}`).join('') + '"';
}

function encodeSplit(value: string): string {
  if (value.length < 4) {
    // Too short to split meaningfully — fall back to hex
    return encodeHex(value);
  }
  // Split into chunks of 2-4 chars
  const chunks: string[] = [];
  let i = 0;
  while (i < value.length) {
    // Vary chunk size: 2, 3, 4 in rotation for less predictable pattern
    const size = [2, 3, 4][chunks.length % 3]!;
    chunks.push(quoteChunk(value.slice(i, i + size)));
    i += size;
  }
  // MUST wrap in parens: `#("a" .. "b")` vs `#"a" .. "b"` are different expressions.
  // Parens ensure the concat result is treated as an atom in all expression contexts.
  return '(' + chunks.join(' .. ') + ')';
}

function quoteChunk(s: string): string {
  // Simple double-quote with minimal escaping for split chunks
  const bytes = stringToBytes(s);
  let out = '"';
  for (const b of bytes) {
    if (b === 34)
      out += '\\"'; // "
    else if (b === 92)
      out += '\\\\'; // \
    else if (b === 10)
      out += '\\n'; // \n
    else if (b === 13)
      out += '\\r'; // \r
    else if (b < 32 || b > 126) out += `\\x${b.toString(16).padStart(2, '0')}`;
    else out += String.fromCharCode(b);
  }
  out += '"';
  return out;
}

/**
 * Convert a JS string to its byte representation.
 * Chars <= 0xFF are taken as their code point value (preserves Latin-1).
 * Chars > 0xFF are encoded as their UTF-8 byte sequence.
 */
function stringToBytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0xff) {
      bytes.push(c);
    } else {
      // UTF-8 encode the codepoint
      if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6));
        bytes.push(0x80 | (c & 0x3f));
      } else {
        bytes.push(0xe0 | (c >> 12));
        bytes.push(0x80 | ((c >> 6) & 0x3f));
        bytes.push(0x80 | (c & 0x3f));
      }
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// AST walker — deep clone with string node replacement
// ---------------------------------------------------------------------------

type MakeRaw = (value: string, location: ObscuraExpr['location']) => AstExprRaw | null;

function transformBlock(
  block: ObscuraParseResult['root'],
  makeRaw: MakeRaw,
  skipRequirePaths: boolean,
  locals: ObscuraParseResult['locals'],
): ObscuraParseResult['root'] {
  return {
    ...block,
    body: block.body.map(s => transformStat(s, makeRaw, skipRequirePaths, locals)),
  };
}

function transformStat(
  stat: ObscuraStat,
  makeRaw: MakeRaw,
  skipRequirePaths: boolean,
  locals: ObscuraParseResult['locals'],
): ObscuraStat {
  switch (stat.type) {
    case 'AstStatBlock':
      return {
        ...stat,
        body: stat.body.map(s => transformStat(s, makeRaw, skipRequirePaths, locals)),
      };
    case 'AstStatIf':
      return {
        ...stat,
        condition: transformExpr(stat.condition, makeRaw, skipRequirePaths, false, locals),
        thenBody: transformBlock(stat.thenBody, makeRaw, skipRequirePaths, locals),
        elseBody: stat.elseBody
          ? transformStat(stat.elseBody, makeRaw, skipRequirePaths, locals)
          : null,
      };
    case 'AstStatWhile':
      return {
        ...stat,
        condition: transformExpr(stat.condition, makeRaw, skipRequirePaths, false, locals),
        body: transformBlock(stat.body, makeRaw, skipRequirePaths, locals),
      };
    case 'AstStatRepeat':
      return {
        ...stat,
        body: transformBlock(stat.body, makeRaw, skipRequirePaths, locals),
        condition: transformExpr(stat.condition, makeRaw, skipRequirePaths, false, locals),
      };
    case 'AstStatReturn':
      return {
        ...stat,
        values: stat.values.map(v => transformExpr(v, makeRaw, skipRequirePaths, false, locals)),
      };
    case 'AstStatExpr':
      return { ...stat, expr: transformExpr(stat.expr, makeRaw, skipRequirePaths, false, locals) };
    case 'AstStatLocal':
      return {
        ...stat,
        values: stat.values.map(v => transformExpr(v, makeRaw, skipRequirePaths, false, locals)),
      };
    case 'AstStatLocalFunction':
      return { ...stat, func: transformFunction(stat.func, makeRaw, skipRequirePaths, locals) };
    case 'AstStatFunction':
      return {
        ...stat,
        nameExpr: transformExpr(stat.nameExpr, makeRaw, skipRequirePaths, false, locals),
        func: transformFunction(stat.func, makeRaw, skipRequirePaths, locals),
      };
    case 'AstStatFor':
      return {
        ...stat,
        from: transformExpr(stat.from, makeRaw, skipRequirePaths, false, locals),
        to: transformExpr(stat.to, makeRaw, skipRequirePaths, false, locals),
        step: stat.step ? transformExpr(stat.step, makeRaw, skipRequirePaths, false, locals) : null,
        body: transformBlock(stat.body, makeRaw, skipRequirePaths, locals),
      };
    case 'AstStatForIn':
      return {
        ...stat,
        values: stat.values.map(v => transformExpr(v, makeRaw, skipRequirePaths, false, locals)),
        body: transformBlock(stat.body, makeRaw, skipRequirePaths, locals),
      };
    case 'AstStatAssign':
      return {
        ...stat,
        vars: stat.vars.map(v => transformExpr(v, makeRaw, skipRequirePaths, false, locals)),
        values: stat.values.map(v => transformExpr(v, makeRaw, skipRequirePaths, false, locals)),
      };
    case 'AstStatCompoundAssign':
      return {
        ...stat,
        var: transformExpr(stat.var, makeRaw, skipRequirePaths, false, locals),
        value: transformExpr(stat.value, makeRaw, skipRequirePaths, false, locals),
      };
    // Passthrough — no sub-expressions to transform
    default:
      return stat;
  }
}

function transformFunction(
  func: import('./ast.js').AstExprFunction,
  makeRaw: MakeRaw,
  skipRequirePaths: boolean,
  locals: ObscuraParseResult['locals'],
): import('./ast.js').AstExprFunction {
  return { ...func, body: transformBlock(func.body, makeRaw, skipRequirePaths, locals) };
}

/**
 * True only if `func` unambiguously resolves to the `require` builtin:
 *   - a bare global reference named `require`, or
 *   - a local whose *declared name* is `require` (e.g. `local require = require`)
 *
 * Regression note: this previously matched ANY AstExprLocal regardless of name,
 * meaning the first string argument of every call made through a local function
 * reference (event handlers, callbacks, aliased helpers, etc.) was silently
 * skipped from string encoding. That's a huge, unintended carve-out — fixed by
 * resolving the local's actual name via the locals table.
 */
function isRequireCall(func: ObscuraExpr, locals: ObscuraParseResult['locals']): boolean {
  if (func.type === 'AstExprGlobal') return func.name === 'require';
  if (func.type === 'AstExprLocal') return locals[func.localId]?.name === 'require';
  return false;
}

function transformExpr(
  expr: ObscuraExpr,
  makeRaw: MakeRaw,
  skipRequirePaths: boolean,
  isRequireArg: boolean,
  locals: ObscuraParseResult['locals'],
): ObscuraExpr {
  switch (expr.type) {
    case 'AstExprConstantString': {
      // Skip require() path arguments — encoding breaks module loading
      if (isRequireArg && skipRequirePaths) return expr;
      const raw = makeRaw(expr.value, expr.location);
      return raw ?? expr;
    }

    case 'AstExprCall': {
      // Detect require(string) — mark first arg as require path
      const isRequire = isRequireCall(expr.func, locals);
      return {
        ...expr,
        func: transformExpr(expr.func, makeRaw, skipRequirePaths, false, locals),
        args: expr.args.map((arg, i) =>
          transformExpr(arg, makeRaw, skipRequirePaths, isRequire && i === 0, locals),
        ),
      };
    }

    case 'AstExprTable': {
      return {
        ...expr,
        items: expr.items.map(item => ({
          ...item,
          // Record keys (t.key = v) — skip encoding, they must be exact identifiers
          key:
            item.key && item.kind !== 'record'
              ? transformExpr(item.key, makeRaw, skipRequirePaths, false, locals)
              : item.key,
          value: transformExpr(item.value, makeRaw, skipRequirePaths, false, locals),
        })),
      };
    }

    case 'AstExprIndexExpr':
      return {
        ...expr,
        expr: transformExpr(expr.expr, makeRaw, skipRequirePaths, false, locals),
        // String key in t["key"] — encode it (this is a value context, not a require path)
        index: transformExpr(expr.index, makeRaw, skipRequirePaths, false, locals),
      };

    case 'AstExprGroup':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw, skipRequirePaths, false, locals) };
    case 'AstExprUnary':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw, skipRequirePaths, false, locals) };
    case 'AstExprBinary':
      return {
        ...expr,
        left: transformExpr(expr.left, makeRaw, skipRequirePaths, false, locals),
        right: transformExpr(expr.right, makeRaw, skipRequirePaths, false, locals),
      };
    case 'AstExprIndexName':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw, skipRequirePaths, false, locals) };
    case 'AstExprIfElse':
      return {
        ...expr,
        condition: transformExpr(expr.condition, makeRaw, skipRequirePaths, false, locals),
        trueExpr: transformExpr(expr.trueExpr, makeRaw, skipRequirePaths, false, locals),
        falseExpr: transformExpr(expr.falseExpr, makeRaw, skipRequirePaths, false, locals),
      };
    case 'AstExprInterpString':
      return {
        ...expr,
        expressions: expr.expressions.map(e =>
          transformExpr(e, makeRaw, skipRequirePaths, false, locals),
        ),
      };
    case 'AstExprTypeAssertion':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw, skipRequirePaths, false, locals) };
    case 'AstExprInstantiate':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw, skipRequirePaths, false, locals) };
    case 'AstExprFunction':
      return transformFunction(expr, makeRaw, skipRequirePaths, locals);

    // Leaf nodes and passthrough
    default:
      return expr;
  }
}
