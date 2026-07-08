/**
 * ConstantTransform — v0.5.0
 *
 * Obfuscates AstExprConstantNumber and AstExprConstantBool nodes using
 * equivalent expressions that evaluate to the same value at runtime.
 * Returns a new ObscuraParseResult with matching nodes replaced by
 * AstExprRaw nodes (same mechanism as StringTransform).
 *
 * Number strategies:
 *   'arithmetic' — 42 -> (39 + 3)   (random split via +/-)
 *   'bitwise'    — 42 -> (42 ~ 0)   (XOR with 0; integers only)
 *   'mixed'      — randomly alternates between arithmetic and bitwise
 *
 * Boolean strategies:
 *   true  -> (1 == 1) | (not false) | (not not true)
 *   false -> (1 == 0) | (not true)  | (not not false)
 *
 * Skip conditions:
 *   - 0 and 1 (too common; obfuscating adds noise with little value, and
 *     0/1 frequently appear in contexts — array indices, loop bounds —
 *     where the conservative choice is to leave them untouched)
 *   - Non-finite numbers (NaN, Infinity) — arithmetic identities don't
 *     reliably preserve these; left untouched
 *   - Floats — bitwise strategy is integer-only; arithmetic split on floats
 *     risks introducing floating-point rounding drift, so floats always
 *     skip the 'bitwise' strategy and use 'arithmetic' with care (see below)
 *   - nil is never obfuscated — (nil or nil) is valid but conspicuous and
 *     provides no real obfuscation value
 */

import type { ObscuraParseResult, ObscuraExpr, ObscuraStat, AstExprRaw } from './ast.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type NumberEncoding = 'arithmetic' | 'bitwise' | 'mixed';

export interface ConstantTransformOptions {
  /** Number obfuscation strategy. Default: 'mixed'. */
  numberEncoding?: NumberEncoding;
  /** Obfuscate boolean literals. Default: true. */
  encodeBooleans?: boolean;
  /**
   * Seed for the pseudo-random split point / strategy selection.
   * Same seed + same input AST produces identical output (determinism
   * requirement per ARCHITECTURE.md Regression Test Policy).
   * Default: 0.
   */
  seed?: number;
}

