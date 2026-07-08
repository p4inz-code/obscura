# ARCHITECTURE.md — Obscura

**Status:** Architecture Phase
**Scope:** Core engine + CLI only (per modified monorepo decision — see TECH_DECISIONS.md)

---

## 1. Existential Risk: The Parser

This is stated first because it is the single highest-risk item in the entire project, and the original handoff understated it by listing "Parser" as one bullet next to "CLI."

**Luau is not Lua 5.1.** It has:
- Type annotations and type-checking syntax (`local x: number = 5`, function type signatures)
- String interpolation (`` `{name} is here` ``)
- Generalized iteration and newer stdlib surface (`buffer`, `task` library patterns)
- `if-then-else` expressions
- Continue statements, compound assignment in some contexts
- A grammar that **changes periodically** as Roblox ships engine updates — Luau is not a frozen spec

A hand-rolled recursive-descent parser that mishandles any of this is not a minor bug — it is the exact failure mode that kills the entire trust thesis (Rule 9: *Breaking User Scripts Is Unacceptable*). A developer whose game breaks in production because Obscura mis-parsed a type annotation will not file a calm bug report; they will post about it, and "Obscura broke my game" is the one sentence this project cannot survive being true.

### Parser Strategy Research Spike — Highest-Priority Engineering Task

This is not one option among several to weigh — it is the **first task on the engineering timeline**, before any other code is written, including Binder or transform scaffolding. Nothing downstream can be trusted until this is resolved.

**Research order (strict — do not skip ahead):**

**A. Official Luau parser / WASM approach.** Roblox's Luau project is open source and is the canonical grammar authority. Spike whether its parser/AST can be consumed directly — via an existing WASM build, by building one from source, or via a binding — rather than reimplementing parsing logic Roblox's own team already maintains. This is the strongest option if viable: correctness is inherited from the grammar's actual owner, and grammar drift (Luau Drift Risk, below) becomes "rebuild the binding" instead of "manually re-derive the syntax change."

**B. Existing Luau parser libraries (JS/TS ecosystem).** If (A) is a dead end — no usable WASM build, prohibitive build complexity, or no viable binding path — audit existing community Luau parsers in the JS/TS ecosystem for grammar coverage, maintenance activity, and test quality. Do not assume any exists with adequate coverage; audit, don't assume.

**C. Custom hand-rolled parser — only if A and B are both unsuitable.** Lowest dependency risk, highest engineering cost, and the dangerous failure mode (confidently wrong rather than loudly broken) unless paired with strict fail-loud behavior: unsupported syntax produces a hard error with a clear message, never a best-effort guess that emits broken output. If this path is taken, **scope v0.1.0 to a deliberately conservative, explicitly documented subset of Luau syntax** (no advanced type annotations, no string interpolation) rather than attempting full coverage immediately.

**Spike constraints:** time-box the evaluation of A and B (days, not weeks) before defaulting to C. The temptation to hand-roll because it "feels more in control" is a bias to actively resist — C is the worst option on the one axis (correctness) this project cannot compromise on, per Rule 9.

## 1a. Language Drift Risk & Update Strategy (NEW)

Luau is not a frozen specification. Roblox updates the engine and the language grammar on an ongoing basis (new stdlib surface, syntax additions, type-system changes). This means whatever parser strategy is chosen from the Research Spike above is not a one-time build — it is an **ongoing maintenance obligation** for the life of the project.

**Risk:** a parser that is fully correct today can become silently wrong after a Luau update ships, producing the exact "confidently wrong" failure mode this document has flagged as the project's top existential risk — except now recurring, not one-time.

**Update strategy (by parser path):**

| Path chosen | Drift mitigation |
|---|---|
| **A — Official parser/WASM** | Drift mitigation is largely inherited: track upstream Luau releases, rebuild/update the binding when upstream changes. Lower ongoing burden, but still requires a monitoring process (someone has to notice upstream changed). |
| **B — Existing library** | Drift mitigation depends entirely on the upstream library's own maintenance cadence — this is a real risk factor to weigh *during* the Research Spike audit, not after adopting it. A stale or abandoned library inherits all of path C's risk with none of path A's authority. |
| **C — Custom parser** | Drift mitigation is fully manual: requires an active process to monitor Luau changelog/release notes and a recurring engineering task to update grammar coverage. Should be budgeted as a named, recurring roadmap item post-v1.0 (e.g., periodic "Luau syntax sync" milestones), not silently absorbed into general maintenance. |

