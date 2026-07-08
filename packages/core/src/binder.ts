/**
 * Obscura Binder — v0.2.0
 *
 * Consumes an ObscuraParseResult and produces a BinderResult:
 *   - SymbolTable: every local with rename-safety classification + all reference sites
 *   - Global flags: script-level signals that disable or restrict renaming
 *
 * The Binder does NOT rename anything. It only classifies and collects.
 * RenameTransform (v0.3.0) consumes BinderResult and makes rename decisions.
 *
 * Design constraints:
 *   - Single O(n) tree walk — no re-walking for any classification
 *   - Conservative by default: when in doubt, mark UNSAFE
 *   - No side effects on the input ObscuraParseResult
 */

import type {
  ObscuraParseResult,
  ObscuraLocal,
  ObscuraStat,
  ObscuraExpr,
  AstStatBlock,
} from './ast.js';

// ---------------------------------------------------------------------------
// Rename safety classification
// ---------------------------------------------------------------------------

/**
 * Why a local is unsafe to rename.
 * Multiple reasons can apply; all are stored for diagnostics.
 */
export type UnsafeReason =
  | 'declaration_kind_self' // 'self' params — Luau OOP convention, risky to rename
  | 'dynamic_string_key' // referenced as t["localName"] somewhere in the script
  | 'getfenv_in_scope' // getfenv()/setfenv() present — dynamic env makes renaming unsafe
  | 'dynamic_loadstring_in_scope' // loadstring/load/dofile/loadfile called with a non-constant
  // arg — loaded code may reference locals by name via upvalues
  | 'zero_references'; // declared but never read — still renameable, but skip for safety

export type RenameClass =
  | 'safe' // rename freely
  | 'unsafe' // do not rename
  | 'skip'; // safe to rename but skipped (e.g. never referenced — would change nothing)

export interface Referencesite {
  /** Node location where this local is referenced */
  location: ObscuraParseResult['locals'][number]['location'];
  /** true if this is a write site (assignment target), false if read site */
  write: boolean;
  /** true if this reference is via upvalue (closure capture) */
  upvalue: boolean;
}

export interface SymbolEntry {
  local: ObscuraLocal;
  renameClass: RenameClass;
  unsafeReasons: UnsafeReason[];
  /** Every location in the AST where this local is read or written */
  references: Referencesite[];
  /** Number of read references (excludes declaration site) */
  readCount: number;
  /** Number of write references (assignment targets, not declaration) */
  writeCount: number;
}

export type SymbolTable = Map<number, SymbolEntry>;

// ---------------------------------------------------------------------------
// Script-level global flags
// ---------------------------------------------------------------------------

export interface GlobalFlags {
  /**
   * getfenv() or setfenv() is called anywhere in the script.
   * When true, ALL local renaming is disabled — dynamic environment
   * manipulation makes static rename safety analysis invalid.
   */
  hasGetfenv: boolean;

  /**
   * loadstring() or load() is called with a variable argument (not a constant string).
   * When true, conservatively disable renaming — the loaded code might reference
   * locals by name via upvalues in ways we can't statically analyze.
   * loadstring("local x = 1") (constant) is fine; loadstring(someVar) is not.
   */
  hasDynamicLoadstring: boolean;

  /**
   * The global environment table (_G) is written to anywhere in the script.
   * _G["localName"] = value would observe renames externally.
   * When true, disable renaming of any local whose name matches a string key
   * used in _G writes. (Handled per-local in SymbolEntry, not globally.)
   */
  hasGlobalTableWrite: boolean;
}

// ---------------------------------------------------------------------------
// Binder result
// ---------------------------------------------------------------------------

export interface BinderResult {
  /** One entry per local ID from ObscuraParseResult.locals */
  symbols: SymbolTable;
  /** Script-level signals */
  flags: GlobalFlags;
  /**
   * Set of local IDs that are safe to rename.
   * Derived from symbols — provided as a convenience for RenameTransform.
   * Excludes: unsafe, skip, and any local whose name would conflict with
   * another local in the same scope after renaming (conflict detection is
   * RenameTransform's responsibility, not the Binder's).
   */
  safeToRename: Set<number>;
}

// ---------------------------------------------------------------------------
// Binder implementation
// ---------------------------------------------------------------------------

/**
 * Globals that disable all renaming when called.
 * Conservative list — prefer false negatives (allow rename) over
 * false positives (block rename) for unknown functions.
 */
const RENAME_DISABLING_GLOBALS = new Set(['getfenv', 'setfenv']);

/**
 * Globals that disable renaming when called with a non-constant argument.
 */
const DYNAMIC_LOAD_GLOBALS = new Set(['loadstring', 'load', 'dofile', 'loadfile']);

