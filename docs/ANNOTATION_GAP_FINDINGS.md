# Type Annotation Gap — Findings & Decision

## Findings

### Corpus fixtures: zero runtime-relevant annotations
All 11 runnable corpus fixtures (01–11) contain **zero type annotations** in code paths
that affect runtime behavior. The regex hits on `stringinterp.luau` and `basic.luau`
were false positives (method call `:` syntax and comments).

### Dropping annotations is runtime-safe (verified)
- `local x: number = 5` → `local x = 5` ✓ behaviorally equivalent
- `function f(x: T): T` → `function f(x)` ✓ behaviorally equivalent
- Generic type params `<T>` dropped ✓ no runtime effect

### AstType nodes that could appear in corpus fixtures
Only via `AstStatTypeAlias` and `AstStatDeclareGlobal` (whole-statement, already passthrough)
and `AstExprTypeAssertion` (`expr :: Type`, already has TODO in generator).
None appear in the 11 runnable fixtures.

### `explicit_type_instantiations.luau` (potential fixture 13)
Uses: generic function args `(x: T)`, return annotations `: T`, explicit type params `<<T>>`.
Exits 0, produces no stdout. Can be added as corpus fixture but annotation-dropped output
passes all asserts — exit-code-only equivalence check is sufficient.

## Decision

**No scope expansion required for corpus compliance.**

The current generator (which drops annotations from `AstExprTypeAssertion` and passes through
`AstStatTypeAlias` etc. via source span) is sufficient for all 11 runnable fixtures.

**AstExprTypeAssertion TODO**: complete the source-span passthrough for the `:: Type` portion.
Needed for correctness on code that uses type assertions, not needed for corpus CI green.
Schedule as a follow-up to 0.9 (not a blocker).

**`explicit_type_instantiations.luau`**: add as optional fixture 13 (exit-code-only check).
Not required for Milestone 0 completion criteria — add if convenient, skip if not.
