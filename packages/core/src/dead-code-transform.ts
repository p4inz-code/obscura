/**
 * DeadCodeTransform — v0.6.0
 *
 * Inserts statically-false `if` blocks containing synthetic statements
 * into AstStatBlock bodies. The condition is always provably false at
 * compile time, so the body never executes — this is verified by
 * construction, not by analysis.
 *
 * Safety guarantees (two independent layers, both required):
 *   1. PROVABLY FALSE CONDITION: conditions are built from closed-form
 *      identities that are false by construction (e.g. `1 == 2`,
 *      `false`, `(3 ~= 3)` wrapped further) — never derived from
 *      anything that could be true under different runtime conditions.
 *   2. INERT BODY: even though the body never executes, it contains only
 *      local variable declarations with constant values — no global
 *      mutation, no function calls (including no `print`), no side
 *      effects of any kind. This is defense in depth: if guarantee (1)
 *      ever had a bug, guarantee (2) ensures nothing observable changes.
 *
 * Insertion points: start of any AstStatBlock body (function bodies,
 * if/while/for/repeat bodies, and the top-level program block).
 *
 * This transform does NOT touch existing statements — it only inserts
 * new ones. Existing AST nodes are structurally unchanged (aside from
 * the containing array gaining new elements), so this transform can
 * run before or after Rename/String/Constant without interaction.
 */

import type {
  ObscuraParseResult,
  ObscuraStat,
  AstStatBlock,
  AstStatIf,
  AstExprBinary,
  ObscuraExpr,
} from './ast.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DeadCodeTransformOptions {
  /**
   * Probability (0-1) that a dead code block is inserted at the start of
   * any given AstStatBlock. Default: 0.3 (30% of blocks get one).
   */
  insertionRate?: number;
  /**
   * Deterministic seed — same seed + same AST produces identical output.
   * Default: 0.
   */
  seed?: number;
  /**
   * Number of synthetic local declarations inside each dead block.
   * Default: random 1-3 per block.
   */
  maxStatementsPerBlock?: number;
}

export interface DeadCodeTransformResult {
  result: ObscuraParseResult;
  insertedBlocks: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG — same as constant-transform.ts (mulberry32)
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

const ZERO_LOC = { begin: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

export function applyDeadCodeTransform(
  parsed: ObscuraParseResult,
  options: DeadCodeTransformOptions = {},
): DeadCodeTransformResult {
  const insertionRate = options.insertionRate ?? 0.3;
  const seed = options.seed ?? 0;
  const maxStmts = options.maxStatementsPerBlock ?? 3;
  const rand = mulberry32(seed);

  // Synthetic local IDs must not collide with real locals — use negative IDs.
  // These never appear in ObscuraParseResult.locals (no declaration needed —
  // dead code locals are scoped entirely within the dead `if` block and never
  // referenced outside it, so they don't need symbol table entries; the
  // generator only needs the locals map for AstExprLocal lookups, and dead
  // code never produces an AstExprLocal — it only declares via AstStatLocal
  // with synthetic ObscuraLocal entries we add to a cloned locals table).
  let syntheticIdCounter = -1;
  const syntheticLocals: ObscuraParseResult['locals'] = {};

  function nextSyntheticId(name: string): number {
    const id = syntheticIdCounter--;
    syntheticLocals[id] = {
      id,
      name,
      location: ZERO_LOC,
      shadowId: null,
      functionDepth: 0,
      loopDepth: 0,
      hasAnnotation: false,
      declarationKind: 'local',
    };
    return id;
  }

  let insertedBlocks = 0;

  function makeFalseCondition(): ObscuraExpr {
    // Rotate through a few closed-form-false identities for variety.
    // All are false by construction — not dependent on any runtime state.
    const variants: AstExprBinary['op'][] = ['CompareEq', 'CompareNe', 'CompareLt'];
    const op = variants[Math.floor(rand() * variants.length)]!;
    switch (op) {
      case 'CompareEq':
        // 1 == 2 — always false
        return {
          type: 'AstExprBinary',
          location: ZERO_LOC,
          op: 'CompareEq',
          left: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 1 },
          right: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 2 },
        };
      case 'CompareNe':
        // 5 ~= 5 — always false
        return {
          type: 'AstExprBinary',
          location: ZERO_LOC,
          op: 'CompareNe',
          left: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 5 },
          right: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 5 },
        };
      case 'CompareLt':
      default:
        // 10 < 1 — always false
        return {
          type: 'AstExprBinary',
          location: ZERO_LOC,
          op: 'CompareLt',
          left: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 10 },
          right: { type: 'AstExprConstantNumber', location: ZERO_LOC, value: 1 },
        };
    }
  }

  function makeInertBody(): AstStatBlock {
    const count = 1 + Math.floor(rand() * maxStmts);
    const body: ObscuraStat[] = [];
    for (let i = 0; i < count; i++) {
      const id = nextSyntheticId(`_dc${Math.floor(rand() * 100000)}`);
      // Constant value only — no calls, no global refs, no side effects.
      const valueChoice = rand();
      const value: ObscuraExpr =
        valueChoice < 0.5
          ? { type: 'AstExprConstantNumber', location: ZERO_LOC, value: Math.floor(rand() * 1000) }
          : {
              type: 'AstExprConstantString',
              location: ZERO_LOC,
              value: `dc${Math.floor(rand() * 1000)}`,
            };
      body.push({
        type: 'AstStatLocal',
        location: ZERO_LOC,
        varLocalIds: [id],
        values: [value],
      });
    }
    return { type: 'AstStatBlock', location: ZERO_LOC, body };
  }

  function makeDeadBlock(): AstStatIf {
    insertedBlocks++;
    return {
      type: 'AstStatIf',
      location: ZERO_LOC,
      condition: makeFalseCondition(),
      thenBody: makeInertBody(),
      elseBody: null,
    };
  }

  function maybeInsert(body: ObscuraStat[]): ObscuraStat[] {
    if (rand() >= insertionRate) return body;
    return [makeDeadBlock(), ...body];
  }

  function transformBlock(block: AstStatBlock): AstStatBlock {
    const transformedBody = block.body.map(transformStat);
    return { ...block, body: maybeInsert(transformedBody) };
  }

  function transformStat(stat: ObscuraStat): ObscuraStat {
    switch (stat.type) {
      case 'AstStatBlock':
        return transformBlock(stat);
      case 'AstStatIf':
        return {
          ...stat,
          thenBody: transformBlock(stat.thenBody),
          elseBody: stat.elseBody ? transformStat(stat.elseBody) : null,
        };
      case 'AstStatWhile':
        return { ...stat, body: transformBlock(stat.body) };
      case 'AstStatRepeat':
        return { ...stat, body: transformBlock(stat.body) };
      case 'AstStatFor':
        return { ...stat, body: transformBlock(stat.body) };
      case 'AstStatForIn':
        return { ...stat, body: transformBlock(stat.body) };
      case 'AstStatLocalFunction':
        return { ...stat, func: { ...stat.func, body: transformBlock(stat.func.body) } };
      case 'AstStatFunction':
        return { ...stat, func: { ...stat.func, body: transformBlock(stat.func.body) } };
      default:
        return stat;
    }
  }

  const newRoot = transformBlock(parsed.root);

  return {
    result: {
      ...parsed,
      root: newRoot,
      locals: { ...parsed.locals, ...syntheticLocals },
    },
    insertedBlocks,
  };
}