**Process requirement regardless of path chosen:** establish a lightweight, recurring check (e.g., monitoring Luau's public release notes/changelog) as part of ongoing maintenance once the project ships. This should be named explicitly in post-v1.0 planning rather than assumed to happen organically — "the parser might silently go stale" is a risk that needs an owner and a cadence, not just an awareness.

## 2. Pipeline (Revised — Binder Merge)

```
Source Code
   ↓
Parser            ← highest risk component (see Section 1)
   ↓
AST               ← versioned, public internal contract (see Section 2a)
   ↓
Binder            ← scope creation, symbol table, identifier binding, reference tracking
   ↓
Transformation Pipeline   ← ordered, isolated transforms with explicit ordering constraints (see Section 3)
   ↓
Code Generator    ← emits valid Luau from transformed AST
   ↓
Output
```

**Change from original handoff:** the originally separate `Analyzer` and `Scope Resolver` stages are merged into a single **Binder** stage. In real-world implementations these are almost always one pass — building a symbol table while walking scope requires seeing declarations and usages together, since you can't fully resolve a scope's bindings without already constructing it. Keeping them as two formally distinct pipeline stages was extra abstraction with no payoff at this project's scale, and risked a split where each stage held an incomplete view of the same data.

**Binder responsibilities (consolidated):**
- Scope creation (function scopes, block scopes, loop scopes)
- Symbol table construction (every declared identifier, its kind, its scope)
- Identifier binding (every usage resolved to its declaring symbol, or flagged as unresolved/global/dynamic)
- Reference tracking (every place a symbol is read or written — required for transforms like `RenameTransform` to know what's safe to touch)

This shape is correct and standard for source-to-source transformation tools (similar shape to Babel, Terser — both of which also use a single binding/scope pass rather than splitting analysis and resolution). No further changes proposed to the high-level pipeline.

## 2a. AST as a Versioned Public Internal Contract (NEW)

**Decision:** The AST schema is versioned from day one and treated as a public internal contract, not an implementation detail that can change freely between commits.

**Why this matters now, not later:** Every other piece of the system — the Binder, every transform, the Code Generator, and eventually third-party plugins (v0.7+) — depends on the AST's shape. If the AST schema drifts silently as the parser evolves, every downstream consumer is exposed to breakage that has nothing to do with their own logic being wrong. Versioning the schema from day one means AST changes become a deliberate, reviewable decision instead of an accidental side effect of a parser tweak.

**What "versioned" means in practice:**
- The AST node shapes (every node type, its fields, its invariants) are documented as a schema, not inferred from parser source code.
- Schema changes are tracked with a version identifier, separate from the package's semver if needed — a parser bugfix release might still be an AST-breaking change for a transform author.
- Breaking AST changes are called out explicitly in changelogs once external consumers (plugins, VS Code extension) exist.

**What "tested independently of runtime behavior" means:**
The golden test corpus (Section 4) already verifies behavioral equivalence (does the script still *run* the same). That is necessary but not sufficient. The AST schema additionally needs **golden AST tests** — fixtures where a known input produces a known, asserted AST shape. This catches a different failure class: the parser silently changing what kind of node it produces for a given construct, even when the final emitted Luau still happens to run correctly today. AST drift is a slow-motion breaking change that behavioral tests alone won't catch until a transform built on the old shape breaks later.

**Tradeoff accepted:** maintaining a documented, versioned schema is real upfront and ongoing cost for a solo dev. It's worth it specifically because the AST is the one artifact every other component depends on — it's the actual interior interface of the whole project, public or not.

### Milestone 0 / Walking Skeleton (expanded — pre-v0.1.0 milestone)

Before any transform is written, the pipeline must prove the parser, AST, and generator are trustworthy. This milestone is now expanded beyond round-trip behavioral equivalence to include the AST itself as a tested artifact (per Section 2a).

This is not optional and not "v0.1.0 polish." If round-tripping an unmodified script through the pipeline doesn't preserve behavior, and the AST it produces along the way isn't stable and verified, no transform built afterward can be trusted, since every transform inherits the parser/AST/generator's correctness (or lack of it).

**Definition of done for Milestone 0 (expanded success criteria):**
- **Parse Luau** — parser handles the full golden corpus input set without silently mishandling unsupported syntax (fail-loud on anything out of scope)
- **Generate Luau** — code generator emits valid, runnable Luau from the AST
- **Produce a stable AST** — same input reliably produces the same AST shape, run to run, with no nondeterminism
- **Pass golden AST tests** — fixtures with known input assert known, exact AST shape (Section 2a) — this is new and distinct from behavioral testing
- **Pass behavioral equivalence tests** — Parse → AST → re-emit, zero transforms, output is behaviorally identical to input (same runtime behavior — not necessarily byte-identical text, since formatting may differ)
- All of the above verified against the **full** golden test corpus, not a handful of hand-picked samples

## 3. Transform System

Each transform implements a common interface and is independently testable and independently toggleable. Per revised Rule 5 (see Section 3a), transforms are isolated and side-effect-free *where possible*, with any genuine ordering dependency declared explicitly rather than assumed away. This is correct per Rule 6 (*No Hidden Logic*) — an undeclared ordering dependency is exactly the kind of hidden logic Rule 6 prohibits, even if the transform itself is otherwise pure.

```
Transform Interface (conceptual, not code):
  - name
  - description
  - applies(AST) → boolean        (can this transform run on this input?)
  - transform(AST, config) → AST  (pure function, no side effects)
  - dependsOn / ordering constraints (explicit, declared — empty for most transforms, but not assumed empty by default)
```

**Why explicit ordering (not pure independence) matters long-term:** true order-independence between transforms is rare in real obfuscators — for example, `DeadCodeTransform` run before `RenameTransform` gets its inserted identifiers renamed consistently with everything else; run after, it doesn't. Pretending this kind of interaction doesn't exist doesn't make it go away, it just makes it undocumented. The plugin system (v0.7+) is where this would be discovered the hard way if ordering assumptions are implicit rather than declared — third-party transforms can't safely be inserted into an ordering they aren't told about. Declaring constraints explicitly now is what makes the plugin system viable later without a rewrite.

### 3a. Rule 5 — Revised

**Original:** *"Every Transform Must Be Independent."*

**Revised:** *"Transforms should be isolated and side-effect free where possible. Ordering constraints must be explicit, documented, and deterministic."*

This is a more honest rule, not a weaker one. It still prohibits hidden mutable state and undeclared cross-transform coupling — it just stops pretending that ordering never matters, which the original phrasing implied but couldn't actually guarantee.

### v0.1.0 Transform Scope (deliberately minimal)

- `RenameTransform` (variables, functions, parameters)

No `StringTransform`, `ConstantTransform`, or `DeadCodeTransform` in v0.1.0 — those come in v0.2.0+ per ROADMAP.md, once the rename transform has proven the pipeline against the golden corpus.

## 4. Golden Test Strategy

**Problem with the original handoff:** "Real Luau Script Tests" was listed as a testing strategy bullet with no definition of what "real" means or how many scripts constitute sufficient coverage. Without this, "v0.1.0 works" is subjective and unfalsifiable.

### Golden Test Corpus — Definition

A curated set of real-world-representative Luau scripts, each with:
- The original source
- **Expected AST shape (golden AST test — exact, asserted node structure, per Section 2a)**
- Expected output after each transform is applied
- A runnable behavior check where feasible (not just "does it parse" — "does it still *do* the same thing")

Golden AST tests and behavioral equivalence tests are **two distinct test categories**, not one. A fixture can pass behaviorally (script still runs correctly) while its AST has silently drifted from the documented schema — that drift won't cause a problem today, but it will break the next transform or plugin built against the old shape. Both categories are required, not interchangeable.

**Minimum corpus categories for v0.1.0 sign-off:**

| Category | Why it matters |
|---|---|
| Simple ModuleScript (data table export) | Most common Roblox script shape |
| Script with nested scopes / closures | Tests Binder correctness |
| Script using `task.spawn`, `task.wait` | Common modern Luau pattern, easy to mis-parse if treated as legacy `wait()` |
| Script with metatables / OOP patterns | Common in larger codebases (class-like patterns) |
| Script with coroutines | Control-flow heavy, stresses the Binder |
| Script with type annotations | Tests whether parser handles or correctly rejects typed Luau |
| Script with string interpolation | Same — handle or loudly reject, never silently mishandle |
| Minified/already-obfuscated input | Edge case: Obscura should not crash on already-transformed input |
| Empty/trivial script | Baseline sanity check |
| Large real script (500+ lines, sourced from an actual open-source Roblox project with compatible license) | Stress test — most bugs surface at scale, not in toy examples |

### Regression Test Policy (formalized)

**Policy:** Every confirmed bug must produce a regression test before the fix is considered merge-ready. No exceptions for "obvious" fixes or time pressure.

**Mechanics:**
- A confirmed bug is reproduced first as a failing fixture — added to `tests/golden/` (behavioral) or `tests/golden-ast/` (AST shape), whichever category the bug belongs to, or both if it spans both.
- The fix is only merged alongside the new failing-then-passing test in the same change. A fix without an accompanying regression test is incomplete, not just under-documented.
- This applies regardless of bug source: internally found during development, reported by an external user, or surfaced by CI on an unrelated change.
- The regression test is never deleted once added, even if the corpus grows large — see the growth rule below. A shrinking test suite is a silent erosion of the project's actual reliability record.

**Why this is non-negotiable for this project specifically:** Obscura's entire trust thesis rests on "the test suite is the project's actual reliability record, not a marketing claim" (Section 4 growth rule, below). A bug fixed without a regression test is a reliability claim with no evidence behind it — exactly the gap between "trust over marketing" as a stated philosophy and as a practiced one.

**Growth rule (restated, now formalized as policy rather than aspiration):** every bug found in the wild post-release gets converted into a golden test case before the fix is considered complete. The corpus only grows, never shrinks. This is how the test suite becomes the project's actual reliability record over time — a concrete, inspectable trust artifact, not a marketing claim.

## 4a. Compatibility Policy (NEW)

**Problem this section closes:** without a stated compatibility commitment, "does Obscura support my script" is answered ad hoc per bug report, and "breaking user scripts is unacceptable" (Rule 9) has no concrete boundary defining what's actually in scope to protect.

**Supported Luau version policy:**
- Obscura targets the **current stable Luau syntax/runtime as shipped in live Roblox Studio / Roblox engine** at any given Obscura release — not a frozen historical version, since Luau itself doesn't version in a way that makes pinning to "Luau 0.5" meaningful the way it would for a spec'd language.
- The exact syntax surface actually supported is defined empirically by the golden test corpus (Section 4), not by a separate prose specification — if a construct doesn't have golden coverage, it is not a supported guarantee, even if the parser happens to handle it.
- Whatever parser strategy is chosen via the Research Spike (Section 1) determines the practical ceiling of this policy: Path A (official parser/WASM) tracks Roblox's actual grammar most closely; Path C (hand-rolled subset) is explicitly bounded to whatever conservative subset is documented at the time.

**Compatibility guarantees:**
- **Within a minor version of Obscura, behavioral output for previously-supported syntax will not regress** — this is what the regression test policy above exists to enforce mechanically, not just promise.
- **New Luau syntax support is additive, not assumed.** If Roblox ships a new construct, Obscura does not silently "probably handle it" — it either has explicit golden test coverage proving support, or it fails loud (per Section 1's fail-loud principle) rather than guessing.
- **No retroactive guarantee for unsupported syntax.** If a script uses a construct outside the documented supported subset (especially relevant under Path C), Obscura is expected to reject it clearly at parse time, not attempt a best-effort transform.
- **Breaking changes to supported syntax handling require a major version bump and changelog entry**, consistent with the AST-as-public-contract policy (Section 2a) — a change to how a previously-supported construct is parsed or transformed is exactly the kind of change that needs to be loud, not silent.

**What this policy deliberately does NOT promise:** Obscura does not promise to track every Luau syntax addition immediately upon Roblox shipping it (see Language Drift Risk, Section 1a, for the maintenance cadence question this depends on). The compatibility guarantee is about **not silently breaking what's already supported**, not about being perpetually current with everything Roblox ships.

## 5. Benchmark Strategy

Deferred to v0.5.5 per ROADMAP.md, but the *strategy* (not implementation) is defined here so it's not designed ad hoc later.

**What gets benchmarked:**
- Transform pipeline execution time vs. input script size (must scale roughly linearly; if any transform is super-linear, that's a scalability bug worth knowing about early)
- Output size delta (obfuscated size vs. original — informational, not a target to optimize aggressively, since "smallest output" is not a success metric per VISION.md)
- Memory usage on large inputs (relevant for CI and for developers running Obscura on big codebases)

**What does NOT get benchmarked or marketed:**
- "Resistance to deobfuscation" as a quantitative score — this invites an arms-race framing (Rule: *Strongest obfuscator* is explicitly not a success metric) and tends to produce exactly the exploit-adjacent feature pressure VISION.md's Acceptable Use section warns against.

Benchmarks exist to catch performance regressions in CI, not to be a marketing number.

### Performance Targets (NEW — baseline, not aspirational)

**Purpose:** give the Benchmark Suite (deferred to v0.5.5 in implementation, but needing defined targets now) something concrete to measure against, and give Milestone 0 / early development a sanity check for "is this pipeline fundamentally too slow to be usable" well before v0.5.5 arrives.

These are **baseline targets for initial validation**, not committed SLAs — they exist so a 10x performance regression is obviously visible early, not so the team optimizes prematurely against a precise number. Revisit and tighten once real-world script size distribution is better understood post-v0.1.0.

| Stage | Target (baseline) | Rationale |
|---|---|---|
| **Parser** | Parse a 500-line real-world script in **under 200ms** on typical dev hardware | Roughly in line with comparable JS/TS AST parsers (e.g., Babel-class tooling) at similar script sizes; a parser an order of magnitude slower than this signals an algorithmic problem (e.g., accidental quadratic behavior), not just "needs polish" |
| **Binder** | Bind/resolve scopes for the same 500-line script in **under 100ms** | Binding is a single linear-ish pass over the AST; should be faster than parsing, not comparable to or slower than it — if Binder time approaches or exceeds Parser time, that's a signal worth investigating, not ignoring |
| **Transform (single transform, e.g. `RenameTransform`)** | Apply one transform to the same 500-line script in **under 50ms** | Transform passes should be cheap relative to parsing/binding; this target exists mainly to catch transforms that accidentally re-walk the full AST multiple times instead of doing a single pass |
| **End-to-end (v0.1.0 pipeline)** | Full parse → bind → transform → generate cycle for a 500-line script in **under 500ms** total | Informal ceiling for "does this feel responsive in a CLI workflow" — a developer running Obscura as part of a build step shouldn't notice it as a bottleneck for typical script sizes |
| **Scaling behavior (all stages)** | Execution time should scale **roughly linearly** with input size, verified against both the 500-line baseline and the large (1000+ line) golden corpus entry | Catches superlinear blowups before they become a real-world complaint on large codebases; this is more important long-term than any single absolute number above |

**Explicitly out of scope for these targets:** memory usage gets a target too (tracked under the existing Benchmark Strategy bullet above — "memory usage on large inputs"), but no specific number is set here since it's more workload-dependent and better calibrated empirically once the Walking Skeleton exists and can be profiled on real corpus entries.

**How these get used in practice:** these numbers are first exercised informally during Milestone 0 / v0.1.0 development (a quick sanity check, not a CI gate yet), and only become enforced CI regression gates once the Benchmark Suite milestone (v0.5.5) formally implements them. Treating them as advisory now and enforced later avoids blocking early development on premature optimization while still giving the project an early warning signal if something is fundamentally too slow.

## 6. Repository Structure (Modified Per Current Decision)

```
obscura/
├── packages/
│   ├── core/        # parser, AST schema, binder, transforms, generator
│   └── cli/         # CLI entrypoint, consumes core
├── examples/         # sample scripts for manual testing
├── tests/
│   ├── golden/        # golden behavioral test corpus (Section 4)
│   └── golden-ast/     # golden AST shape tests (Section 2a)
├── benchmarks/        # added once Benchmark Suite milestone is reached, not before
└── .github/
```

`apps/` (website, docs, playground) and the remaining `packages/` (parser, binder, transforms, vscode, shared as separate packages) are **deferred**, not deleted — see TECH_DECISIONS.md for the staged-expansion trigger criteria.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Hand-rolled parser silently mis-handles modern Luau syntax | **Critical** | Resolve parser strategy via Research Spike (Section 1, paths A→B→C) before any other code is written; fail-loud on unsupported syntax |
| Luau grammar changes over time (Roblox-controlled, not versioned like a stable language spec) | Medium-High | See Section 1a — drift mitigation strategy defined per parser path, with a named recurring maintenance process required post-v1.0 |
| AST schema drifts silently as parser evolves, breaking downstream consumers without warning | **High (new)** | Golden AST tests (Section 2a, Section 4) catch shape drift independently of behavioral correctness; schema is versioned and documented, not inferred |
| Golden corpus too small / not representative | Medium | Explicit minimum categories defined above; Regression Test Policy (Section 4) ties every confirmed bug to a mandatory new test before merge |
| A confirmed bug gets fixed without a regression test under time pressure | Medium | Regression Test Policy (Section 4) makes this a merge-blocking requirement, not a best-effort convention |
| No defined compatibility boundary leads to ad hoc "is this supported" decisions per bug report | Medium | Closed by Compatibility Policy (Section 4a) — supported surface is defined empirically by golden corpus coverage, not assumed |
| Pipeline performance degrades unnoticed until it's a real complaint (e.g. accidental quadratic behavior in Binder or a transform) | Medium | Performance Targets (Section 5) give an early, informal sanity check well before the v0.5.5 Benchmark Suite formalizes enforcement |
| Transform ordering dependency exists but is undeclared (violates revised Rule 5) | Medium | Ordering constraints must be explicit and documented per transform (Section 3a); code review discipline + tests with multiple transforms enabled, once v0.2.0+ exists |
| Binder incorrectly identifies a variable as safe-to-rename (e.g., misses a closure capture or `_G` reference) | High | This is the most likely source of "broke my game" bugs — needs dedicated golden test category and conservative-by-default behavior (when in doubt, don't rename) |

## Tradeoffs

- **Conservative v0.1.0 syntax scope** (Section 1, path C, if hand-rolling is reached) trades initial feature completeness for safety. Correct trade given Rule 9.
- **Milestone 0 as a hard gate before transforms, now expanded to include golden AST tests** trades a few weeks of calendar time (no visible obfuscation feature yet) for a verified-trustworthy foundation. Worth it — every transform built on an unverified parser/AST/generator inherits its bugs invisibly.
- **Deferring benchmarks until v0.5.5** trades early performance visibility for focus on correctness first. Correct given "reliability over features."

## Future Scaling Considerations

- Whichever parser path the Research Spike lands on (Section 1), budget ongoing maintenance time per the Language Drift Risk strategy (Section 1a) — this is a recurring cost across the 2–3 year horizon, not a sunk one-time cost.
- The `core`/`cli` two-package split is intentionally minimal. The trigger for splitting `core` further (into `parser`, `binder`, `transforms` as separate packages) should be **a second real consumer that needs only part of core** — e.g., the VS Code extension needing the parser/Binder for live diagnostics without the full CLI. Splitting before that point is speculative architecture with no current beneficiary.
- The plugin system (v0.7+) is the point where transform isolation and declared ordering (Section 3, Section 3a) get stress-tested by code Obscura's own team didn't write. Any undeclared ordering assumptions made before then will surface as breaking changes to the plugin API.
