/**
 * Obscura Code Generator
 *
 * Converts ObscuraParseResult back to valid Luau source text.
 * Design constraints (from ARCHITECTURE.md):
 *   - Correctness over formatting fidelity
 *   - No CST dependency
 *   - Comments and whitespace are NOT preserved
 *   - AstType subtree is emitted via source-span passthrough
 *   - Output must be behaviorally identical to input when zero transforms are applied
 */

import type {
  ObscuraParseResult,
  ObscuraLocal,
  ObscuraStat,
  ObscuraExpr,
  ObscuraTableItem,
  AstStatBlock,
  AstStatIf,
  AstExprFunction,
  BinaryOp,
  UnaryOp,
} from './ast.js';

// ---------------------------------------------------------------------------
// Operator tables — derived from Luau Parser.cpp binaryPriority[]
// Op enum order: Add Sub Mul Div FloorDiv Mod Pow Concat
//               CompareNe CompareEq CompareLt CompareLe CompareGt CompareGe
//               And Or
// ---------------------------------------------------------------------------

const BINARY_OP_STR: Record<BinaryOp, string> = {
  Add: '+',
  Sub: '-',
  Mul: '*',
  Div: '/',
  FloorDiv: '//',
  Mod: '%',
  Pow: '^',
  Concat: '..',
  CompareNe: '~=',
  CompareEq: '==',
  CompareLt: '<',
  CompareLe: '<=',
  CompareGt: '>',
  CompareGe: '>=',
  And: 'and',
  Or: 'or',
};

// {left, right} precedence from Parser.cpp binaryPriority[]
const BINARY_PRIORITY: Record<BinaryOp, [number, number]> = {
  Add: [6, 6],
  Sub: [6, 6],
  Mul: [7, 7],
  Div: [7, 7],
  FloorDiv: [7, 7],
  Mod: [7, 7],
  Pow: [10, 9], // right-associative
  Concat: [5, 4], // right-associative
  CompareNe: [3, 3],
  CompareEq: [3, 3],
  CompareLt: [3, 3],
  CompareLe: [3, 3],
  CompareGt: [3, 3],
  CompareGe: [3, 3],
  And: [2, 2],
  Or: [1, 1],
};

const UNARY_PRIORITY = 8;

const UNARY_OP_STR: Record<UnaryOp, string> = {
  Not: 'not ',
  Minus: '-',
  Len: '#',
};

