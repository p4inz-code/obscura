/**
 * RenameTransform — v0.3.0
 *
 * Renames all locals classified as `safe` by the Binder.
 * Returns a new ObscuraParseResult with the locals table patched —
 * the AST tree nodes are unchanged since the generator reads all
 * local names from the locals table, not inline from AST nodes.
 *
 * Transform guarantees:
 *   1. Only renames locals in BinderResult.safeToRename
 *   2. Generated names never collide with: Luau keywords, each other,
 *      or any global name referenced in the script
 *   3. Shadow chains are respected — a renamed local that shadows another
 *      gets a different name than its shadowee (so un-shadowing is not introduced)
 *   4. Output is deterministic for the same input (name assignment is stable)
 *   5. If flags.hasGetfenv is true, no locals are renamed (Binder already marks all unsafe)
 */

import type { ObscuraParseResult } from './ast.js';
import type { BinderResult } from './binder.js';

// ---------------------------------------------------------------------------
// Luau reserved words — generated names must not collide with these
// ---------------------------------------------------------------------------

const LUAU_KEYWORDS = new Set([
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
]);

// ---------------------------------------------------------------------------
// Name generator — base-26, shortest first
// a, b, c, ... z, aa, ab, ... az, ba, ...
// Skips keywords automatically.
// ---------------------------------------------------------------------------

export function* nameSequence(): Generator<string> {
  let n = 0;
  while (true) {
    const name = toBase26(n++);
    if (!LUAU_KEYWORDS.has(name)) yield name;
  }
}

function toBase26(n: number): string {
  let s = '';
  do {
    s = 'abcdefghijklmnopqrstuvwxyz'[n % 26]! + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ---------------------------------------------------------------------------
// Transform options
// ---------------------------------------------------------------------------

export interface RenameTransformOptions {
  /**
   * If true, only rename locals where the generated name is strictly shorter
   * than the original. Default: false (rename all safe locals regardless of
   * name length — maximizes obfuscation, some names may grow slightly).
   */
  onlyShortenNames?: boolean;
}

// ---------------------------------------------------------------------------
// Transform result
// ---------------------------------------------------------------------------

export interface RenameTransformResult {
  result: ObscuraParseResult;
  /** Map of original name -> new name for every renamed local */
  renamedLocals: Map<number, { from: string; to: string }>;
  /** Count of locals that were renamed */
  renamedCount: number;
  /** Count of locals that were skipped (unsafe or skip class) */
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// Core transform
// ---------------------------------------------------------------------------

export function applyRenameTransform(
  parsed: ObscuraParseResult,
  binder: BinderResult,
  options: RenameTransformOptions = {},
): RenameTransformResult {
  const { safeToRename, symbols } = binder;

  // Collect all global names referenced in the script (from AST walk would be ideal,
  // but a conservative approach: collect from the existing local names + Luau builtins)
  // to avoid renaming a local to a name that shadows a global it references.
  // For v0.3.0: use a lightweight set of common Luau globals.
  const reservedNames = buildReservedSet(parsed);

  // Build rename map: localId -> newName
  // Process in ID order (pre-order DFS assignment order) for determinism.
  const renameMap = new Map<number, string>();
  const usedNames = new Set<string>(reservedNames);

  // Add all original names to used set first — this ensures a renamed local
  // never takes the name of an unrenamed local (which could cause conflicts
  // if the unrenamed local is in a parent scope).
  // Exception: we'll remove safe-to-rename names from the used set before
  // assigning, but only if no unsafe local has that name.
  const unsafeNames = new Set<string>();
  for (const [id, entry] of symbols) {
    if (!safeToRename.has(id)) {
      unsafeNames.add(entry.local.name);
    }
  }
  for (const name of unsafeNames) usedNames.add(name);

  const gen = nameSequence();
  const safeIds = [...safeToRename].sort((a, b) => a - b); // deterministic order

  for (const id of safeIds) {
    const entry = symbols.get(id);
    if (!entry) continue;

    // Find next name not already used
    let newName: string;
    do {
      const next = gen.next();
      if (next.done) break;
      newName = next.value;
    } while (usedNames.has(newName));

    // Respect shadow chain: if this local shadows another local,
    // the shadow must not get the same name as the local it shadows.
    const shadowId = entry.local.shadowId;
    if (shadowId !== null) {
      const shadowNewName = renameMap.get(shadowId) ?? symbols.get(shadowId)?.local.name ?? null;
      if (shadowNewName === newName!) {
        // Get one more name
        const next = gen.next();
        if (!next.done) newName = next.value;
      }
    }

    if (options.onlyShortenNames && newName!.length >= entry.local.name.length) {
      continue; // Skip — would not shorten
    }

    renameMap.set(id, newName!);
    usedNames.add(newName!);
  }

  // Build new locals table with renames applied
  const newLocals: ObscuraParseResult['locals'] = {};
  const renamedLocals = new Map<number, { from: string; to: string }>();

  for (const [idStr, local] of Object.entries(parsed.locals)) {
    const id = parseInt(idStr, 10);
    const newName = renameMap.get(id);
    if (newName !== undefined) {
      newLocals[id] = { ...local, name: newName };
      renamedLocals.set(id, { from: local.name, to: newName });
    } else {
      newLocals[id] = local;
    }
  }

  // Return new parse result — shallow clone with patched locals
  const result: ObscuraParseResult = {
    ...parsed,
    locals: newLocals,
  };

  return {
    result,
    renamedLocals,
    renamedCount: renamedLocals.size,
    skippedCount: safeToRename.size - renamedLocals.size + (symbols.size - safeToRename.size),
  };
}

// ---------------------------------------------------------------------------
// Reserved name set
// ---------------------------------------------------------------------------

/**
 * Build the set of names that generated locals must not collide with.
 * Includes: Luau keywords + common globals referenced in most scripts.
 * The Binder's `dynamicStringKey` detection already protects against
 * the most dangerous case (t["localName"] patterns).
 */
function buildReservedSet(parsed: ObscuraParseResult): Set<string> {
  const reserved = new Set<string>(LUAU_KEYWORDS);

  // Collect global names from AST (conservative: walk and collect AstExprGlobal names)
  collectGlobalNames(parsed.root as unknown as AstNode, reserved);

  return reserved;
}

interface AstNode {
  type: string;
  name?: string;
  [key: string]: unknown;
}

function collectGlobalNames(node: AstNode, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'AstExprGlobal' && typeof node.name === 'string') {
    out.add(node.name);
    return;
  }

  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            collectGlobalNames(item as AstNode, out);
          }
        }
      } else if ('type' in val) {
        collectGlobalNames(val as AstNode, out);
      }
    }
  }
}
