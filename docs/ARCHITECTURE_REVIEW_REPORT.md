# ARCHITECTURE_REVIEW_REPORT.md — Obscura

**Status:** Architecture Phase — Review Checkpoint (Revision 2)
**Prepared as:** Principal Engineer / Product Architect sign-off before implementation begins
**Scope:** Synthesizes VISION.md, ARCHITECTURE.md, TECH_DECISIONS.md, ROADMAP.md after: Binder merge, AST versioning, Rule 5 revision, Milestone 0 expansion, Parser Strategy Research Spike formalization, **and this revision's additions** — Regression Test Policy, Compatibility Policy, and measurable Performance Targets.

This report does not introduce new architectural decisions beyond the three additions requested for this revision. It consolidates the current full state of all four planning documents into a single reviewable checkpoint, separating what's locked from what's still open.

---

## Top 10 Remaining Risks

Ranked by severity × likelihood, not by document order. Reordered from Revision 1 where the new policies materially change a risk's mitigation strength.

1. **Parser correctness (Critical).** Still the single highest-risk item in the project. A parser that silently mishandles modern Luau syntax produces the one failure mode — "Obscura broke my game" — that the trust thesis cannot survive. Mitigated by the Research Spike (A→B→C) being the mandatory first engineering task. Unchanged by this revision.

2. **AST schema instability / silent drift (High).** Every downstream component (Binder, transforms, generator, future plugins) depends on AST shape. Golden AST tests catch this; the new Regression Test Policy now mechanically enforces that any AST-drift bug found gets a permanent test, not just a one-off fix. Slightly de-risked by this revision.

3. **Language drift over time (Medium-High, compounding).** Luau is not a frozen spec. The new Compatibility Policy (Section 4a) now defines this risk's actual boundary precisely — supported syntax is whatever the golden corpus empirically covers, not an assumed moving target — but the *maintenance cadence* for tracking Roblox's changes still has no named owner or schedule. Partially de-risked, partially still open.

4. **Binder correctness on dynamic/stringy references (High).** `_G`, `WaitForChild("StringName")`, string-keyed table access, `require()` path patterns remain the most probable real-world bug source post-launch. The Regression Test Policy ensures every instance found becomes permanent coverage, but doesn't reduce the likelihood of the first occurrence.

5. **No defined performance ceiling before this revision (Medium → now mitigated).** Previously an open gap: nothing said what "too slow" looked like before v0.5.5. Now closed by the new Performance Targets (Parser <200ms, Binder <100ms, single transform <50ms, end-to-end <500ms for a 500-line script), checked informally starting at v0.4.0. This risk is meaningfully reduced by this revision — moved down the list accordingly.

6. **Undeclared transform ordering dependencies (Medium).** Revised Rule 5 fixes the *policy*; actual discipline still has to be enforced in code review from v0.1.0 onward, or it erodes by v0.3.0 when multiple transforms first combine. Unchanged by this revision.

7. **Golden corpus insufficient or stagnant (Medium → now mitigated by binding policy, not just stated intent).** Previously a "growth rule" stated as intent. Now a formal, merge-blocking **Regression Test Policy**: no fix merges without a new failing-then-passing test. This converts a best-effort convention into an enforceable gate — meaningfully reduces this risk's likelihood, though it still depends on review discipline holding under solo-dev time pressure.

8. **Solo-maintainer burnout across a 2–3 year, zero-revenue roadmap (High, long-term).** Not solvable architecturally, and not addressed by this revision's additions. Worth keeping visible rather than buried under technical risks.

9. **MIT license enables a closed, well-funded fork (Medium).** Accepted bet, unchanged. Risk grows in proportion to the project's own success.

10. **Governance gap surfaces reactively (Medium).** No CLA/DCO decision, no formal contribution process yet. Deferral remains safe only if CONTRIBUTING.md lands by v0.1.0 public release and the CLA/DCO decision predates the first large external PR.

**Note on dual-use misuse risk (carried from Revision 1):** still real, still mitigated only by positioning and governance discipline (VISION.md Acceptable Use section), not by anything in this revision. Remains a standing risk outside the top 10 ranking shift above only because none of this revision's additions touch it directly — not because it's resolved.

---

## Decisions Now Locked

Everything locked in Revision 1 remains locked. This revision adds three more.

**Carried from Revision 1:**
- Positioning: "Professional Luau Source Protection Toolkit," never "Roblox Obfuscator."
- Core promise: free forever, no premium tier, no closed-source core.
- License: MIT, fork-and-close tension explicitly named and accepted.
- Tech stack: TypeScript, Node.js, pnpm, TurboRepo (staged), Vitest, ESLint, Prettier, Next.js, TailwindCSS, Cloudflare Pages, GitHub Actions.
- Monorepo scope at start: `packages/core` and `packages/cli` only.
- Pipeline shape: Parser → AST → Binder → Transformation Pipeline → Code Generator → Output.
- Binder merge: Analyzer + Scope Resolver consolidated into one Binder stage.
- AST as versioned public internal contract, tested independently via golden AST tests.
- Rule 5 (revised): isolation + explicit, documented, deterministic ordering — not blanket independence.
- Milestone 0 success criteria: Parse Luau, Generate Luau, produce a stable AST, pass golden AST tests, pass behavioral equivalence tests.
- Parser Strategy Research Spike is the first engineering task, strictly ordered A → B → C.
- v0.1.0 transform scope: `RenameTransform` only.
- Benchmark strategy: performance/size/memory only, never "deobfuscation resistance."
- Acceptable Use boundaries documented as a positioning/governance boundary, not a technical one.
- Roadmap sequencing: correctness/trust milestones precede retention/marketing features.

