# PARSER_STRATEGY_SPIKE.md — Obscura

**Status:** Milestone 0, Task 1 — Parser Strategy Research Spike
**Date:** Spike conducted per ROADMAP.md Milestone 0 / ARCHITECTURE.md Section 1
**Scope:** Technical validation only. No production code written. No implementation started.

---

## Task 1 — Official Luau Parser Architecture

**Finding:** The official Luau implementation (`luau-lang/luau`, formerly `Roblox/luau`) has a real, dedicated **`Ast` module** — not a bytecode-only pipeline, not a token-stream-only lexer. Architecture is a conventional, well-separated compiler pipeline:

- **Lexer** → tokenizes source
- **Parser** (`Ast/src/Parser.cpp`) → recursive descent parser producing a **typed AST**
- **AST node types** (`Ast/include/Luau/Ast.h`) → distinct, structured node classes: `AstStat*` (statements: `AstStatIf`, `AstStatWhile`, `AstStatFunction`, `AstStatAssign`, etc.), `AstExpr*` (expressions: `AstExprCall`, `AstExprBinary`, `AstExprIfElse`, `AstExprInterpString`, etc.), `AstType*` (type annotations: `AstTypeTable`, `AstTypeError`, etc.). Each node carries proper fields (operands, locations, child pointers) — this is a real structured tree, with `Location` data on nodes (source position tracking, directly useful for tooling/diagnostics).
- **Analysis layer** (separate from parsing) → type checking and linting, built on a constraint-based solver (`ConstraintGenerator` / `ConstraintSolver`).
- **Compiler** → transforms the AST into Luau bytecode (separate concern from parsing — confirms the AST is a first-class intermediate representation, not an implementation detail collapsed into codegen).

**Confirmed via direct inspection of `Ast.h` and `Parser.cpp` source, plus Luau's own architecture documentation.**

**Relevance to Obscura:** This is exactly the shape ARCHITECTURE.md Section 2/2a assumes — Parser → AST → downstream stages. The official implementation's AST is structurally compatible with what Obscura's Binder and transforms need to walk and mutate. This is a materially stronger finding than "Roblox has a parser somewhere" — it's confirmation the parser produces the right *kind* of artifact for an obfuscator's purposes, not just a validator/compiler that discards structure after use.

---

## Task 2 — WASM Build Viability

**Finding: A WASM build path is not hypothetical — it already exists, multiple times, built by different parties using the official source.**

