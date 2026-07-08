# TECH_DECISIONS.md — Obscura

**Status:** Architecture Phase
**Purpose:** Document not just *what* was chosen, but *why*, what was considered, and what would trigger revisiting each decision.

---

## 1. Language & Runtime: TypeScript / Node.js

**Decision:** Locked, as specified.

**Why this is reasonable:** AST manipulation and source-to-source compilers are a well-trodden path in the TS/Node ecosystem (Babel, ESLint, Prettier, TypeScript's own compiler all live here). Strong typing helps a lot for a project whose entire value proposition is *correctness* — an `AST: any` bug is exactly the kind of silent failure this project can't afford.

**Alternative considered:** Rust (faster, and there's an argument for performance given large-script processing). Rejected for v1 because: ecosystem maturity for AST tooling is lower, solo-dev velocity matters more right now than runtime performance, and the existing Luau parser/AST options (if bound rather than hand-rolled — see ARCHITECTURE.md Section 1) are more likely to have usable Node bindings or WASM builds than the reverse.

**Revisit trigger:** if performance benchmarks (post-v0.5.5) show the pipeline is unacceptably slow on large real-world codebases and profiling points to language-level overhead rather than algorithmic issues.

## 2. Monorepo: TurboRepo — Staged, Not Full, From Day One

**Original handoff:** 7 packages (`core`, `parser`, `analyzer`, `transforms`, `cli`, `vscode`, `shared`) + 3 apps (`website`, `docs`, `playground`) from the start.

**Decision (modified):** Start with **`packages/core` and `packages/cli` only.** Everything else is deferred.

**Why the original plan was a mistake for a solo dev:** Setting up 10 packages' worth of build configuration, inter-package dependencies, and CI before a single line of parser logic exists means the first 1–2 weeks go to scaffolding, not to proving the hardest, riskiest part of the project (the parser) actually works. Premature structure is a classic way solo open-source projects stall before their first meaningful commit.

**Why TurboRepo at all, even staged:** the *long-term* direction (multiple packages, multiple apps) is correct — keeping it is the right call, since the eventual shape (CLI + VS Code extension both consuming `core`, docs site, etc.) genuinely benefits from monorepo tooling. The fix isn't abandoning TurboRepo, it's not paying its full setup cost before there's a second consumer to justify it.

**Staged expansion — trigger criteria (not calendar dates):**

| New package/app | Trigger |
|---|---|
| Split `core` into `parser` / `binder` / `transforms` | A second consumer needs only part of `core` (e.g., VS Code extension needing live parse/bind diagnostics without full transform pipeline) |
| `vscode` | Core + CLI are stable across the golden corpus; v0.6 per roadmap |
| `docs` (apps/) | There's enough surface area to document beyond a README — roughly v0.5 |
| `website` | Project has something to market — post v0.5, not before |
| `playground` | Core is proven stable; running untrusted-ish user input through a browser-based pipeline is itself a scope increase (sandboxing, WASM build of core) that shouldn't happen before the core itself is trustworthy |
| `shared` | Two or more packages need genuinely shared utilities — don't create this speculatively; inline duplication is cheaper than a wrong abstraction early on |

**Tradeoff accepted:** some re-plumbing work later when packages do split out. This is the correct trade — paying a small, known refactor cost later beats paying a large, speculative setup cost now for consumers that don't exist yet.

## 3. License: MIT — Kept, With Named Tension

**Decision:** MIT, as specified. Not changed.

**The tension (must be named, not ignored):** MIT permits anyone to fork Obscura, close the fork, and sell it — directly contradicting the spirit (if not the letter) of "no closed-source core" as a permanent ecosystem guarantee. MIT protects *this repository's* openness; it does not protect the *ecosystem* from a well-funded fork closing the door behind it.

**Alternatives considered:**

| License | Effect | Why not chosen (for now) |
|---|---|---|
| MIT (current) | Maximum permissiveness, maximum adoption-friendliness | Accepted risk: forkable-and-closeable |
| MPL-2.0 (file-level copyleft) | Forks must keep *modified files* open, but can combine with proprietary code elsewhere | More protection against the "close the fork" scenario, but adds friction for adoption and is a less familiar license to casual contributors |
| Dual license (MIT + commercial) | Common in dev tooling (e.g., some Sentry/GitLab-style models) | Directly contradicts "no premium tier" promise in spirit, even if structured carefully — too easy to be perceived as bait-and-switch |

**Decision rationale:** MIT is kept because the free-forever promise is fundamentally a *trust and execution* bet, not a *legal* one — a well-run, actively maintained, well-documented free tool is hard to out-compete with a closed fork in practice, license terms aside. But this is a conscious bet, not an oversight, and should be revisited if a real fork-and-close scenario ever materializes.

**Revisit trigger:** an actual closed-source fork gaining meaningful traction. Not worth re-litigating preemptively.

## 4. Governance: Founder-Led — Gap Identified

**Original handoff:** "Founder-led, Community-informed" stated as the model, with no further detail.

**Gap:** the roadmap assumes community contributors arriving by v0.6+ (plugin API, VS Code extension), but there's no contribution process, RFC mechanism, or CLA/DCO decision defined anywhere.

**Decision:** Defer formal governance structure until there's a contributor to govern — building a contribution process for a project with zero external contributors is speculative process overhead. But name the deferred items explicitly so they don't get forgotten under growth pressure:

- CONTRIBUTING.md (needed by v0.1.0 public release at the latest — even solo projects benefit from documenting "how to file a good issue")
- Decision on CLA/DCO (needed before accepting the first external PR of significant size — doesn't need to be decided now, but shouldn't be decided *reactively* mid-PR-review either)
- RFC-style process for plugin API design (needed by v0.7, since the plugin API is the first surface area where external design opinions matter)

**Revisit trigger:** first external contributor showing up with a non-trivial PR, or the plugin API milestone (v0.7), whichever comes first.

## 5. Hosting & CI/CD — Cloudflare Pages, GitHub Actions

**Decision:** Kept as specified, no changes. Both are reasonable, low-cost, low-maintenance defaults for a solo-founder OSS project. No notes — these aren't high-risk decisions.

## 6. Testing Stack — Vitest

**Decision:** Kept. Vitest is a reasonable modern default for TS projects, fast, good DX. No changes.

**Addition (not a stack change, a process addition):** Golden test corpus (ARCHITECTURE.md Section 4) runs via Vitest but is conceptually a separate test *category* from unit/integration tests — should be organized as its own test directory (`tests/golden/`) so it's clear which tests are "does the logic work" vs. "does this real script survive the pipeline unchanged in behavior."

---

## Risks

| Risk | Severity | Notes |
|---|---|---|
| MIT license enables a closed, well-funded fork to outcompete the original | Medium | Accepted bet, not ignored — see Section 3 |
| Staged monorepo expansion happens reactively/inconsistently rather than by clear trigger | Low-Medium | Mitigated by defining explicit trigger criteria now (Section 2 table) rather than "whenever it feels needed" |
| Governance gap becomes urgent reactively (e.g., a large PR arrives with no CLA decision made) | Medium | Named explicitly now so it's a known deferred item, not a surprise |
| TypeScript/Node performance becomes a real bottleneck on large scripts | Low (for now) | No evidence yet; revisit only if benchmarks (v0.5.5+) show it |

## Tradeoffs

- **Staged monorepo** trades a small future refactor cost for avoiding weeks of premature setup now. Correct trade for a solo dev's actual velocity.
- **Keeping MIT** trades airtight ecosystem protection for adoption-friendliness and simplicity. Conscious bet on execution over legal enforcement.
- **Deferring governance structure** trades "ready for contributors on day one" for not building process nobody needs yet. Correct as long as the trigger criteria (Section 4) are actually honored when the time comes, not perpetually postponed.

## Future Scaling Considerations

- Revisit license tension if Obscura gains real traction — a popular project is a more attractive fork target than an unknown one, so this risk grows with success, not independently of it.
- The package-split trigger table (Section 2) should be referenced directly when the VS Code extension milestone (v0.6) is reached — that's the most likely first real trigger for splitting `core`.
- Governance items (CONTRIBUTING.md especially) should not slip past the v0.1.0 public release, even though they're "deferred" relative to the original handoff's implied day-one scope — deferred from *immediate* doesn't mean deferred from *before launch*.
