/**
 * NoOpWrapTransform — example plugin
 *
 * Demonstrates the Plugin API (v0.7.0) from a third-party perspective:
 * this file imports ONLY from the public index (`../src/index.js`),
 * never reaches into internal modules, and implements `Transform`
 * directly rather than wrapping an existing internal function.
 *
 * What it does: wraps remaining numeric literals (anything ConstantTransform
 * left untouched — 0, 1, or anything if ConstantTransform wasn't run) in a
 * no-op arithmetic identity `(x + 0)`. Purely cosmetic noise — adds a small
 * amount of additional obfuscation surface on top of whatever ran before it.
 *
 * Why this is a genuine dependsOn use case (the first one in the codebase):
 * if NoOpWrapTransform ran BEFORE ConstantTransform, ConstantTransform would
 * then try to obfuscate numbers that are now wrapped in `(x + 0)` expressions
 * rather than plain AstExprConstantNumber nodes — not wrong, but pointless
 * double-work and against the spirit of "apply the strongest transform once."
 * Declaring `dependsOn: ['constant']` lets the pipeline runner enforce the
 * sane order and fail loudly if a caller gets it backwards.
 */

import type {
  Transform, TransformContext, TransformOutput,
  ObscuraParseResult, ObscuraStat, ObscuraExpr, AstStatBlock,
} from '../src/index.js';

export interface NoOpWrapOptions {
  /** Skip wrapping 0 and 1 — same conservative default as ConstantTransform. */
  skipTrivial?: boolean;
}

export interface NoOpWrapStats extends Record<string, unknown> {
  wrappedCount: number;
}

const ZERO_LOC = { begin: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

export const NoOpWrapTransform: Transform<NoOpWrapOptions, NoOpWrapStats> = {
  name: 'noop-wrap',
  description: 'Wraps remaining numeric literals in a no-op (x + 0) arithmetic identity.',
  dependsOn: ['constant'],

  apply(ctx: TransformContext, options: NoOpWrapOptions = {}): TransformOutput<NoOpWrapStats> {
    const skipTrivial = options.skipTrivial ?? true;
    let wrappedCount = 0;

    function wrapNum(expr: ObscuraExpr): ObscuraExpr {
      if (expr.type !== 'AstExprConstantNumber') return expr;
      if (skipTrivial && (expr.value === 0 || expr.value === 1)) return expr;
      wrappedCount++;
      const binary: ObscuraExpr = {
        type: 'AstExprBinary', location: expr.location, op: 'Add',
        left: expr,
        right: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 0 },
      };
      return { type: 'AstExprGroup', location: expr.location, expr: binary };
    }

    function transformExpr(expr: ObscuraExpr): ObscuraExpr {
      const wrapped = wrapNum(expr);
      if (wrapped !== expr) return wrapped;

      switch (expr.type) {
        case 'AstExprGroup':
          return { ...expr, expr: transformExpr(expr.expr) };
        case 'AstExprCall':
          return {
            ...expr,
            func: transformExpr(expr.func),
            args: expr.args.map(transformExpr),
          };
        case 'AstExprBinary':
          return { ...expr, left: transformExpr(expr.left), right: transformExpr(expr.right) };
        case 'AstExprUnary':
          return { ...expr, expr: transformExpr(expr.expr) };
        case 'AstExprTable':
          return {
            ...expr,
            items: expr.items.map(item => ({
              ...item,
              value: transformExpr(item.value),
            })),
          };
        case 'AstExprFunction':
          return { ...expr, body: transformBlock(expr.body) };
        default:
          return expr;
      }
    }

    function transformStat(stat: ObscuraStat): ObscuraStat {
      switch (stat.type) {
        case 'AstStatBlock':
          return transformBlock(stat);
        case 'AstStatIf':
          return {
            ...stat,
            condition: transformExpr(stat.condition),
            thenBody: transformBlock(stat.thenBody),
            elseBody: stat.elseBody ? transformStat(stat.elseBody) : null,
          };
        case 'AstStatWhile':
          return { ...stat, condition: transformExpr(stat.condition), body: transformBlock(stat.body) };
        case 'AstStatReturn':
          return { ...stat, values: stat.values.map(transformExpr) };
        case 'AstStatExpr':
          return { ...stat, expr: transformExpr(stat.expr) };
        case 'AstStatLocal':
          return { ...stat, values: stat.values.map(transformExpr) };
        case 'AstStatLocalFunction':
          return { ...stat, func: { ...stat.func, body: transformBlock(stat.func.body) } };
        default:
          return stat;
      }
    }

    function transformBlock(block: AstStatBlock): AstStatBlock {
      return { ...block, body: block.body.map(transformStat) };
    }

    const newRoot = transformBlock(ctx.parsed.root);
    const result: ObscuraParseResult = { ...ctx.parsed, root: newRoot };

    return { result, stats: { wrappedCount } };
  },
};
