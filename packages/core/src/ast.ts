/**
 * Obscura AST Contract — schema v1
 * Source: AST_CONTRACT.md, pinned to luau-lang/luau tag 0.701
 *
 * This file is the canonical type definition for the Obscura AST.
 * All transforms, the Binder, and the code generator consume these types.
 * Breaking changes to this file require a schemaVersion bump in ObscuraParseResult.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface ObscuraPosition {
  line: number; // 0-indexed
  column: number;
}

export interface ObscuraLocation {
  begin: ObscuraPosition;
  end: ObscuraPosition;
}

export interface ObscuraParseError {
  location: ObscuraLocation;
  message: string;
}

export interface ObscuraHotComment {
  header: boolean;
  location: ObscuraLocation;
  content: string;
}

// ---------------------------------------------------------------------------
// AstLocal — flat table entry, NOT a tree node
// ---------------------------------------------------------------------------

export type LocalDeclarationKind =
  | 'local' // plain local variable (AstStatLocal)
  | 'param' // function parameter (AstExprFunction.args)
  | 'self' // implicit self parameter (AstExprFunction.self)
  | 'for_num' // numeric for-loop variable (AstStatFor.var)
  | 'for_in' // generic for-loop variable (AstStatForIn.vars)
  | 'function'; // local function binding (AstStatLocalFunction.name)

export interface ObscuraLocal {
  id: number;
  name: string;
  location: ObscuraLocation;
  shadowId: number | null;
  functionDepth: number;
  loopDepth: number;
  hasAnnotation: boolean;
  /**
   * Declared kind — assigned by the serializer's LocalCollector at collection time.
   * Used by the Binder for conservative rename policy:
   *   - 'self' params are never renamed
   *   - 'for_num'/'for_in' vars are renamed conservatively
   *   - 'param' follows function-level rename decisions
   */
  declarationKind: LocalDeclarationKind;
}

// ---------------------------------------------------------------------------
// Node base
// ---------------------------------------------------------------------------