// Luau reserved words — cannot be used as identifiers
const KEYWORDS = new Set([
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
// Generator class
// ---------------------------------------------------------------------------

export class Generator {
  private out: string[] = [];
  private indent = 0;
  private locals: Record<number, ObscuraLocal>;
  private source: string; // original source for passthrough spans

  constructor(result: ObscuraParseResult) {
    this.locals = result.locals;
    this.source = result.source;
  }

  generate(block: AstStatBlock): string {
    this.emitBlock(block, false);
    return this.out.join('');
  }

  // ---------------------------------------------------------------------------
  // Output primitives
  // ---------------------------------------------------------------------------

  private emit(s: string): void {
    this.out.push(s);
  }

  private emitIndent(): void {
    this.out.push('\t'.repeat(this.indent));
  }

  private emitLine(s: string): void {
    this.emitIndent();
    this.out.push(s);
    this.out.push('\n');
  }

  private localName(id: number): string {
    const loc = this.locals[id];
    if (loc === undefined) throw new Error(`Generator: unknown localId ${id}`);
    return loc.name;
  }

  // ---------------------------------------------------------------------------
  // Source passthrough (for type annotations, AstExprInstantiate, etc.)
  // ---------------------------------------------------------------------------

  private sourceSpan(node: {
    location: { begin: { line: number; column: number }; end: { line: number; column: number } };
  }): string {
    // Reconstruct source slice from original source using line/column positions.
    // Used for type-annotation passthrough (AstType* nodes) in v0.1.0.
    const lines = this.source.split('\n');
    const { begin, end } = node.location;

    if (begin.line === end.line) {
      const line = lines[begin.line] ?? '';
      return line.slice(begin.column, end.column);
    }

    const parts: string[] = [];
    for (let l = begin.line; l <= end.line; l++) {
      const line = lines[l] ?? '';
      if (l === begin.line) parts.push(line.slice(begin.column));
      else if (l === end.line) parts.push(line.slice(0, end.column));
      else parts.push(line);
    }
    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------------

  private emitBlock(block: AstStatBlock, withIndent: boolean): void {
    if (withIndent) this.indent++;
    for (const stat of block.body) {
      this.emitStat(stat);
    }
    if (withIndent) this.indent--;
  }

  private emitStat(stat: ObscuraStat): void {
    switch (stat.type) {
      case 'AstStatBlock': {
        this.emitLine('do');
        this.emitBlock(stat, true);
        this.emitLine('end');
        break;
      }

      case 'AstStatIf': {
        this.emitStatIf(stat);
        break;
      }

      case 'AstStatWhile': {
        this.emitIndent();
        this.emit('while ');
        this.emitExpr(stat.condition, 0);
        this.emit(' do\n');
        this.emitBlock(stat.body, true);
        this.emitLine('end');
        break;
      }

      case 'AstStatRepeat': {
        this.emitLine('repeat');
        this.emitBlock(stat.body, true);
        this.emitIndent();
        this.emit('until ');
        this.emitExpr(stat.condition, 0);
        this.emit('\n');
        break;
      }

      case 'AstStatBreak': {
        this.emitLine('break');
        break;
      }

      case 'AstStatContinue': {
        this.emitLine('continue');
        break;
      }

      case 'AstStatReturn': {
        this.emitIndent();
        this.emit('return');
        if (stat.values.length > 0) {
          this.emit(' ');
          this.emitExprList(stat.values);
        }
        this.emit('\n');
        break;
      }

      case 'AstStatExpr': {
        this.emitIndent();
        this.emitExpr(stat.expr, 0);
        this.emit('\n');
        break;
      }

      case 'AstStatLocal': {
        this.emitIndent();
        this.emit('local ');
        this.emit(stat.varLocalIds.map(id => this.localName(id)).join(', '));
        if (stat.values.length > 0) {
          this.emit(' = ');
          this.emitExprList(stat.values);
        }
        this.emit('\n');
        break;
      }

      case 'AstStatLocalFunction': {
        this.emitIndent();
        this.emit('local function ');
        this.emit(this.localName(stat.nameLocalId));
        this.emitFunctionBody(stat.func);
        this.emit('\n');
        break;
      }

      case 'AstStatFunction': {
        this.emitIndent();
        this.emit('function ');
        this.emitExpr(stat.nameExpr, 0);
        this.emitFunctionBody(stat.func);
        this.emit('\n');
        break;
      }

      case 'AstStatFor': {
        this.emitIndent();
        this.emit('for ');
        this.emit(this.localName(stat.varLocalId));
        this.emit(' = ');
        this.emitExpr(stat.from, 0);
        this.emit(', ');
        this.emitExpr(stat.to, 0);
        if (stat.step !== null) {
          this.emit(', ');
          this.emitExpr(stat.step, 0);
        }
        this.emit(' do\n');
        this.emitBlock(stat.body, true);
        this.emitLine('end');
        break;
      }

      case 'AstStatForIn': {
        this.emitIndent();
        this.emit('for ');
        this.emit(stat.varLocalIds.map(id => this.localName(id)).join(', '));
        this.emit(' in ');
        this.emitExprList(stat.values);
        this.emit(' do\n');
        this.emitBlock(stat.body, true);
        this.emitLine('end');
        break;
      }

      case 'AstStatAssign': {
        this.emitIndent();
        this.emitExprList(stat.vars);
        this.emit(' = ');
        this.emitExprList(stat.values);
        this.emit('\n');
        break;
      }

      case 'AstStatCompoundAssign': {
        this.emitIndent();
        this.emitExpr(stat.var, 0);
        this.emit(' ');
        this.emit(BINARY_OP_STR[stat.op]);
        this.emit('= ');
        this.emitExpr(stat.value, 0);
        this.emit('\n');
        break;
      }

      // Type-system statements — source passthrough
      case 'AstStatTypeAlias':
      case 'AstStatTypeFunction':
      case 'AstStatDeclareGlobal':
      case 'AstStatDeclareFunction':
      case 'AstStatDeclareExternType': {
        this.emitIndent();
        this.emit(this.sourceSpan(stat));
        this.emit('\n');
        break;
      }

      case 'AstStatError': {
        // Hard stop — should never reach generator with parse errors
        throw new Error(
          `Generator: encountered AstStatError at ${JSON.stringify(stat.location)} (errorIndex ${stat.errorIndex}). Parse errors must be checked before generation.`,
        );
      }

      default: {
        const _exhaust: never = stat;
        throw new Error(`Generator: unhandled statement type: ${(_exhaust as ObscuraStat).type}`);
      }
    }
  }

  private emitStatIf(stat: AstStatIf): void {
    this.emitIndent();
    this.emit('if ');
    this.emitExpr(stat.condition, 0);
    this.emit(' then\n');
    this.emitBlock(stat.thenBody, true);

    let else_ = stat.elseBody;
    while (else_ !== null) {
      if (else_.type === 'AstStatIf') {
        // elseif chain — parser produces nested AstStatIf for each elseif
        this.emitIndent();
        this.emit('elseif ');
        this.emitExpr(else_.condition, 0);
        this.emit(' then\n');
        this.emitBlock(else_.thenBody, true);
        else_ = else_.elseBody;
      } else {
        // else body — parser always wraps in AstStatBlock
        this.emitLine('else');
        this.emitBlock(else_ as AstStatBlock, true);
        else_ = null;
      }
    }
    this.emitLine('end');
  }

  // ---------------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------------

  /**
   * emitExpr with precedence-based parenthesization.
   * minPrecedence: the minimum left-binding power the parent context requires.
   * If this expression binds less tightly, wrap in parens.
   */
  private emitExpr(expr: ObscuraExpr, minPrecedence: number): void {
    switch (expr.type) {
      case 'AstExprConstantNil': {
        this.emit('nil');
        break;
      }
      case 'AstExprConstantBool': {
        this.emit(expr.value ? 'true' : 'false');
        break;
      }
      case 'AstExprConstantNumber': {
        this.emit(formatNumber(expr.value));
        break;
      }
      case 'AstExprConstantString': {
        this.emit(quoteString(expr.value));
        break;
      }
      case 'AstExprVarargs': {
        this.emit('...');
        break;
      }

      case 'AstExprLocal': {
        this.emit(this.localName(expr.localId));
        break;
      }

      case 'AstExprGlobal': {
        this.emit(expr.name);
        break;
      }

      case 'AstExprGroup': {
        // Explicit parentheses from source — always emit them.
        // They may be needed for disambiguation even if not required by our
        // precedence logic (e.g. `(f())` truncates multiple returns to one).
        this.emit('(');
        this.emitExpr(expr.expr, 0);
        this.emit(')');
        break;
      }

      case 'AstExprCall': {
        this.emitExpr(expr.func, 12); // call has highest left-binding
        this.emit('(');
        this.emitExprList(expr.args);
        this.emit(')');
        break;
      }

      case 'AstExprIndexName': {
        this.emitExpr(expr.expr, 12);
        this.emit(expr.op);
        this.emit(expr.index);
        break;
      }

      case 'AstExprIndexExpr': {
        this.emitExpr(expr.expr, 12);
        this.emit('[');
        this.emitExpr(expr.index, 0);
        this.emit(']');
        break;
      }

      case 'AstExprUnary': {
        // Guard: -(-x) would emit "--x" which is a Luau comment token.
        // Parenthesize the operand whenever it is also a unary minus.
        const needsParens = expr.expr.type === 'AstExprUnary' && expr.op === 'Minus';
        if (minPrecedence > UNARY_PRIORITY) {
          this.emit('(');
          this.emit(UNARY_OP_STR[expr.op]);
          if (needsParens) this.emit('(');
          this.emitExpr(expr.expr, UNARY_PRIORITY);
          if (needsParens) this.emit(')');
          this.emit(')');
        } else {
          this.emit(UNARY_OP_STR[expr.op]);
          if (needsParens) this.emit('(');
          this.emitExpr(expr.expr, UNARY_PRIORITY);
          if (needsParens) this.emit(')');
        }
        break;
      }

      case 'AstExprBinary': {
        const [leftP, rightP] = BINARY_PRIORITY[expr.op];
        const needsParens = leftP < minPrecedence;
        if (needsParens) this.emit('(');
        this.emitExpr(expr.left, leftP);
        this.emit(' ');
        this.emit(BINARY_OP_STR[expr.op]);
        this.emit(' ');
        this.emitExpr(expr.right, rightP);
        if (needsParens) this.emit(')');
        break;
      }

      case 'AstExprFunction': {
        this.emit('function');
        this.emitFunctionBody(expr);
        break;
      }

      case 'AstExprTable': {
        this.emitTable(expr.items);
        break;
      }

      case 'AstExprIfElse': {
        // if-then-else expression (Luau-specific)
        this.emit('if ');
        this.emitExpr(expr.condition, 0);
        this.emit(' then ');
        this.emitExpr(expr.trueExpr, 0);
        this.emit(' else ');
        this.emitExpr(expr.falseExpr, 0);
        break;
      }

      case 'AstExprInterpString': {
        // strings.length === expressions.length + 1
        this.emit('`');
        for (let i = 0; i < expr.strings.length; i++) {
          this.emit(escapeInterpString(expr.strings[i] ?? ''));
          if (i < expr.expressions.length) {
            this.emit('{');
            this.emitExpr(expr.expressions[i]!, 0);
            this.emit('}');
          }
        }
        this.emit('`');
        break;
      }

      case 'AstExprTypeAssertion': {
        // Emit inner expr; type annotation is passthrough via source span
        this.emitExpr(expr.expr, 0);
        // v0.1.0: type annotation portion is omitted for now
        // The generated output drops `:: Type` — acceptable for Walking Skeleton
        // since type annotations are not semantically load-bearing at runtime.
        // TODO: implement source-span passthrough for type annotation in 0.5 follow-up.
        break;
      }

      case 'AstExprInstantiate': {
        // f<T>() — emit the inner expr; generic args are passthrough
        // v0.1.0: generic args dropped (type-level, not runtime)
        this.emitExpr(expr.expr, 0);
        break;
      }

      case 'AstExprRaw': {
        // Transform-injected verbatim source — emit as-is, no escaping
        this.emit(expr.rawSource);
        break;
      }

      case 'AstExprError': {
        throw new Error(
          `Generator: encountered AstExprError (errorIndex ${expr.errorIndex}). Parse errors must be checked before generation.`,
        );
      }

      default: {
        const _exhaust: never = expr;
        throw new Error(`Generator: unhandled expression type: ${(_exhaust as ObscuraExpr).type}`);
      }
    }
  }

  private emitExprList(exprs: ObscuraExpr[]): void {
    for (let i = 0; i < exprs.length; i++) {
      if (i > 0) this.emit(', ');
      this.emitExpr(exprs[i]!, 0);
    }
  }

  private emitFunctionBody(func: AstExprFunction): void {
    // Attributes (@native, @checked, etc.)
    if (func.attributes.length > 0) {
      for (const attr of func.attributes) {
        this.emit(`@${attr.type.toLowerCase()} `);
      }
    }

    this.emit('(');
    const params: string[] = [];
    if (func.selfLocalId !== null) {
      params.push('self');
    }
    for (const id of func.argLocalIds) {
      params.push(this.localName(id));
    }
    if (func.vararg) params.push('...');
    this.emit(params.join(', '));
    this.emit(')\n');
    this.emitBlock(func.body, true);
    this.emitIndent();
    this.emit('end');
  }

  private emitTable(items: ObscuraTableItem[]): void {
    if (items.length === 0) {
      this.emit('{}');
      return;
    }
    this.emit('{\n');
    this.indent++;
    for (const item of items) {
      this.emitIndent();
      switch (item.kind) {
        case 'list': {
          this.emitExpr(item.value, 0);
          break;
        }
        case 'record': {
          // key is AstExprConstantString in record fields
          const key = item.key;
          if (key !== null && key.type === 'AstExprConstantString') {
            // Emit as bare identifier if it's a valid identifier, else as ["key"]
            if (isIdentifier(key.value)) {
              this.emit(key.value);
            } else {
              this.emit('[');
              this.emit(quoteString(key.value));
              this.emit(']');
            }
          } else if (key !== null) {
            this.emit('[');
            this.emitExpr(key, 0);
            this.emit(']');
          }
          this.emit(' = ');
          this.emitExpr(item.value, 0);
          break;
        }
        case 'general': {
          if (item.key !== null) {
            this.emit('[');
            this.emitExpr(item.key, 0);
            this.emit('] = ');
          }
          this.emitExpr(item.value, 0);
          break;
        }
      }
      this.emit(',\n');
    }
    this.indent--;
    this.emitIndent();
    this.emit('}');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 53) {
    return n.toString();
  }
  // Preserve float representation with enough precision
  const s = n.toPrecision(17).replace(/\.?0+$/, '');
  return s;
}

function quoteString(s: string): string {
  // Luau strings are byte strings. We must preserve the exact byte values of the
  // original source. High bytes (> 0x7e) must be emitted as \xNN escapes so that
  // the byte value in the output matches the original — NOT re-encoded as UTF-8.
  // Example: Latin-1 0xe1 must emit as \xe1, not as UTF-8 c3a1, because Luau
  // string.find() operates on bytes and position counts depend on byte length.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i]!;
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\0':
        out += '\\0';
        break;
      default:
        if (c >= 0x01 && c <= 0x1f) {
          out += `\\${c}`;
        } else if (c > 0x7e) {
          // Emit as \xNN to preserve exact byte value
          out += `\\x${c.toString(16).padStart(2, '0')}`;
        } else {
          out += ch;
        }
    }
  }
  out += '"';
  return out;
}

function escapeInterpString(s: string): string {
  // Re-encode decoded string segment values for emission inside Luau backtick strings.
  // The AST stores already-decoded values (escape sequences processed by the parser).
  // We must re-encode: \n -> \\n, \r -> \\r, \t -> \\t, \0 -> \\0,
  // backtick -> \`, opening brace -> \{ (would be parsed as interpolation marker),
  // backslash -> \\ (must be doubled).
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i]!;
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '`':
        out += '\\`';
        break;
      case '{':
        out += '\\{';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\0':
        out += '\\0';
        break;
      default:
        if (c >= 0x01 && c <= 0x1f) {
          out += `\\${c}`;
        } else if (c > 0x7e) {
          // Emit as \xNN, NOT \u{NN} — \u{} is a Unicode codepoint escape in Luau
          // and gets UTF-8 encoded at runtime, changing byte length/positions.
          // \xNN preserves the exact original byte, matching quoteString().
          out += `\\x${c.toString(16).padStart(2, '0')}`;
        } else {
          out += ch;
        }
    }
  }
  return out;
}

function isIdentifier(s: string): boolean {
  if (KEYWORDS.has(s)) return false;
  if (s.length === 0) return false;
  if (!/^[a-zA-Z_]/.test(s)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generate(result: ObscuraParseResult): string {
  if (result.errors.length > 0) {
    const first = result.errors[0]!;
    throw new Error(
      `Generator: cannot generate from a parse result with errors. ` +
        `First error at ${first.location.begin.line}:${first.location.begin.column}: ${first.message}`,
    );
  }
  const gen = new Generator(result);
  return gen.generate(result.root);
}
