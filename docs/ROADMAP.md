# ROADMAP.md — Obscura

> **⚠️ Historical planning document.** This roadmap's milestone sequence (Config System → String Obfuscation → ... → VS Code Extension → Plugin API) does **not** match what actually shipped. Development followed a different, since-revised sequence — see [`VERSION_MAP.md`](VERSION_MAP.md) for the accurate version-to-milestone mapping and [`SESSION_HANDOFF.md`](SESSION_HANDOFF.md) for current status. As of this note: v0.9.0 (release candidate) is complete, including the WASM parser, plugin API freeze, CI, and lint/format setup — none of which is reflected in the checkboxes below. Treat this file as "what we originally planned," not "what's done." Left unedited rather than force-reconciling every checkbox against a milestone structure the project no longer follows.

**Status:** Architecture Phase
**Note:** This roadmap resequences the original handoff's milestones. Nothing is removed — Playground, Benchmark Suite, VS Code Extension, and Website are all still planned. They are reordered so that **proof of correctness comes before retention/trust features**, per the risk assessment in ARCHITECTURE.md.

Each milestone includes a relative effort/risk marker. These are not calendar estimates — solo-dev time varies — they're meant to set expectations about *which milestones are actually hard* so "no feature creep" discipline has a realistic baseline to push back against.

---

## Milestone 0: Parser Strategy Research Spike + Walking Skeleton (EXPANDED — gates everything else)

**Goal:** Resolve the parser strategy, then prove the parser, AST, and code generator are trustworthy before building anything on top of them.

**Step 1 — Research Spike (do first, before any other code):**
- [ ] Path A: spike official Luau parser / WASM approach (time-boxed, days not weeks)
- [ ] Path B: if A is a dead end, audit existing Luau parser libraries in the JS/TS ecosystem
- [ ] Path C: only if A and B are both unsuitable, commit to a hand-rolled parser scoped to a conservative, documented Luau subset
- [ ] Document the decision and rationale in ARCHITECTURE.md Section 1 once resolved

**Step 2 — Walking Skeleton (success criteria):**
- [ ] **Parse Luau** — handles the full golden corpus input set, fails loud (not silent) on anything unsupported
- [ ] **Generate Luau** — code generator emits valid, runnable Luau from the AST
- [ ] **Produce a stable AST** — same input reliably produces the same AST shape, run to run
- [ ] **Pass golden AST tests** — known input asserts known, exact AST shape (ARCHITECTURE.md Section 2a)
- [ ] **Pass behavioral equivalence tests** — Parse → AST → re-emit, zero transforms, output behaviorally identical to input
- [ ] All criteria verified against the **full** golden test corpus, not a handful of hand-picked samples

**Effort/Risk:** 🔴 **Highest risk in the entire project.** This is where "Luau is harder to parse than it looks" either gets confirmed or disproven, and where the AST's stability as a long-term internal contract is established. Do not let this slip into "good enough" — a flawed parser or unstable AST invalidates every milestone after it.

**Exit criteria:** A real, unmodified Luau script goes in, comes out, and runs identically, across every golden corpus category — **and** its AST shape is asserted and stable. No transforms involved yet — this milestone is purely "can we safely read, represent, and rewrite Luau at all."

---

## v0.1.0 — Minimum Viable Obfuscation

**Goal:** Take a real Luau script, run Obscura, output valid Luau, game still works. (Per handoff: *"Nothing else matters before this works."* Now formalized as Milestone 0 + this milestone together.)

- [ ] Binder (symbol table construction, scope creation, identifier binding, reference tracking — see ARCHITECTURE.md Section 2)
- [ ] `RenameTransform` only (variables, functions, parameters) — **single transform, not three**
- [ ] CLI: basic invocation (`obscura build <file>`), no config system yet
- [ ] Golden corpus passes with `RenameTransform` applied, not just round-tripped
- [ ] Supported syntax surface documented per Compatibility Policy (ARCHITECTURE.md Section 4a) — defined by what the golden corpus actually covers, not assumed
- [ ] Regression Test Policy (ARCHITECTURE.md Section 4) in effect from this milestone onward — every bug found during v0.1.0 development gets a regression test before its fix merges

