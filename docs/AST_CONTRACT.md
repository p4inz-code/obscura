# AST_CONTRACT.md — Obscura

**Status:** Milestone 0 — 0.2 AST Serialization Contract (COMPLETE)
**Luau source pinned:** tag `0.701`
**Scope:** Serialization format, identity strategy, schema, snapshot format, open risks.

---

## Findings

### AstLocal Identity — Resolved

`ParseResult` does **not** expose a flat list of `AstLocal` allocations. The only output is `root: AstStatBlock*`. All `AstLocal*` values exist in the arena allocator, reachable only by walking the tree.

**C++ pointer identity does not survive a WASM boundary** — it is meaningless after serialization. There is no stable id in the official representation. Obscura must **assign its own stable ids during serialization-side tree walk**.

**Strategy:** pre-order depth-first tree walk on the WASM/C++ side; assign a monotonically incrementing integer id to each `AstLocal*` encountered for the first time (using a pointer→id map to detect re-visits, since the same `AstLocal*` is referenced from both its declaration site and all usage sites). The resulting `locals` flat table in the serialized output uses these assigned integer ids. This is deterministic, stable, and reproducible for any given source input.

**Key consequence:** the walk must be done C++-side (or in the WASM glue layer), not in the TS deserializer — because raw pointer values aren't transmitted, so by the time data reaches TS, pointer identity is already gone. The WASM serializer is responsible for id assignment.

### CST Layer — Skipped

35 `CstNode` subclasses carry whitespace/punctuation positions and original quote styles. Irrelevant to Obscura's transform use case. `CstNodeMap` in `ParseResult` is not serialized — ignored entirely.

### AstAttr

Carries `Type enum {Checked, Native, Deprecated, Unknown}` and optional deprecation metadata. Present on `AstExprFunction` via `attributes: AstArray<AstAttr*>`. Relevant only as a passthrough field — transforms should preserve attributes unchanged. Not a Binder input.

### AstExprInterpString

String interpolation (`` `foo{bar}baz` ``) serializes as parallel arrays: `strings` (always `expressions.length + 1` string segments) and `expressions` (the interpolated values). Interleaved on the TS side by index. This is the one "non-obvious" structural pattern in the AST — worth calling out explicitly in tests.

### AstStatFunction vs AstStatLocalFunction

- `AstStatLocalFunction.name` is `AstLocal*` (registered binding, renameable)
- `AstStatFunction.name` is `AstExpr*` (could be `AstExprGlobal`, `AstExprIndexName`, etc. — not a simple binding, not directly renameable)

This distinction is already in the source at the type level. Critical for `RenameTransform` scoping — `AstStatFunction` names are structurally outside the safe-rename path.

### Error Nodes

Parser operates in **error-recovery mode** — it does not throw on parse failure. Errors are collected into `ParseResult.errors: ParseError[]`. `AstExprError` / `AstStatError` are emitted as placeholder nodes at error sites, carrying a `messageIndex` (indexes into `ParseResult.errors`) and any successfully-parsed sub-expressions. Obscura must: (1) check `ParseResult.errors` before accepting output as valid, (2) treat any `AstExprError`/`AstStatError` nodes in the output as fatal for transform purposes (fail-loud, not transform-and-emit).

---

## Decisions