export function bind(result: ObscuraParseResult): BinderResult {
  const symbols: SymbolTable = new Map();
  const flags: GlobalFlags = {
    hasGetfenv: false,
    hasDynamicLoadstring: false,
    hasGlobalTableWrite: false,
  };

  // Initialize one SymbolEntry per local — conservative defaults
  for (const [idStr, local] of Object.entries(result.locals)) {
    const id = parseInt(idStr, 10);
    const entry: SymbolEntry = {
      local,
      renameClass: 'safe', // tentatively safe — downgraded below
      unsafeReasons: [],
      references: [],
      readCount: 0,
      writeCount: 0,
    };

    // 'self' params are never renamed — OOP convention
    if (local.declarationKind === 'self') {
      entry.renameClass = 'unsafe';
      entry.unsafeReasons.push('declaration_kind_self');
    }

    symbols.set(id, entry);
  }

  // Single tree walk
  walkBlock(result.root, symbols, flags);

  // Post-walk: finalize classifications
  for (const [, entry] of symbols) {
    if (entry.renameClass === 'unsafe') continue; // already classified

    // Global flags can disable renaming
    if (flags.hasGetfenv) {
      entry.renameClass = 'unsafe';
      entry.unsafeReasons.push('getfenv_in_scope');
      continue;
    }

    if (flags.hasDynamicLoadstring) {
      entry.renameClass = 'unsafe';
      entry.unsafeReasons.push('dynamic_loadstring_in_scope');
      continue;
    }

    // Zero references — safe but pointless to rename (no sites to rewrite)
    if (entry.readCount === 0 && entry.writeCount === 0) {
      entry.renameClass = 'skip';
      entry.unsafeReasons.push('zero_references');
    }
  }

  // Build safeToRename set
  const safeToRename = new Set<number>();
  for (const [id, entry] of symbols) {
    if (entry.renameClass === 'safe') {
      safeToRename.add(id);
    }
  }

  return { symbols, flags, safeToRename };
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

function walkBlock(block: AstStatBlock, symbols: SymbolTable, flags: GlobalFlags): void {
  for (const stat of block.body) {
    walkStat(stat, symbols, flags);
  }
}

function walkStat(stat: ObscuraStat, symbols: SymbolTable, flags: GlobalFlags): void {
  switch (stat.type) {
    case 'AstStatBlock':
      walkBlock(stat, symbols, flags);
      break;

    case 'AstStatIf':
      walkExpr(stat.condition, symbols, flags, false);
      walkBlock(stat.thenBody, symbols, flags);
      if (stat.elseBody) walkStat(stat.elseBody, symbols, flags);
      break;

    case 'AstStatWhile':
      walkExpr(stat.condition, symbols, flags, false);
      walkBlock(stat.body, symbols, flags);
      break;

    case 'AstStatRepeat':
      walkBlock(stat.body, symbols, flags);
      walkExpr(stat.condition, symbols, flags, false);
      break;

    case 'AstStatReturn':
      for (const v of stat.values) walkExpr(v, symbols, flags, false);
      break;

    case 'AstStatExpr':
      walkExpr(stat.expr, symbols, flags, false);
      break;

    case 'AstStatLocal':
      // Declaration sites are not reference sites — only walk the value exprs
      for (const v of stat.values) walkExpr(v, symbols, flags, false);
      break;

    case 'AstStatLocalFunction':
      // Name local is a declaration — walk the function body
      walkFunctionBody(stat.func, symbols, flags);
      break;

    case 'AstStatFunction':
      walkExpr(stat.nameExpr, symbols, flags, false);
      walkFunctionBody(stat.func, symbols, flags);
      break;

    case 'AstStatFor':
      // varLocalId is a declaration — walk from/to/step/body
      walkExpr(stat.from, symbols, flags, false);
      walkExpr(stat.to, symbols, flags, false);
      if (stat.step) walkExpr(stat.step, symbols, flags, false);
      walkBlock(stat.body, symbols, flags);
      break;

    case 'AstStatForIn':
      // varLocalIds are declarations — walk values and body
      for (const v of stat.values) walkExpr(v, symbols, flags, false);
      walkBlock(stat.body, symbols, flags);
      break;

    case 'AstStatAssign':
      // vars are write sites, values are read sites
      for (const v of stat.vars) walkExpr(v, symbols, flags, true);
      for (const v of stat.values) walkExpr(v, symbols, flags, false);
      break;

    case 'AstStatCompoundAssign':
      // var is both read and write — count as write site
      walkExpr(stat.var, symbols, flags, true);
      walkExpr(stat.value, symbols, flags, false);
      break;

    // Type-system statements — no locals inside (passthrough nodes)
    case 'AstStatTypeAlias':
    case 'AstStatTypeFunction':
    case 'AstStatDeclareGlobal':
    case 'AstStatDeclareFunction':
    case 'AstStatDeclareExternType':
    case 'AstStatBreak':
    case 'AstStatContinue':
    case 'AstStatError':
      break;

    default: {
      const _exhaustive: never = stat;
      void _exhaustive;
    }
  }
}

function walkFunctionBody(
  func: import('./ast.js').AstExprFunction,
  symbols: SymbolTable,
  flags: GlobalFlags,
): void {
  // selfLocalId and argLocalIds are declarations — not reference sites
  walkBlock(func.body, symbols, flags);
}

function walkExpr(
  expr: ObscuraExpr,
  symbols: SymbolTable,
  flags: GlobalFlags,
  isWriteTarget: boolean,
): void {
  switch (expr.type) {
    // Leaf nodes with no sub-expressions
    case 'AstExprConstantNil':
    case 'AstExprConstantBool':
    case 'AstExprConstantNumber':
    case 'AstExprConstantString':
    case 'AstExprVarargs':
    case 'AstExprError':
      break;

    case 'AstExprLocal': {
      const entry = symbols.get(expr.localId);
      if (entry) {
        entry.references.push({
          location: entry.local.location, // will be refined when AST carries ref locations
          write: isWriteTarget,
          upvalue: expr.upvalue,
        });
        if (isWriteTarget) entry.writeCount++;
        else entry.readCount++;
      }
      break;
    }

    case 'AstExprGlobal': {
      // Check for rename-disabling globals
      if (RENAME_DISABLING_GLOBALS.has(expr.name)) {
        flags.hasGetfenv = true;
      }
      // Check for dynamic loadstring
      if (DYNAMIC_LOAD_GLOBALS.has(expr.name)) {
        // Actual check happens when we see the call — handled in AstExprCall
      }
      // Check for _G write (will be handled at AstExprIndexExpr level)
      break;
    }

    case 'AstExprGroup':
      walkExpr(expr.expr, symbols, flags, isWriteTarget);
      break;

    case 'AstExprCall': {
      // Check for dynamic loadstring(variable) — disables renaming
      if (expr.func.type === 'AstExprGlobal' && DYNAMIC_LOAD_GLOBALS.has(expr.func.name)) {
        // If any arg is not a constant string, flag it
        const hasNonConstantArg = expr.args.some(a => a.type !== 'AstExprConstantString');
        if (hasNonConstantArg) {
          flags.hasDynamicLoadstring = true;
        }
      }

      walkExpr(expr.func, symbols, flags, false);
      for (const arg of expr.args) walkExpr(arg, symbols, flags, false);
      break;
    }

    case 'AstExprIndexName':
      walkExpr(expr.expr, symbols, flags, isWriteTarget);
      // index is a static string field name — not a local reference
      break;

    case 'AstExprIndexExpr': {
      walkExpr(expr.expr, symbols, flags, isWriteTarget);

      // Dynamic string key: t["localName"] — mark the local as unsafe if its
      // name matches this string key. This is where _G["x"] = v is detected.
      if (expr.dynamicStringKey && expr.index.type === 'AstExprConstantString') {
        const keyName = expr.index.value;

        // Check for _G write
        if (isWriteTarget && expr.expr.type === 'AstExprGlobal' && expr.expr.name === '_G') {
          flags.hasGlobalTableWrite = true;
        }

        // Mark any local with this name as unsafe (it might be referenced by string)
        for (const [, entry] of symbols) {
          if (entry.local.name === keyName && !entry.unsafeReasons.includes('dynamic_string_key')) {
            entry.renameClass = 'unsafe';
            entry.unsafeReasons.push('dynamic_string_key');
          }
        }
      }

      walkExpr(expr.index, symbols, flags, false);
      break;
    }

    case 'AstExprUnary':
      walkExpr(expr.expr, symbols, flags, false);
      break;

    case 'AstExprBinary':
      walkExpr(expr.left, symbols, flags, false);
      walkExpr(expr.right, symbols, flags, false);
      break;

    case 'AstExprFunction':
      walkFunctionBody(expr, symbols, flags);
      break;

    case 'AstExprTable':
      for (const item of expr.items) {
        if (item.key) walkExpr(item.key, symbols, flags, false);
        walkExpr(item.value, symbols, flags, false);
      }
      break;

    case 'AstExprIfElse':
      walkExpr(expr.condition, symbols, flags, false);
      walkExpr(expr.trueExpr, symbols, flags, false);
      walkExpr(expr.falseExpr, symbols, flags, false);
      break;

    case 'AstExprInterpString':
      for (const e of expr.expressions) walkExpr(e, symbols, flags, false);
      break;

    case 'AstExprTypeAssertion':
      walkExpr(expr.expr, symbols, flags, isWriteTarget);
      break;

    case 'AstExprInstantiate':
      walkExpr(expr.expr, symbols, flags, false);
      break;

    case 'AstExprRaw':
      // Transform-injected verbatim source — no sub-expressions to walk
      break;

    default: {
      const _exhaustive: never = expr;
      void _exhaustive;
    }
  }
}