**Why scoped down from the original v0.1.0 (which included full CLI polish + all renaming categories at once):** shipping one transform that's verifiably correct against the golden corpus is more valuable than three transforms that haven't been individually proven. `StringTransform`, `ConstantTransform`, and `DeadCodeTransform` move to v0.2.0/v0.3.0 as originally planned — only the *bundling* changes, not the eventual feature set.

**Effort/Risk:** 🟠 High. Binder correctness is the main risk here — incorrectly renaming something that's referenced dynamically (e.g., via `_G`, string-based lookups, or Roblox `WaitForChild` patterns) is a real "broke my game" vector and needs dedicated golden test coverage.

---

## v0.2.0 — Config System, Presets, String Obfuscation

- [ ] Config file format (decide: JSON/TOML/JS config — not decided yet, low-risk decision deferrable to this milestone)
- [ ] Presets (e.g., "conservative," "balanced," "aggressive" — naming TBD)
- [ ] `StringTransform`
- [ ] Golden corpus expanded to cover string-heavy scripts (localization tables, large data dumps)

**Effort/Risk:** 🟡 Medium. String transform is more contained than rename — lower scope-correctness risk, but needs care around string interpolation if v0.1.0's parser strategy supports it.

---

## v0.3.0 — Constant Obfuscation, Dead Code Insertion

- [ ] `ConstantTransform`
- [ ] `DeadCodeTransform`
- [ ] Verify transforms remain isolated and side-effect-free, and that any genuine ordering dependency is explicit and documented per revised Rule 5 — run multiple transforms together against golden corpus, not just individually

**Effort/Risk:** 🟡 Medium. Main risk here isn't the individual transforms, it's **transform interaction** — this is the first milestone where multiple transforms run together, and that's exactly where any undeclared ordering dependency (ARCHITECTURE.md Section 3, 3a) would surface if one exists without being documented.

---

## v0.4.0 — Performance Improvements, CLI Polish

- [ ] Profile pipeline against golden corpus + larger real-world scripts
- [ ] Measure against baseline Performance Targets defined in ARCHITECTURE.md Section 5 (Parser <200ms, Binder <100ms, single transform <50ms, end-to-end <500ms for a 500-line script) — these become the first real checkpoint against those targets, ahead of formal CI enforcement at v0.5.5
- [ ] CLI UX polish (helpful errors, `--help`, sensible defaults)
- [ ] No new transforms — this milestone is explicitly about hardening, not features

**Effort/Risk:** 🟢 Low-Medium. Mostly polish, but "no new features" discipline matters here — this is a natural point where feature creep pressure shows up ("just one more transform before polish") and should be resisted per Rule: *Biggest Risk: Feature Creep*.

---

## v0.5.0 — Documentation Site

- [ ] `apps/docs` created (first new app — triggers monorepo expansion per TECH_DECISIONS.md Section 2)
- [ ] Document: installation, CLI usage, config reference, transform reference, **Acceptable Use boundaries (VISION.md Section 5)**
- [ ] Golden test corpus categories documented publicly (transparency = trust, per philosophy)

**Effort/Risk:** 🟢 Low (engineering), 🟡 Medium (time cost — good docs take longer than expected). "Documentation Is A Feature" per philosophy — don't treat this as a throwaway milestone.

---

## v0.5.5 — Benchmark Suite

- [ ] Implement benchmark strategy as defined in ARCHITECTURE.md Section 5
- [ ] CI integration (regression detection, not marketing numbers)
- [ ] Performance Targets (ARCHITECTURE.md Section 5) become enforced CI gates at this milestone — previously advisory checkpoints (v0.4.0) now fail the build if regressed
- [ ] Explicitly **not** a "deobfuscation resistance" benchmark — execution time, output size delta, memory usage only

**Effort/Risk:** 🟢 Low. Mechanical once the pipeline is stable.

---

## v0.6.0 — VS Code Extension

- [ ] `packages/vscode` created (second consumer of `core` — this is the trigger point for splitting `core` into `parser`/`binder`/`transforms` per TECH_DECISIONS.md Section 2, if needed)
- [ ] Basic integration: run Obscura on active file, view diff
- [ ] Live diagnostics (optional stretch — may need parser-only access to `core`, which is the actual reason this milestone might force the package split)

