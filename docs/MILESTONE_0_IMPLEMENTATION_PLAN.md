# MILESTONE_0_IMPLEMENTATION_PLAN.md — Obscura

**Status:** Milestone 0 — Implementation Planning (no code yet)
**Parser strategy:** Path A (official Luau Ast/Compiler via WASM), default unless implementation proves otherwise

---

## Milestone Breakdown

### 0.1 — WASM Build Pipeline
Build/adapt an Emscripten target for Luau's `Ast` + `Compiler` libraries (subset, not full VM/runtime). Pin to a specific stable Luau release tag, not `master`.
- **Deliverable:** `luau-ast.wasm` + JS glue, loadable from Node.
- **Risk:** Emscripten toolchain friction; exception handling plumbing (`invoke_*`/`__cxa_*`) is fiddly per spike findings. **Medium.**
- **Effort:** 2–4 days.

### 0.2 — AST Serialization Contract (WASM → JS boundary)
Define how the C++ AST crosses into JS: parse C++-side, serialize to a flat/JSON-like structure (node `type`, fields, children, `Location`), deserialize into native TS objects. This *is* the first draft of the versioned AST schema (ARCHITECTURE.md 2a).
- **Deliverable:** Serialization format spec + the TS-side deserializer.
- **Risk:** Getting this wrong here propagates everywhere downstream. **High — design carefully, don't rush.**
- **Effort:** 2–3 days.

### 0.3 — Obscura AST Compatibility Layer (conditional)
Decide: consume the raw Luau AST node shapes directly, or map them onto an Obscura-defined node schema (more decoupling, more upfront work).
- **Recommendation:** Start by consuming raw shapes directly (thin TS types mirroring `Ast.h`). Add a compatibility/mapping layer only if Path A's raw shapes prove awkward for the Binder/transforms to work with. Don't build the abstraction speculatively.
- **Deliverable:** Either (a) a documented decision to skip this layer for now, or (b) a thin mapping module, whichever the 0.2 output makes necessary.
- **Risk:** Building this prematurely is the over-engineering risk; skipping it when actually needed is the under-engineering risk. **Medium — judgment call after 0.2.**
- **Effort:** 0 days (if skipped) to 2 days (if needed).

### 0.4 — Node Integration
Wire the WASM module + deserializer into the `packages/core` package. Expose a minimal `parse(source: string) -> AST` function.
- **Deliverable:** Working `parse()` callable from a Node/TS test script.
- **Risk:** Low — mechanical once 0.1–0.3 are done.
- **Effort:** 1 day.

### 0.5 — Code Generator (AST → Luau source)
Emit valid Luau text from the AST. v0.1.0-grade only: correctness over formatting fidelity (ARCHITECTURE.md — ugly output is fine, comments/whitespace preservation is not required).
- **Deliverable:** `generate(ast) -> string`.
- **Risk:** Edge cases in operator precedence/parenthesization producing semantically-wrong-but-syntactically-valid output. **Medium.**
- **Effort:** 3–5 days.

### 0.6 — Golden Corpus Structure
Stand up `tests/golden/` and `tests/golden-ast/` per ARCHITECTURE.md Section 4/2a. Populate with the minimum category list (ModuleScript, closures, `task.spawn`, metatables, coroutines, type annotations, string interpolation, minified input, empty script, one 500+ line real script).
- **Deliverable:** Corpus skeleton + fixture loader utility (test infra, not transforms).
- **Risk:** Sourcing a real, license-compatible 500+ line Luau script. **Low.**
- **Effort:** 1–2 days.

### 0.7 — Behavioral Equivalence Testing
Define and implement the actual equivalence mechanism (the previously-open unknown). **Recommendation:** run original and round-tripped output through Lute (or a minimal Luau WASM runtime) headlessly, capture stdout/return values from fixture-defined entry points, diff. Avoids needing a full Roblox sandbox for v0.1.0.
- **Deliverable:** `assertBehavioralEquivalence(original, generated, fixture)` test helper + Vitest integration.
- **Risk:** Concurrency-related fixtures (coroutines/`task.spawn`) may be non-deterministic — accept as a known gap, not solved here (per ARCHITECTURE.md Section 4, flagged for future fuzz/property testing). **Medium.**
- **Effort:** 3–4 days.

### 0.8 — AST Snapshot Testing
Golden AST tests per Section 2a: known input → asserted exact AST shape. Use Vitest snapshot testing against the serialized AST from 0.2.
- **Deliverable:** Snapshot test harness wired to `tests/golden-ast/`.
- **Risk:** Low — mechanical, once 0.2's serialization format is stable.
- **Effort:** 1 day.

### 0.9 — Walking Skeleton Integration
Wire 0.1–0.8 together: Parse → AST → re-emit, zero transforms, verified against full golden corpus on both behavioral and AST-snapshot axes.
- **Deliverable:** Passing CI run across full corpus.
- **Risk:** Integration-only risk — surfaces gaps from earlier stages. **Low-Medium.**
- **Effort:** 1–2 days.

---

## Success Criteria (= Milestone 0 exit, per ROADMAP.md)

- [ ] Parses full golden corpus via Path A; fails loud (not silently) on anything unsupported
- [ ] Generates valid, runnable Luau from the AST
- [ ] AST is stable (same input → same shape, run to run)
- [ ] Golden AST snapshot tests pass
- [ ] Behavioral equivalence tests pass
- [ ] All of the above verified against the **full** corpus, not a sample

## Total Estimated Effort

**~14–22 days** of focused solo-dev work (0.1 → 0.9, sequential where dependent, some parallelizable e.g. 0.5 and 0.6/0.7 scaffolding). Treat as an order-of-magnitude estimate, not a deadline commitment — 0.2 (serialization contract) is the step most likely to expand if the raw AST shape resists clean serialization.

## Top Risks (carried forward, not repeated from prior docs)

1. **0.2's serialization contract is the real bottleneck** — get it wrong and 0.3–0.9 inherit the cost.
2. **Behavioral equivalence mechanism (0.7) is genuinely unsolved territory** — this is where "Luau is harder than it looks" could still bite, independent of the parser decision.
3. **Emscripten exception-handling plumbing (0.1)** — known-fiddly per spike findings, not a guess.

Say go to begin 0.1.