export interface ObscuraNode {
  type: string;
  location: ObscuraLocation;
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export interface ObscuraAttr {
  type: 'Checked' | 'Native' | 'Deprecated' | 'Unknown';
}

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

export interface AstExprConstantNil extends ObscuraNode {
  type: 'AstExprConstantNil';
}
export interface AstExprConstantBool extends ObscuraNode {
  type: 'AstExprConstantBool';
  value: boolean;
}
export interface AstExprConstantNumber extends ObscuraNode {
  type: 'AstExprConstantNumber';
  value: number;
}
export interface AstExprConstantString extends ObscuraNode {
  type: 'AstExprConstantString';
  value: string;
}
export interface AstExprVarargs extends ObscuraNode {
  type: 'AstExprVarargs';
}

// Identifier references — pre-resolved by the Luau parser
export interface AstExprLocal extends ObscuraNode {
  type: 'AstExprLocal';
  localId: number; // -> ObscuraLocal.id
  upvalue: boolean; // AstExprLocal.upvalue — closure-capture signal
}
export interface AstExprGlobal extends ObscuraNode {
  type: 'AstExprGlobal';
  name: string; // unresolved by design — Luau semantics
}

// Access
export interface AstExprGroup extends ObscuraNode {
  type: 'AstExprGroup';
  expr: ObscuraExpr;
}
export interface AstExprIndexName extends ObscuraNode {
  type: 'AstExprIndexName';
  expr: ObscuraExpr;
  index: string;
  op: '.' | ':';
}
export interface AstExprIndexExpr extends ObscuraNode {
  type: 'AstExprIndexExpr';
  expr: ObscuraExpr;
  index: ObscuraExpr;
  dynamicStringKey: boolean; // true if index is AstExprConstantString — Binder rename-safety signal
}

// Call
export interface AstExprCall extends ObscuraNode {
  type: 'AstExprCall';
  func: ObscuraExpr;
  args: ObscuraExpr[];
  self: boolean;
}

// Function literal
export interface AstExprFunction extends ObscuraNode {
  type: 'AstExprFunction';
  selfLocalId: number | null;
  argLocalIds: number[];
  vararg: boolean;
  functionDepth: number;
  body: AstStatBlock;
  debugname: string;
  attributes: ObscuraAttr[];
}

// Operators
export type UnaryOp = 'Not' | 'Minus' | 'Len';
export type BinaryOp =
  | 'Add'
  | 'Sub'
  | 'Mul'
  | 'Div'
  | 'FloorDiv'
  | 'Mod'
  | 'Pow'
  | 'Concat'
  | 'CompareNe'
  | 'CompareEq'
  | 'CompareLt'
  | 'CompareLe'
  | 'CompareGt'
  | 'CompareGe'
  | 'And'
  | 'Or';

export interface AstExprUnary extends ObscuraNode {
  type: 'AstExprUnary';
  op: UnaryOp;
  expr: ObscuraExpr;
}
export interface AstExprBinary extends ObscuraNode {
  type: 'AstExprBinary';
  op: BinaryOp;
  left: ObscuraExpr;
  right: ObscuraExpr;
}

// Luau-specific expressions
export interface AstExprTypeAssertion extends ObscuraNode {
  type: 'AstExprTypeAssertion';
  expr: ObscuraExpr;
  // annotation omitted in v0.1.0 — passthrough via source span
}
export interface AstExprIfElse extends ObscuraNode {
  type: 'AstExprIfElse';
  condition: ObscuraExpr;
  hasThen: boolean;
  trueExpr: ObscuraExpr;
  falseExpr: ObscuraExpr;
}
export interface AstExprInterpString extends ObscuraNode {
  type: 'AstExprInterpString';
  // strings.length === expressions.length + 1, always
  strings: string[];
  expressions: ObscuraExpr[];
}
export interface AstExprTable extends ObscuraNode {
  type: 'AstExprTable';
  items: ObscuraTableItem[];
}
export interface ObscuraTableItem {
  kind: 'list' | 'record' | 'general';
  key: ObscuraExpr | null;
  value: ObscuraExpr;
}
export interface AstExprInstantiate extends ObscuraNode {
  type: 'AstExprInstantiate';
  expr: ObscuraExpr;
  // generic args omitted — passthrough in v0.1.0
}

// Error node (parser recovered from error)
export interface AstExprError extends ObscuraNode {
  type: 'AstExprError';
  errorIndex: number;
}

// Transform-injected node — never emitted by the serializer, only by transforms.
// The generator emits rawSource verbatim, no quoting or escaping.
export interface AstExprRaw extends ObscuraNode {
  type: 'AstExprRaw';
  rawSource: string;
}

export type ObscuraExpr =
  | AstExprConstantNil
  | AstExprConstantBool
  | AstExprConstantNumber
  | AstExprConstantString
  | AstExprLocal
  | AstExprGlobal
  | AstExprVarargs
  | AstExprGroup
  | AstExprCall
  | AstExprIndexName
  | AstExprIndexExpr
  | AstExprFunction
  | AstExprTable
  | AstExprUnary
  | AstExprBinary
  | AstExprTypeAssertion
  | AstExprIfElse
  | AstExprInterpString
  | AstExprInstantiate
  | AstExprError
  | AstExprRaw;

// ---------------------------------------------------------------------------
// Statement nodes
// ---------------------------------------------------------------------------

export interface AstStatBlock extends ObscuraNode {
  type: 'AstStatBlock';
  body: ObscuraStat[];
}
export interface AstStatIf extends ObscuraNode {
  type: 'AstStatIf';
  condition: ObscuraExpr;
  thenBody: AstStatBlock;
  elseBody: ObscuraStat | null;
}
export interface AstStatWhile extends ObscuraNode {
  type: 'AstStatWhile';
  condition: ObscuraExpr;
  body: AstStatBlock;
}
export interface AstStatRepeat extends ObscuraNode {
  type: 'AstStatRepeat';
  body: AstStatBlock;
  condition: ObscuraExpr;
}
export interface AstStatBreak extends ObscuraNode {
  type: 'AstStatBreak';
}
export interface AstStatContinue extends ObscuraNode {
  type: 'AstStatContinue';
}
export interface AstStatReturn extends ObscuraNode {
  type: 'AstStatReturn';
  values: ObscuraExpr[];
}
export interface AstStatExpr extends ObscuraNode {
  type: 'AstStatExpr';
  expr: ObscuraExpr;
}

// Local declarations
export interface AstStatLocal extends ObscuraNode {
  type: 'AstStatLocal';
  varLocalIds: number[];
  values: ObscuraExpr[];
}
export interface AstStatLocalFunction extends ObscuraNode {
  type: 'AstStatLocalFunction';
  nameLocalId: number; // AstLocal* — renameable
  func: AstExprFunction;
}
export interface AstStatFunction extends ObscuraNode {
  type: 'AstStatFunction';
  nameExpr: ObscuraExpr; // AstExpr* — NOT a local, not directly renameable
  func: AstExprFunction;
}

// Loops
export interface AstStatFor extends ObscuraNode {
  type: 'AstStatFor';
  varLocalId: number;
  from: ObscuraExpr;
  to: ObscuraExpr;
  step: ObscuraExpr | null;
  body: AstStatBlock;
}
export interface AstStatForIn extends ObscuraNode {
  type: 'AstStatForIn';
  varLocalIds: number[];
  values: ObscuraExpr[];
  body: AstStatBlock;
}

// Assignment
export interface AstStatAssign extends ObscuraNode {
  type: 'AstStatAssign';
  vars: ObscuraExpr[];
  values: ObscuraExpr[];
}
export interface AstStatCompoundAssign extends ObscuraNode {
  type: 'AstStatCompoundAssign';
  op: BinaryOp;
  var: ObscuraExpr;
  value: ObscuraExpr;
}

// Type-system statements — opaque passthrough in v0.1.0
export interface AstStatTypeAlias extends ObscuraNode {
  type: 'AstStatTypeAlias';
}
export interface AstStatTypeFunction extends ObscuraNode {
  type: 'AstStatTypeFunction';
}
export interface AstStatDeclareGlobal extends ObscuraNode {
  type: 'AstStatDeclareGlobal';
}
export interface AstStatDeclareFunction extends ObscuraNode {
  type: 'AstStatDeclareFunction';
}
export interface AstStatDeclareExternType extends ObscuraNode {
  type: 'AstStatDeclareExternType';
}

// Error node
export interface AstStatError extends ObscuraNode {
  type: 'AstStatError';
  errorIndex: number;
}

export type ObscuraStat =
  | AstStatBlock
  | AstStatIf
  | AstStatWhile
  | AstStatRepeat
  | AstStatBreak
  | AstStatContinue
  | AstStatReturn
  | AstStatExpr
  | AstStatLocal
  | AstStatFor
  | AstStatForIn
  | AstStatAssign
  | AstStatCompoundAssign
  | AstStatFunction
  | AstStatLocalFunction
  | AstStatTypeAlias
  | AstStatTypeFunction
  | AstStatDeclareGlobal
  | AstStatDeclareFunction
  | AstStatDeclareExternType
  | AstStatError;

// ---------------------------------------------------------------------------
// Top-level parse result
// ---------------------------------------------------------------------------

export interface ObscuraParseResult {
  schemaVersion: 1;
  source: string;
  locals: Record<number, ObscuraLocal>;
  root: AstStatBlock;
  errors: ObscuraParseError[];
  hotcomments: ObscuraHotComment[];
}