**Effort/Risk:** 🟠 High. First real test of whether transform isolation and package boundaries held up under a second real consumer. If `core` wasn't actually decoupled cleanly, this is where that debt surfaces.

---

## v0.7.0 — Plugin API

- [ ] Formalize transform interface as a public, stable API
- [ ] RFC process for plugin API design (TECH_DECISIONS.md Section 4 — governance gap closes here, not before)
- [ ] At least one non-trivial example community-style plugin (built in-house to dogfood the API before external contributors use it)

**Effort/Risk:** 🟠 High. API design mistakes here are expensive to fix later (breaking changes to a public plugin API erode trust). This is the milestone where transform isolation and declared ordering constraints either pay off or reveal they weren't enforced strictly enough.

---

## v0.8.0 — Playground

- [ ] Browser-based pipeline (likely requires a WASM build of `core` — new technical surface area, not just a UI task)
- [ ] Sandboxing considerations (running arbitrary user-pasted Luau through a pipeline in-browser is a new scope, not just "put the CLI in a webpage")

**Effort/Risk:** 🟠 High, and **most likely roadmap item to be over-scoped if attempted earlier than this position.** This is exactly why it was moved this late — it depends on a stable, WASM-portable core, which doesn't exist until everything before it is solid.

---

## v0.9.0 — Release Candidate

- [ ] Full golden corpus + community beta testing (if any external users/contributors exist by this point)
- [ ] Freeze plugin API surface (no more breaking changes without a major version bump going forward)
- [ ] Security/correctness audit pass

**Effort/Risk:** 🟡 Medium — mostly stabilization, but "freeze the API" is a real decision point that shouldn't be rushed.

---

## v1.0.0 — Stable Public Release

- [ ] Public announcement
- [ ] Website live (`apps/website` — last app created, deliberately, since it markets a finished product rather than a promise)
- [ ] Governance model formalized if contributor base justifies it (TECH_DECISIONS.md Section 4)

---

## Risks

| Risk | Severity | Notes |
|---|---|---|
| Parser Strategy Research Spike + Walking Skeleton (Milestone 0) takes far longer than expected | High | This is the realistic risk — if the parser strategy decision (path A vs B vs C) goes badly, the entire roadmap timeline shifts. No way to fully de-risk this in a document; it's a research spike, not a planning problem. |
| Pressure to reorder roadmap back toward original sequencing (e.g., "let's do the website earlier for marketing") | Medium | Named explicitly so it's a conscious tradeoff if it happens, not a silent drift away from "reliability before retention features" |
| v0.6 (VS Code extension) reveals `core` wasn't actually cleanly decoupled | Medium | Mitigated by isolation + explicit ordering discipline from v0.1.0 onward (ARCHITECTURE.md Section 3, 3a) — but won't be *confirmed* until v0.6 actually arrives |
| Solo-dev burnout across a 2–3 year roadmap with zero revenue | High (long-term) | Named in VISION.md Risks as well — not solvable in a roadmap doc, but shouldn't be ignored either |

## Tradeoffs

- **Moving Playground and Benchmark Suite later** trades early "wow factor" demo-ability for not building speculative infrastructure on an unproven core. Correct trade given the project's actual risk profile.
- **Single-transform v0.1.0** trades a less impressive initial feature set for a verifiably correct one. Correct trade — "RenameTransform only, but provably safe" is a better v0.1.0 than "three transforms, unverified."
- **Deferring the website to v1.0.0** trades earlier marketing/discoverability for not promoting a product that doesn't yet deserve the "this is free?!" reaction the North Star is built around. A premature website undersells the eventual product if the early version isn't polished.

## Future Scaling Considerations

- Every milestone from v0.6 onward assumes the golden test corpus has grown via the "every bug becomes a test case" rule (ARCHITECTURE.md Section 4) — if that discipline lapses early, later milestones inherit a weaker safety net than this roadmap assumes.
- The roadmap currently has no explicit "Luau grammar update" maintenance cadence built in (TECH_DECISIONS.md Section 1 risk) — this should likely become a recurring, named line item (e.g., "v0.x.y — Luau syntax sync") once v1.0.0 is reached and maintenance mode begins, rather than being silently absorbed into other milestones.