1. **AstLocal stable ids are assigned by the WASM serializer during a pre-order DFS walk**, using a C++-side pointer→int map. Integer ids, zero-indexed per parse result.
2. **CST layer is fully excluded** from the serialized output. No whitespace/formatting fidelity target for v0.1.0.
3. **Comments are excluded.** `ParseResult.commentLocations` is not serialized. Code generator will not preserve comments.
4. **Error handling contract:** serializer always emits `errors: ParseError[]`. TS consumer checks this array before any further processing. Any non-empty `errors` array is a hard stop — no transform runs on a partially-errored parse.
5. **`AstExprIndexExpr` with a constant-string `index`** is serialized normally but **flagged** with `dynamicStringKey: true` on the serialized node. This flag is assigned C++-side (or TS-side cheaply by inspecting the `index` node's `type` field) — it's a derived property for the Binder's safe-rename exclusion logic, not a new node type.
6. **Globals are serialized as `AstExprGlobal { name: string }` — no id, no resolution.** This is correct-by-design (Luau semantics). The Binder's exclude-from-rename policy for globals is enforced at the schema level (no `localId` field, not just "check the name against an exclusion list").
7. **Normalized locals table** (flat, indexed by id) is the final design. Every `AstLocal` appears exactly once in `result.locals`, keyed by its assigned id. All node references to locals use `localId: number`.

---

## Final Schema

### Wire Format: JSON (v0.1.0)

Chosen over a binary format for v0.1.0: debuggable, directly snapshotable, directly diffable, adequate performance at typical Luau script sizes. Revisit if Benchmark Suite (v0.5.5) reveals serialization as a bottleneck.

### Top-Level ParseResult

```typescript
interface ObscuraParseResult {
  schemaVersion: 1                    // bump on any breaking schema change
  source: string                      // original source (needed for code generator source-mapping)
  locals: Record<number, ObscuraLocal> // flat id→AstLocal table, all locals in parse unit
  root: ObscuraStatBlock
  errors: ObscuraParseError[]         // non-empty = hard stop, no transforms run
  hotcomments: ObscuraHotComment[]    // preserved for passthrough, not transform-relevant
}
```

### Primitives

```typescript
interface ObscuraPosition {
  line: number     // 0-indexed (matches Luau internal)
  column: number
}

interface ObscuraLocation {
  begin: ObscuraPosition
  end: ObscuraPosition
}

interface ObscuraParseError {
  location: ObscuraLocation
  message: string
}

interface ObscuraHotComment {
  header: boolean
  location: ObscuraLocation
  content: string
}
```

### AstLocal (flat table entry, not an inline node)

```typescript
interface ObscuraLocal {
  id: number                          // assigned by serializer, stable for this parse result
  name: string                        // AstName.value, canonicalized to string
  location: ObscuraLocation
  shadowId: number | null             // AstLocal.shadow -> resolved id, or null if no shadow
  functionDepth: number               // AstLocal.functionDepth
  loopDepth: number                   // AstLocal.loopDepth
  hasAnnotation: boolean              // AstLocal.annotation != nullptr (type omitted, v0.1.0)
}
```

### Node Base

```typescript
interface ObscuraNode {
  type: string          // exact C++ class name: "AstExprLocal", "AstStatFor", etc.
  location: ObscuraLocation
}
```

### Expression Nodes

```typescript
// Leaf literals
interface AstExprConstantNil      extends ObscuraNode { type: "AstExprConstantNil" }
interface AstExprConstantBool     extends ObscuraNode { type: "AstExprConstantBool";     value: boolean }
interface AstExprConstantNumber   extends ObscuraNode { type: "AstExprConstantNumber";   value: number }
interface AstExprConstantString   extends ObscuraNode { type: "AstExprConstantString";   value: string }
interface AstExprVarargs          extends ObscuraNode { type: "AstExprVarargs" }

// Identifier references — the core binding split
interface AstExprLocal  extends ObscuraNode { type: "AstExprLocal";  localId: number; upvalue: boolean }
interface AstExprGlobal extends ObscuraNode { type: "AstExprGlobal"; name: string }  // no id, by design

// Access
interface AstExprGroup        extends ObscuraNode { type: "AstExprGroup"; expr: ObscuraExpr }
interface AstExprIndexName    extends ObscuraNode {
  type: "AstExprIndexName"
  expr: ObscuraExpr
  index: string
  op: "." | ":"
}
interface AstExprIndexExpr    extends ObscuraNode {
  type: "AstExprIndexExpr"
  expr: ObscuraExpr
  index: ObscuraExpr
  dynamicStringKey: boolean   // true if index is AstExprConstantString (rename-safety signal)
}

// Call
interface AstExprCall extends ObscuraNode {
  type: "AstExprCall"
  func: ObscuraExpr
  args: ObscuraExpr[]
  self: boolean
}

// Function
interface AstExprFunction extends ObscuraNode {
  type: "AstExprFunction"
  selfLocalId: number | null
  argLocalIds: number[]
  vararg: boolean
  functionDepth: number
  body: AstStatBlock
  debugname: string
  attributes: ObscuraAttr[]
}

// Operators
interface AstExprUnary  extends ObscuraNode { type: "AstExprUnary";  op: string; expr: ObscuraExpr }
interface AstExprBinary extends ObscuraNode {
  type: "AstExprBinary"
  op: string               // "Add" | "Sub" | "Mul" | "Div" | "Mod" | "Pow" | "Concat" |
                           // "CompareNe" | "CompareEq" | "CompareLt" | "CompareLe" |
                           // "CompareGt" | "CompareGe" | "And" | "Or"
  left: ObscuraExpr
  right: ObscuraExpr
}

// Luau-specific expressions
interface AstExprTypeAssertion extends ObscuraNode { type: "AstExprTypeAssertion"; expr: ObscuraExpr }  // type stripped, expr preserved
interface AstExprIfElse        extends ObscuraNode {
  type: "AstExprIfElse"
  condition: ObscuraExpr
  trueExpr: ObscuraExpr
  falseExpr: ObscuraExpr
}
interface AstExprInterpString  extends ObscuraNode {
  type: "AstExprInterpString"
  // strings.length === expressions.length + 1, always
  // reconstruct as: strings[0] + expr[0] + strings[1] + expr[1] ... + strings[n]
  strings: string[]
  expressions: ObscuraExpr[]
}
interface AstExprTable extends ObscuraNode {
  type: "AstExprTable"
  items: ObscuraTableItem[]
}
interface ObscuraTableItem {
  kind: "list" | "record" | "general"
  key: ObscuraExpr | null    // null for list items
  value: ObscuraExpr
}
interface AstExprInstantiate extends ObscuraNode {
  type: "AstExprInstantiate"
  expr: ObscuraExpr
}

// Error
interface AstExprError extends ObscuraNode {
  type: "AstExprError"
  errorIndex: number   // indexes into ParseResult.errors
}
```

### Statement Nodes

```typescript
interface AstStatBlock extends ObscuraNode {
  type: "AstStatBlock"
  body: ObscuraStat[]
}
interface AstStatIf extends ObscuraNode {
  type: "AstStatIf"
  condition: ObscuraExpr
  thenBody: AstStatBlock
  elseBody: ObscuraStat | null
}
interface AstStatWhile  extends ObscuraNode { type: "AstStatWhile";  condition: ObscuraExpr; body: AstStatBlock }
interface AstStatRepeat extends ObscuraNode { type: "AstStatRepeat"; body: AstStatBlock; condition: ObscuraExpr }
interface AstStatBreak    extends ObscuraNode { type: "AstStatBreak" }
interface AstStatContinue extends ObscuraNode { type: "AstStatContinue" }
interface AstStatReturn   extends ObscuraNode { type: "AstStatReturn"; values: ObscuraExpr[] }
interface AstStatExpr     extends ObscuraNode { type: "AstStatExpr";   expr: ObscuraExpr }

// Locals — note AstStatLocalFunction.nameLocalId vs AstStatFunction.nameExpr
interface AstStatLocal extends ObscuraNode {
  type: "AstStatLocal"
  varLocalIds: number[]
  values: ObscuraExpr[]
}
interface AstStatLocalFunction extends ObscuraNode {
  type: "AstStatLocalFunction"
  nameLocalId: number          // AstLocal* — renameable
  func: AstExprFunction
}
interface AstStatFunction extends ObscuraNode {
  type: "AstStatFunction"
  nameExpr: ObscuraExpr        // AstExpr* — NOT a local, not directly renameable
  func: AstExprFunction
}

// Loops
interface AstStatFor extends ObscuraNode {
  type: "AstStatFor"
  varLocalId: number
  from: ObscuraExpr
  to: ObscuraExpr
  step: ObscuraExpr | null
  body: AstStatBlock
}
interface AstStatForIn extends ObscuraNode {
  type: "AstStatForIn"
  varLocalIds: number[]
  values: ObscuraExpr[]
  body: AstStatBlock
}

// Assignment
interface AstStatAssign extends ObscuraNode {
  type: "AstStatAssign"
  vars: ObscuraExpr[]
  values: ObscuraExpr[]
}
interface AstStatCompoundAssign extends ObscuraNode {
  type: "AstStatCompoundAssign"
  op: string
  var: ObscuraExpr
  value: ObscuraExpr
}

// Type-system statements (preserved as opaque passthrough in v0.1.0 — not renamed, not transformed)
interface AstStatTypeAlias        extends ObscuraNode { type: "AstStatTypeAlias" }
interface AstStatTypeFunction     extends ObscuraNode { type: "AstStatTypeFunction" }
interface AstStatDeclareGlobal    extends ObscuraNode { type: "AstStatDeclareGlobal" }
interface AstStatDeclareFunction  extends ObscuraNode { type: "AstStatDeclareFunction" }
interface AstStatDeclareExternType extends ObscuraNode { type: "AstStatDeclareExternType" }

// Error
interface AstStatError extends ObscuraNode {
  type: "AstStatError"
  errorIndex: number
}
```

### Auxiliary Types

```typescript
interface ObscuraAttr {
  type: "Checked" | "Native" | "Deprecated" | "Unknown"
}
type ObscuraExpr = AstExprConstantNil | AstExprConstantBool | AstExprConstantNumber |
                   AstExprConstantString | AstExprLocal | AstExprGlobal | AstExprVarargs |
                   AstExprGroup | AstExprCall | AstExprIndexName | AstExprIndexExpr |
                   AstExprFunction | AstExprTable | AstExprUnary | AstExprBinary |
                   AstExprTypeAssertion | AstExprIfElse | AstExprInterpString |
                   AstExprInstantiate | AstExprError

type ObscuraStat = AstStatBlock | AstStatIf | AstStatWhile | AstStatRepeat |
                   AstStatBreak | AstStatContinue | AstStatReturn | AstStatExpr |
                   AstStatLocal | AstStatFor | AstStatForIn | AstStatAssign |
                   AstStatCompoundAssign | AstStatFunction | AstStatLocalFunction |
                   AstStatTypeAlias | AstStatTypeFunction | AstStatDeclareGlobal |
                   AstStatDeclareFunction | AstStatDeclareExternType | AstStatError
```

---

## Snapshot Format

Golden AST snapshots are stored as pretty-printed JSON in `tests/golden-ast/<fixture-name>.snap.json`. Format is the `ObscuraParseResult` wire format, with:
- `source` field **omitted** from snapshots (it's the input, not the output being tested — including it doubles file size and creates diff noise on reformats)
- `locals` table included in full
- `errors` array expected to be `[]` in all passing-fixture snapshots (non-empty errors = invalid fixture)

Vitest snapshot testing compares the full `locals` + `root` object. Any structural change to either (field added/removed/renamed, location drift, node type change) fails the snapshot and must be a deliberate, reviewed update — this is the AST-stability gate per ARCHITECTURE.md Section 2a.

---

## Type-system Nodes: v0.1.0 Treatment

`AstType*` (15 node classes: `AstTypeReference`, `AstTypeTable`, `AstTypeFunction`, `AstTypeTypeof`, `AstTypeOptional`, `AstTypeUnion`, `AstTypeIntersection`, `AstTypeError`, `AstTypeSingletonBool`, `AstTypeSingletonString`, `AstTypeGroup`, `AstTypePack*`) and their parent annotation fields are:
- **Preserved as opaque passthrough nodes** in the AST (serialized with `type` discriminant and `location` only — no child fields in v0.1.0)
- **Not walked by the Binder or any v0.1.0 transform**
- **Re-emitted verbatim by the code generator** (requires source span preservation — emit the original source slice for the annotation range, not a re-generated type string)

This is the correct call for v0.1.0: type annotations are Luau-specific, complex, and have no bearing on rename safety or correctness for the `RenameTransform`. Full serialization of the `AstType*` subtree is deferred to when a transform actually needs to reason about types.

---

## Open Risks

| Risk | Severity | Status |
|---|---|---|
| WASM serializer must implement pre-order DFS + pointer→id map C++-side — this is new bespoke code, not free | Medium | Accepted; bounded scope, clear implementation path |
| `AstExprBinary.Op` full enum not extracted — 14 values confirmed by count, spot-checked (Add, Sub, Mul, Div) | Low | Needs one more `grep` in 0.4 WASM work; non-blocking for schema finalization |
| Type-annotation source-span passthrough requires code generator to track original source byte ranges — not yet designed | Medium | Deferred to code generator (milestone 0.5); schema is schema-complete now |
| `AstExprInstantiate` (explicit type instantiation, `f<T>()`) — fields partially inspected, generic args omitted from schema as opaque | Low | Passthrough-only in v0.1.0; full field extraction deferred |

---

## Go / No-Go for 0.2

**GO. 0.2 is complete.**

- Identity strategy: resolved. Stable ids assigned by WASM serializer via DFS pointer-map.
- Schema: complete for all Binder-critical nodes, all expression/statement nodes, and all v0.1.0-relevant paths.
- Type-system nodes: deliberately deferred with a defined passthrough strategy — not a gap.
- Snapshot format: defined.
- Wire format: JSON, `schemaVersion: 1`.

**Next milestone: 0.3 (Compatibility Layer decision) — recommended decision is SKIP per original plan.** The schema above is clean enough to consume directly in TS without a remapping layer. Proceed to 0.4 (Node integration) immediately after 0.3 sign-off.
