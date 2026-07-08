/**
 * @obscura/core — public API
 * parse() now uses the real WASM-compiled Luau parser (0.1b complete, 2026-07).
 */

export type {
  ObscuraParseResult,
  ObscuraLocal,
  LocalDeclarationKind,
  ObscuraParseError,
  ObscuraHotComment,
  ObscuraPosition,
  ObscuraLocation,
  ObscuraNode,
  ObscuraExpr,
  ObscuraStat,
  ObscuraTableItem,
  ObscuraAttr,
  BinaryOp,
  UnaryOp,
  // All node types
  AstExprConstantNil,
  AstExprConstantBool,
  AstExprConstantNumber,
  AstExprConstantString,
  AstExprVarargs,
  AstExprLocal,
  AstExprGlobal,
  AstExprGroup,
  AstExprCall,
  AstExprIndexName,
  AstExprIndexExpr,
  AstExprFunction,
  AstExprTable,
  AstExprUnary,
  AstExprBinary,
  AstExprTypeAssertion,
  AstExprIfElse,
  AstExprInterpString,
  AstExprInstantiate,
  AstExprError,
  AstStatBlock,
  AstStatIf,
  AstStatWhile,
  AstStatRepeat,
  AstStatBreak,
  AstStatContinue,
  AstStatReturn,
  AstStatExpr,
  AstStatLocal,
  AstStatFor,
  AstStatForIn,
  AstStatAssign,
  AstStatCompoundAssign,
  AstStatFunction,
  AstStatLocalFunction,
  AstStatTypeAlias,
  AstStatTypeFunction,
  AstStatDeclareGlobal,
  AstStatDeclareFunction,
  AstStatDeclareExternType,
  AstStatError,
} from './ast.js';

export { generate, Generator } from './generator.js';
export { parse, parseSync, ensureInit } from './parser.js';
export { bind } from './binder.js';
export { applyRenameTransform, nameSequence } from './rename-transform.js';
export { applyStringTransform } from './string-transform.js';
export { applyConstantTransform } from './constant-transform.js';
export { applyDeadCodeTransform } from './dead-code-transform.js';
export { runPipeline } from './plugin-api.js';
export {
  RenameTransform,
  StringTransform,
  ConstantTransform,
  DeadCodeTransform,
  BUILTIN_TRANSFORMS,
} from './builtin-transforms.js';
export type {
  Transform,
  TransformContext,
  TransformOutput,
  PipelineStep,
  PipelineStepResult,
  PipelineResult,
} from './plugin-api.js';
export type {
  BinderResult,
  SymbolTable,
  SymbolEntry,
  Referencesite,
  GlobalFlags,
  RenameClass,
  UnsafeReason,
} from './binder.js';
export type { RenameTransformResult, RenameTransformOptions } from './rename-transform.js';
export type {
  StringTransformResult,
  StringTransformOptions,
  StringEncoding,
} from './string-transform.js';
export type {
  ConstantTransformResult,
  ConstantTransformOptions,
  NumberEncoding,
} from './constant-transform.js';
export type { DeadCodeTransformResult, DeadCodeTransformOptions } from './dead-code-transform.js';