export interface ConstantTransformResult {
  result: ObscuraParseResult;
  encodedNumbers: number;
  encodedBooleans: number;
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed always produces same sequence
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Core transform
// ---------------------------------------------------------------------------

export function applyConstantTransform(
  parsed: ObscuraParseResult,
  options: ConstantTransformOptions = {},
): ConstantTransformResult {
  const numberEncoding = options.numberEncoding ?? 'mixed';
  const encodeBooleans = options.encodeBooleans ?? true;
  const rand = mulberry32(options.seed ?? 0);

  let encodedNumbers = 0;
  let encodedBooleans = 0;
  let skippedCount = 0;

  function encodeNumber(value: number, location: ObscuraExpr['location']): AstExprRaw | null {
    // Skip conditions
    if (!Number.isFinite(value)) {
      skippedCount++;
      return null;
    }
    if (value === 0 || value === 1) {
      skippedCount++;
      return null;
    }

    const isInt = Number.isInteger(value);
    let strategy = numberEncoding;
    if (strategy === 'mixed') {
      strategy = rand() < 0.5 ? 'arithmetic' : 'bitwise';
    }
    // Bitwise only valid for integers within safe 32-bit-ish range used by Luau's
    // bitwise ops (operates on the integer representation of the number).
    if (strategy === 'bitwise' && (!isInt || Math.abs(value) > 0x7fffffff)) {
      strategy = 'arithmetic';
    }

    encodedNumbers++;

    if (strategy === 'bitwise') {
      return { type: 'AstExprRaw', location, rawSource: encodeBitwise(value) };
    }
    return { type: 'AstExprRaw', location, rawSource: encodeArithmetic(value, isInt, rand) };
  }

  function encodeBool(value: boolean, location: ObscuraExpr['location']): AstExprRaw {
    encodedBooleans++;
    const variants = value
      ? ['(1 == 1)', '(not false)', '(not not true)']
      : ['(1 == 0)', '(not true)', '(not not false)'];
    const choice = variants[Math.floor(rand() * variants.length)]!;
    return { type: 'AstExprRaw', location, rawSource: choice };
  }

  function makeRaw(expr: ObscuraExpr): AstExprRaw | null {
    if (expr.type === 'AstExprConstantNumber') {
      return encodeNumber(expr.value, expr.location);
    }
    if (expr.type === 'AstExprConstantBool' && encodeBooleans) {
      return encodeBool(expr.value, expr.location);
    }
    return null;
  }

  const newRoot = transformBlock(parsed.root, makeRaw);

  return {
    result: { ...parsed, root: newRoot },
    encodedNumbers,
    encodedBooleans,
    skippedCount,
  };
}

// ---------------------------------------------------------------------------
// Number encoding strategies
// ---------------------------------------------------------------------------

function encodeBitwise(value: number): string {
  // Luau has no infix bitwise operators — XOR is bit32.bxor(a, b).
  // (value `xor` mask) `xor` mask == value, always, for 32-bit XOR.
  const mask = 0x5a5a5a5a;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}bit32.bxor(bit32.bxor(${abs}, ${mask}), ${mask})`;
}

function encodeArithmetic(value: number, isInt: boolean, rand: () => number): string {
  if (isInt) {
    // Split via addition or subtraction with an integer offset.
    const offset = Math.floor(rand() * 1000) + 1;
    if (rand() < 0.5) {
      return `(${value - offset} + ${offset})`;
    }
    return `(${value + offset} - ${offset})`;
  }
  // Floats: use multiplication by 1 split as (value/k)*k to avoid introducing
  // precision drift from large additive offsets. k is a small safe divisor.
  // This is conservative — division/multiplication by the same exact float
  // factor round-trips exactly in IEEE 754 double for the common k values we use.
  const k = [2, 4, 5, 10][Math.floor(rand() * 4)]!;
  return `((${value} * ${k}) / ${k})`;
}

// ---------------------------------------------------------------------------
// AST walker — deep clone with constant node replacement
// (structurally identical to string-transform.ts walker — operates over the
//  same node shapes, different leaf predicate)
// ---------------------------------------------------------------------------

type MakeRaw = (expr: ObscuraExpr) => AstExprRaw | null;

function transformBlock(
  block: ObscuraParseResult['root'],
  makeRaw: MakeRaw,
): ObscuraParseResult['root'] {
  return { ...block, body: block.body.map(s => transformStat(s, makeRaw)) };
}

function transformStat(stat: ObscuraStat, makeRaw: MakeRaw): ObscuraStat {
  switch (stat.type) {
    case 'AstStatBlock':
      return { ...stat, body: stat.body.map(s => transformStat(s, makeRaw)) };
    case 'AstStatIf':
      return {
        ...stat,
        condition: transformExpr(stat.condition, makeRaw),
        thenBody: transformBlock(stat.thenBody, makeRaw),
        elseBody: stat.elseBody ? transformStat(stat.elseBody, makeRaw) : null,
      };
    case 'AstStatWhile':
      return {
        ...stat,
        condition: transformExpr(stat.condition, makeRaw),
        body: transformBlock(stat.body, makeRaw),
      };
    case 'AstStatRepeat':
      return {
        ...stat,
        body: transformBlock(stat.body, makeRaw),
        condition: transformExpr(stat.condition, makeRaw),
      };
    case 'AstStatReturn':
      return { ...stat, values: stat.values.map(v => transformExpr(v, makeRaw)) };
    case 'AstStatExpr':
      return { ...stat, expr: transformExpr(stat.expr, makeRaw) };
    case 'AstStatLocal':
      return { ...stat, values: stat.values.map(v => transformExpr(v, makeRaw)) };
    case 'AstStatLocalFunction':
      return { ...stat, func: transformFunction(stat.func, makeRaw) };
    case 'AstStatFunction':
      return {
        ...stat,
        nameExpr: transformExpr(stat.nameExpr, makeRaw),
        func: transformFunction(stat.func, makeRaw),
      };
    case 'AstStatFor':
      // Conservative: leave for-loop bounds untouched. Obfuscating loop
      // bounds risks off-by-one errors if a future strategy introduces
      // rounding; not worth the risk for marginal obfuscation value.
      return { ...stat, body: transformBlock(stat.body, makeRaw) };
    case 'AstStatForIn':
      return {
        ...stat,
        values: stat.values.map(v => transformExpr(v, makeRaw)),
        body: transformBlock(stat.body, makeRaw),
      };
    case 'AstStatAssign':
      return {
        ...stat,
        vars: stat.vars.map(v => transformExpr(v, makeRaw)),
        values: stat.values.map(v => transformExpr(v, makeRaw)),
      };
    case 'AstStatCompoundAssign':
      return {
        ...stat,
        var: transformExpr(stat.var, makeRaw),
        value: transformExpr(stat.value, makeRaw),
      };
    default:
      return stat;
  }
}

function transformFunction(
  func: import('./ast.js').AstExprFunction,
  makeRaw: MakeRaw,
): import('./ast.js').AstExprFunction {
  return { ...func, body: transformBlock(func.body, makeRaw) };
}

function transformExpr(expr: ObscuraExpr, makeRaw: MakeRaw): ObscuraExpr {
  // Try replacing this node first
  const replaced = makeRaw(expr);
  if (replaced) return replaced;

  // Otherwise recurse into children
  switch (expr.type) {
    case 'AstExprGroup':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw) };
    case 'AstExprCall':
      return {
        ...expr,
        func: transformExpr(expr.func, makeRaw),
        args: expr.args.map(a => transformExpr(a, makeRaw)),
      };
    case 'AstExprTable':
      return {
        ...expr,
        items: expr.items.map(item => ({
          ...item,
          key: item.key && item.kind !== 'record' ? transformExpr(item.key, makeRaw) : item.key,
          value: transformExpr(item.value, makeRaw),
        })),
      };
    case 'AstExprIndexExpr':
      return {
        ...expr,
        expr: transformExpr(expr.expr, makeRaw),
        index: transformExpr(expr.index, makeRaw),
      };
    case 'AstExprIndexName':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw) };
    case 'AstExprUnary':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw) };
    case 'AstExprBinary':
      return {
        ...expr,
        left: transformExpr(expr.left, makeRaw),
        right: transformExpr(expr.right, makeRaw),
      };
    case 'AstExprIfElse':
      return {
        ...expr,
        condition: transformExpr(expr.condition, makeRaw),
        trueExpr: transformExpr(expr.trueExpr, makeRaw),
        falseExpr: transformExpr(expr.falseExpr, makeRaw),
      };
    case 'AstExprInterpString':
      return { ...expr, expressions: expr.expressions.map(e => transformExpr(e, makeRaw)) };
    case 'AstExprTypeAssertion':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw) };
    case 'AstExprInstantiate':
      return { ...expr, expr: transformExpr(expr.expr, makeRaw) };
    case 'AstExprFunction':
      return transformFunction(expr, makeRaw);
    default:
      return expr;
  }
}