**New this revision:**
- **Regression Test Policy:** every confirmed bug must produce a failing-then-passing regression test before its fix is merge-ready, filed under `tests/golden/` or `tests/golden-ast/` as appropriate. No exceptions for "obvious" fixes. The corpus only grows, never shrinks.
- **Compatibility Policy:** Obscura targets current stable Luau as shipped in live Roblox, with the actual supported surface defined empirically by golden corpus coverage — not a separate prose spec. New syntax support is additive and proven by tests, never assumed. Unsupported syntax must fail loud, not best-effort. Breaking changes to previously-supported syntax handling require a major version bump.
- **Performance Targets (baseline):** Parser <200ms, Binder <100ms, single transform <50ms, end-to-end <500ms, all measured against a 500-line representative script, with roughly-linear scaling verified against the large golden corpus entry. Advisory starting at v0.4.0; enforced as CI gates starting at v0.5.5.

---

## Decisions Intentionally Deferred

Unchanged from Revision 1 — restated for completeness, since this revision didn't resolve any of them.

- Splitting `core` into `parser` / `binder` / `transforms` — deferred until a second real consumer needs only part of `core`.
- `apps/docs`, `apps/website`, `apps/playground` — deferred to v0.5, v1.0, and v0.8 respectively.
- Config file system and presets — deferred to v0.2.0.
- Formal governance model (CLA/DCO, RFC process) — deferred until there's a contributor to govern; CONTRIBUTING.md itself still must land by v0.1.0 public release.
- Plugin API design — deferred until v0.7.0, after at least 4 real transforms exist.
- Benchmark Suite *implementation* — deferred to v0.5.5 (strategy and now targets are defined now; enforcement is not).
- Luau syntax sync as a named recurring roadmap item — deferred to post-v1.0 maintenance planning.

---

## Unknowns That Still Require Research

Unchanged from Revision 1, restated — this revision added policy, not research findings.

1. Does a usable WASM build (or buildable-from-source path) of Roblox's official Luau parser exist and integrate cleanly into a Node/TS toolchain? (Path A.)
2. If Path A fails: which existing JS/TS Luau parser libraries exist, and what is their actual grammar coverage, maintenance activity, and test quality?
3. What exact mechanism will be used to assert "behavioral equivalence" in the Walking Skeleton tests? Still a phrase, not a defined measurement.
4. What does the AST schema need to capture for Luau's specific constructs (type annotations, string interpolation, `task` library calls) to be both complete and stable? Depends on Path A/B/C resolution.
5. How will non-deterministic/concurrency-related code (coroutines, `task.spawn`) be tested reliably? Possibly needs property-based or fuzz-style testing eventually.
6. What's the actual maintenance cadence for monitoring Luau grammar changes once the project ships? Needs an owner and a trigger, not just a documented intention — this is now sharper given the Compatibility Policy's reliance on the golden corpus as the source of truth for supported syntax.

---

## Recommended First Coding Task

Unchanged in substance from Revision 1 — the three additions in this revision are policy and targets, not research findings, so they don't change what the first task is. They do change what "done" looks like once Milestone 0 work begins (every bug found during the spike or Walking Skeleton work is now subject to the Regression Test Policy from day one, not just from v0.1.0 onward).

**The first task remains: Parser Strategy Research Spike, Path A.**

1. Confirm whether Luau's reference implementation can be compiled to WASM (or whether a WASM build already exists publicly), and what its parser/AST surface looks like.
2. Write the smallest possible spike: feed one trivial Luau script through it from Node/TS and inspect what comes back.
3. If viable: assess effort to extract a usable AST shape from it and sketch how it would map onto the versioned schema requirement (Section 2a).
4. If not viable within the time-box (days, not weeks): move to Path B and audit existing JS/TS Luau parser libraries with the same rigor.
5. Only after A and B are both exhausted does Path C (hand-rolled, conservative, fail-loud subset) become the committed direction.

**One addition from this revision:** any issue discovered during the spike itself — even before Milestone 0 formally begins — that reveals a parser/grammar edge case worth remembering should be captured as a note toward the eventual golden corpus, even if no test can be written yet (there's no pipeline to test against during the spike itself). This keeps the Regression Test Policy's spirit ("nothing learned gets silently lost") alive from the very first task, not just from the first merged fix onward.

Still not moving into implementation — this is the recommended next task, to begin when you say go.