Confirmed evidence:
- **`luau-lang/playground`** — the **official** Luau team's own repository (under the `luau-lang` GitHub org itself), described as "a web playground for type checking, compiling, running, and inspecting Luau code." TypeScript, MIT-licensed, actively maintained (recent commit activity, open issues being triaged as of this year). This is strong evidence the Luau team itself already compiles their toolchain to run in a browser/JS environment.
- **`luau-lang/luau` has a `LUAU_BUILD_WEB` CMake option** that compiles `CLI/src/Web.cpp` with Emscripten — this is an **official, first-party build target for WASM**, not a third-party hack. Confirmed via a third-party project's documentation that explicitly references using this official CMake flag.
- **Independent third-party confirmation**: a recent (this year) research project (`pluau-wasm-pyodide`) successfully compiled the Luau VM and compiler to WebAssembly via Emscripten using the official repo as the base, producing a working `luau.wasm` (~658KB) + JS glue, runnable in both browser and `wasmtime` (server-side). This independently validates that the build process is reproducible by a third party, not a fragile one-off.
- A second independent project (`simonw/luau-wasm`) separately compiled `Luau.Ast`, `Luau.Compiler`, and **`Luau.Common`/`Luau.Ast` specifically** into a Pyodide WASM wheel — notably, this confirms the **Ast module itself** (not just the full VM) is independently compilable to WASM, which is the more relevant target for Obscura (we need parsing/AST, not full script execution).
- A maintainer comment on the official `luau-lang/luau` issue tracker (`Add Web REPL using Emscripten`, issue #177) confirms the Luau team's own stated position: *"I think the easiest path is to build Luau REPL using Emscripten to WASM... Pull requests with that functionality are welcome."* — i.e., the maintainers actively encourage and support this build path.

**Verdict: WASM build is not just realistically producible — it has already been produced, multiple times, by multiple independent parties, using official source and an official CMake build flag.** This substantially de-risks Path A relative to where the original spike plan assumed we were starting (uncertain feasibility) — feasibility is now a confirmed fact, not an open question.

---

## Task 3 — Node.js Integration Complexity

**Finding: Moderate, not low — but bounded and precedented.**

What's required:
1. Building (or reusing a build of) the `Ast`/`Compiler` subset of Luau via Emscripten, targeting Node's WASM support (not just browser).
2. A thin JS/TS binding layer to call into the compiled module and retrieve structured data back out (the existing `pluau-wasm-pyodide` project's documented work — custom output capture, `invoke_*` exception trampolines, `__cxa_*` C++ exception lifecycle handling — illustrates the real, non-trivial plumbing involved in getting clean data in/out of an Emscripten-compiled C++ module, even though that specific project targeted Python/wasmtime rather than Node).
3. Defining what crosses the WASM boundary: the cleanest approach is almost certainly **not** trying to walk a live C++ AST object graph from JS directly (expensive, fragile), but having the WASM module **serialize the AST to a flat/JSON-like structure** (or a defined binary format) that gets deserialized into a native TS object graph on the JS side. This is a known, common pattern for compiler-to-WASM integrations and is very likely how Obscura would need to consume it regardless of which WASM build is used.

**Complexity factors specific to Node (vs. browser):**
- Emscripten output targeting Node is a well-trodden, supported path (`-sENVIRONMENT=node` or similar), not exotic.
- No DOM/browser-only API dependencies expected in `Ast`/`Compiler`-only builds (these are pure C++ compiler internals — no UI surface), which reduces porting risk versus, say, porting a browser-specific tool.
- The existing `xNasuni/luau-interop` project demonstrates a JS/Node/TypeScript-targeted Luau WASM fork already exists in the wild with documented build scripts (`build_web.sh`) specifically for Web/Node interop, separate from the official playground — a second independent data point that Node targeting specifically (not just generic WASM) has precedent.

**Verdict: Real engineering work, on the order of days, not weeks, given the multiple existing reference implementations to study and adapt from — but not a trivial drop-in.** The actual Obscura-specific work is defining and implementing the **AST serialization contract** between the WASM module and TypeScript — which, notably, is required engineering work either way, since it directly produces ARCHITECTURE.md Section 2a's "versioned AST schema."

---

## Task 4 — Licensing Implications

**Finding: Clean. No conflict.**

- Luau's full implementation (`luau-lang/luau`) is distributed under the **MIT License**, confirmed directly from the repository.
- Luau is **based on Lua 5.1**, also MIT-licensed — no upstream licensing conflict inherited from Lua either.
- Roblox's official stance, stated directly in the repo: when Luau is integrated into external projects, they ask that integrators **honor the license agreement and include Luau attribution in user-facing product documentation** — a request, consistent with MIT's attribution requirement, not an additional restriction.
- This is fully compatible with Obscura's own locked MIT license (TECH_DECISIONS.md Section 3) — no dual-licensing conflict, no copyleft contamination risk, no additional legal review needed beyond standard MIT attribution in Obscura's own documentation/NOTICE file.

**Verdict: No licensing blocker. Attribution requirement is light and already consistent with Obscura's existing license posture.**

---

## Task 5 — AST Accessibility

**Finding: Strong — and unexpectedly, there's a second, more directly relevant data point beyond raw WASM.**

Two relevant access paths surfaced during this spike:

1. **Direct AST access via the C++ `Ast` module**, as established in Task 1 — `AstStat`/`AstExpr`/`AstType` node families, with real fields and `Location` data, accessible from any binding built against the `Ast`/`Compiler` libraries (confirmed buildable to WASM per Task 2/Task 5's `simonw/luau-wasm` finding, which specifically compiled `Luau.Ast` as one of its targets).

2. **`luau-lang/lute`** (the official Luau team's new standalone runtime project, actively launched and discussed this year) — this is a significant, unexpected finding. Lute is built by the Luau team itself and explicitly ships a `@std/syntax/parser` module exposing:
   - `parser.parse(source) -> ParseResult`
   - `parser.parseblock(source) -> AstStatBlock`
   - `parser.parseexpr(source) -> AstExpr`

   This is a **high-level, structured, typed AST API**, officially documented at `lute.luau.org`, explicitly built "on top of the official Luau language stack... the same parser used by Luau and Roblox." The Lute team's own public announcement states directly: *"we've exposed APIs for manipulating Luau's syntax tree, so you can write code transformations directly against the language using Lute. This is especially useful if you're working with a large Luau codebase and want powerful tooling."* This is, almost verbatim, Obscura's exact use case, described by the language's own maintainers as a supported scenario.

**Important caveat:** Lute itself is a **Luau-native runtime** (think Node/Deno, but the host language is Luau, not JS/TS) — it is not a Node.js library. It cannot be `npm install`ed and used directly inside Obscura's TypeScript codebase. Its relevance to this spike is as **strong corroborating evidence** that the official AST is well-structured, stable enough to build a public, documented transformation API on top of, and explicitly endorsed by the maintainers for exactly Obscura's use case — not as a directly consumable Node dependency. The actual Node-consumable path remains the WASM route (Task 2/3).

**Verdict: AST accessibility is strong and well-precedented, with the Lute project independently validating that the official AST is suitable for source-to-source transformation tooling specifically** — reducing concern that the AST might be too implementation-internal or unstable for external tooling to rely on.

---

## Task 6 — Maintenance Burden

**Finding: Active, frequent, professionally maintained — but genuinely fast-moving, confirming ARCHITECTURE.md Section 1a's drift-risk concern as real, not theoretical.**

- The official repo is **updated weekly** with code synced from Roblox's internal repository, per the org's own description — this is a high cadence, not a slow/abandoned project.
- Release notes inspected directly show frequent, substantive changes: new RFC-driven syntax features (e.g., `const`, `declare extern type` replacing older `declare class` syntax with an active deprecation cycle), type-system changes, compiler/bytecode versioning changes, and ongoing bug fixes — all within a recent, active release window.
- Language evolution happens via a **public RFC process** (`luau-lang/rfcs`), which is a meaningful positive for Path A specifically: grammar changes are proposed and discussed publicly before landing, giving advance visibility rather than surprise breakage — directly useful for the Language Drift Risk update strategy already defined in ARCHITECTURE.md Section 1a.
- Counter-consideration: this pace cuts both ways. A WASM binding tracking the official parser inherits this update cadence as an ongoing integration cost — if Obscura wants to stay current, the WASM build needs periodic rebuilding against new Luau releases, not a one-time integration.

**Verdict: Maintenance burden under Path A is real but manageable, and notably lower-risk than initially framed in ARCHITECTURE.md Section 1a** — because the RFC process gives visibility into changes *before* they land, and because Obscura can deliberately choose to track a specific stable Luau release/tag rather than bleeding-edge `master`, decoupling Obscura's own release cadence from Luau's weekly cadence. This is a concrete refinement to the drift-mitigation strategy, not a new risk.

---

## Task 7 — Comparison Against Path B Alternatives

**Finding: Path B is materially weaker than Path A for this project's actual requirements — this is the clearest result of the spike.**

| Candidate | Luau syntax support | Maintenance | AST quality | Verdict |
|---|---|---|---|---|
| **`luaparse`** (npm, most prominent JS/TS Lua parser) | **Lua 5.1 only.** No type annotations, no string interpolation, no `if-then-else` expressions, no Luau-specific syntax of any kind | Last published **5 years ago** — effectively unmaintained | Reasonable AST shape (Mozilla Parser API-inspired), but irrelevant given syntax gap | **Not viable as-is.** Would require Obscura to itself implement all Luau-specific grammar extensions on top of an unmaintained base — this is closer to "hand-roll the Luau-specific parts" (Path C) than genuinely adopting an existing solution. |
| **`luau-ast-rs`** (Rust, tree-sitter-based) | Targets Luau specifically, including error-tolerant parsing | Real project, but Rust — would need its own WASM compilation step or N-API binding to reach Node, i.e., **the same integration cost class as Path A**, without Path A's "is the canonical grammar authority" advantage | Good — arena-based, traversable, includes comments | Interesting **fallback candidate**, but doesn't out-compete Path A on integration cost while being a step further from the actual grammar authority (tree-sitter grammar is a third-party fork of Luau's grammar, not generated from or kept in lockstep with the official source) |
| **Loretta** (C#, multi-dialect Lua/Luau parser) | Explicitly supports Luau (Roblox Lua) | Real, maintained project | Reasonable, per its own documentation | Wrong host language entirely (C#) — would require a comparable cross-language integration effort to Path A, with less direct grammar authority than the official source |
| **Official Luau Ast/Compiler via WASM (Path A)** | **Full, authoritative, always current with Roblox's actual grammar** | Weekly upstream cadence; Obscura can pin to stable releases | Confirmed real, structured, typed AST (Task 1, Task 5) | **Strongest option** — the only candidate where "supported syntax" and "Roblox's actual grammar" are the same thing by construction, not by manual tracking |

**Verdict: No Path B candidate is actually lower-effort than Path A once "supports real, current Luau syntax" is a hard requirement** (which it must be, given Rule 9 and the Compatibility Policy in ARCHITECTURE.md Section 4a). The JS-native option (`luaparse`) fails on syntax coverage outright. The other real candidates (`luau-ast-rs`, Loretta) are in different host languages and face the same cross-language integration cost as Path A, while being a step further from the canonical grammar source. Path B does not meaningfully exist as a lower-cost alternative for Luau specifically — this is a structural feature of Luau's relative novelty as a language (unlike, say, Python or JS, which have many mature native-JS parser ports), not a research oversight.

---

## Consolidated Risks

| Risk | Severity | Notes |
|---|---|---|
| Custom WASM build/binding work still required — no existing project is a drop-in npm package for Obscura's exact need (TS-native, AST-focused, Node-targeted) | Medium | Real engineering effort remains; mitigated by multiple existing reference implementations (playground, pluau-wasm-pyodide, luau-interop, simonw/luau-wasm) to study and adapt from, rather than starting from zero |
| AST serialization contract (WASM↔JS boundary) is bespoke work either way | Low (reframed) | This was already required work per ARCHITECTURE.md Section 2a's versioned AST schema — not new scope created by choosing Path A, just where that work happens |
| Weekly upstream cadence means ongoing rebuild/sync burden if tracking latest Luau | Medium | Mitigated by pinning to stable tagged releases rather than `master`, and by the public RFC process giving advance visibility (Task 6) |
| Lute is not directly usable (Luau-native, not Node) — easy to overstate its relevance | Low | Already scoped correctly above: Lute is corroborating evidence of AST quality/suitability, not an integration path. Important not to let its existence create false confidence that "the work is already done somewhere we can just import." |
| Build toolchain adds Emscripten as a dependency for the build process (not runtime) | Low | Standard, well-documented toolchain (`emsdk`), used successfully by multiple independent third parties against this exact codebase |

---

## Recommendation

**Adopt Path A: bind to the official Luau parser/AST via a WASM build.**

This is not a marginal call — every task in this spike points the same direction:
- The official AST is real, structured, and explicitly designed to support exactly Obscura's use case (confirmed independently by the Lute project's existence and stated purpose).
- A WASM build is not a research question — it has been done successfully multiple times by independent parties using official, first-party build tooling (`LUAU_BUILD_WEB`).
- Licensing is clean and fully compatible with Obscura's existing MIT posture.
- No Path B candidate is genuinely lower-effort once real Luau syntax support is required — they either lack Luau-specific grammar entirely or carry the same cross-language integration cost as Path A while being further from the canonical source.
- Maintenance burden is real but manageable and can be deliberately decoupled from upstream's weekly cadence by pinning to stable releases.

The remaining work is genuine engineering — building/adapting a WASM target for the `Ast`/`Compiler` subset, designing the AST serialization contract into TypeScript, and integrating it into the Node toolchain — but it is bounded, precedented, and substantially de-risked by this spike's findings relative to where ARCHITECTURE.md Section 1 left it as an open question.

## Go / No-Go Decision

**GO on Path A.**

Path B is formally not recommended as a fallback in the traditional sense — this spike found no Path B candidate that would actually reduce integration effort relative to Path A while meeting the project's real syntax-coverage requirements. Path B does not need a second, separate spike; if Path A's actual implementation phase (next, not yet started) uncovers a genuine blocker, the more useful fallback comparison is **Path A's scope reduced to a stable older Luau release** (still Path A, just pinned further back) before falling to Path C, since even a slightly-behind official grammar is stronger than reimplementing Luau-specific syntax by hand.

**Path C (hand-rolled parser) is downgraded from "fallback if A and B fail" to "fallback only if Path A's WASM integration proves technically blocked"** — a meaningfully higher bar than originally scoped, since this spike found no licensing, no architectural, and no clear feasibility blocker to Path A. The remaining unknowns are implementation effort and integration polish, not viability.

---

## Required Updates to ARCHITECTURE.md Section 1 (Not Yet Applied)

This report is the spike's findings. Per the originally defined process (ROADMAP.md Milestone 0, Step 1: *"Document the decision and rationale in ARCHITECTURE.md Section 1 once resolved"*), ARCHITECTURE.md should be updated to reflect:
- Path A confirmed viable and recommended (this document's findings, condensed)
- The "Research Order" framing can be marked resolved, with Path A selected
- AST serialization contract design becomes the next concrete engineering task, feeding directly into Section 2a's schema work

**Not applied in this response per your instruction to focus only on technical validation.** Say go if you'd like ARCHITECTURE.md updated to reflect this resolved decision before proceeding further.
