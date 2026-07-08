# VISION.md — Obscura

**Status:** Architecture Phase
**Owner:** p4inz-code
**Last updated:** Day 0 (pre-implementation)

---

## 1. Why Obscura Exists

Roblox developers who want to protect their Luau source from casual extraction currently have two options: pay a recurring fee to a closed-source commercial obfuscator, or ship unprotected source. Both outcomes are bad for the ecosystem — one taxes indie developers indefinitely for a solved problem, the other leaves solo devs and students with no protection at all.

Obscura exists to make source protection a **commodity, not a product**. Once a problem is well understood, charging indefinitely for access to the solution is a tax on the ecosystem, not a sustainable business. Obscura's bet is that trust and adoption compound faster than a subscription business can, if the tool is actually good.

## 2. Positioning

**Obscura is:** a professional, open-source Luau source protection toolkit.

**Obscura is not:** a "Roblox obfuscator," an exploit tool, or a hacker-aesthetic project.

This distinction is not cosmetic — it determines the tool's entire trajectory:

| If positioned as "obfuscator" | If positioned as "source protection toolkit" |
|---|---|
| Audience = people hiding something | Audience = developers protecting IP |
| Associated with cheat/exploit communities | Associated with professional tooling (Vercel, Linear-adjacent) |
| Roblox platform relationship: adversarial | Roblox platform relationship: neutral-to-positive |
| Contributors self-select for exploit culture | Contributors self-select for tooling/compiler interest |

The positioning is a long-term moat: a "toolkit" can grow into linting, formatting, and AST tooling. An "obfuscator" cannot grow past obfuscation without an identity crisis.

## 3. Core Promise

**Premium experience. Free forever.**

No subscriptions. No premium tier. No feature paywalls. No closed-source modules. No bait-and-switch monetization.

This promise is the entire trust thesis. It is also the project's biggest constraint — see Risks below.

## 4. Target Users

- Roblox/Luau developers (primary)
- Solo developers and indie studios
- Students learning game development
- Open-source contributors interested in compiler/language tooling

## 5. Acceptable Use & Boundaries

**This section exists because obfuscation tooling is inherently dual-use, and pretending otherwise is a credibility risk, not a safety formality.**

The same transforms that protect a legitimate developer's game logic (rename, string-encode, control-flow obscure) can be used to hide malicious or exploit-enabling code from review. Obscura cannot technically distinguish intent. What it *can* do is refuse to optimize for the malicious use case.

**Obscura will not:**
- Market or document itself as a way to evade Roblox's moderation, automated script review, or anti-cheat systems.
- Add features whose primary purpose is defeating Roblox's own bytecode analysis or detection tooling (vs. general-purpose code protection).
- Integrate with or reference exploit executors, cheat engines, or injection tools.
- Optimize transform design around "undetectable by platform" as a goal. Obscura's goal is *unreadable by humans*, not *invisible to automated systems*.

**Obscura will:**
- Document this boundary publicly (README + CONTRIBUTING) so contributors and users both understand the line.
- Treat any PR or feature request whose primary value proposition is exploit/cheat enablement as out of scope, regardless of technical merit.
- Accept that some bad actors will misuse the tool regardless — the same is true of every compiler, packer, and minifier ever built. The mitigation is *positioning and community norms*, not technical prevention, because technical prevention of dual-use tooling is not achievable.

This is a documentation and governance boundary, not a technical one. It should be treated as a first-class section of the public README once the project ships, not buried in an internal doc.

## 6. Long-Term Vision (2–3 years)

```
Obscura
├── Core Engine        (parser, binder, transform pipeline)
├── CLI                (primary interface, v0.1)
├── VS Code Extension  (v0.6+, once core is stable)
├── Documentation Site (v0.5+, once there's something to document)
├── Playground         (v0.8+, deferred — see ROADMAP.md rationale)
├── Plugin System       (v0.7+, community extension point)
├── Benchmark Suite     (v0.5.5+, deferred — see ROADMAP.md rationale)
└── Future Luau Utilities (post-1.0: linting, formatting, AST tooling)
```

The long-term bet is that **Obscura becomes Luau's trusted tooling layer**, not just its obfuscator. Obfuscation is the wedge; tooling trust is the moat. This is a 2–3 year horizon, not a v1.0 deliverable, and the roadmap is sequenced accordingly (see ROADMAP.md).

## 7. Philosophy (Unchanged from Handoff)

1. Free Forever
2. Open Source Forever
3. Developer First
4. Reliability Over Features
5. Trust Over Marketing
6. Transparency Over Hype
7. Premium Experience Without Premium Cost
8. Documentation Is A Feature
9. Community Before Growth
10. Long-Term Maintainability

## 8. Success Metrics

**Not measured by:**
- Strongest obfuscator (resistance to deobfuscation)
- Largest codebase
- Most features

**Measured by:**
- Zero "Obscura broke my game" incidents in golden-test-covered scenarios
- Developers switching from paid tools (qualitative — GitHub issues, Discord, Reddit mentions)
- Documentation completeness relative to surface area
- Stable, predictable releases (no silent breaking changes)
- External contributors landing PRs (signals trust + approachable codebase)

## 9. North Star

A developer discovers Obscura, says *"Wait... this is free?"*, installs it, uses it, and never leaves — because it never breaks their game and never asks them to pay.

---

## Risks

| Risk | Severity | Notes |
|---|---|---|
| **Dual-use misuse** (malware/exploit obfuscation) | Medium | Cannot be prevented technically. Mitigated via positioning, documentation, and refusing exploit-adjacent features. A high-profile misuse incident is a realistic PR risk even with these mitigations. |
| **"Source protection" framing still implies security guarantees Obscura can't make** | Medium | Obfuscation is not encryption. A determined attacker with a deobfuscator can still extract logic. VISION and public docs must be explicit that Obscura raises the cost of extraction, not eliminates it. Overpromising here is a trust risk the moment someone deobfuscates a protected script and publicizes it. |
| **Free-forever promise vs. maintainer burnout** | High (long-term) | No revenue model means the project's continuity depends entirely on founder time/energy or eventual community governance. Not solvable today, but should be named as a known unknown rather than ignored. |
| **Positioning discipline erodes under growth pressure** | Low-Medium | Easy to drift toward "obfuscator" marketing language for SEO/discoverability reasons once growth matters. Needs to be a conscious, revisited decision, not a one-time doc. |

## Tradeoffs

- **Choosing "toolkit" positioning over "obfuscator" positioning** trades short-term discoverability (people search "roblox obfuscator," not "Luau source protection toolkit") for long-term trust and growth ceiling. This is the correct trade for a 2–3 year horizon project, wrong for a project optimizing for fast initial adoption.
- **Publishing acceptable-use boundaries publicly** trades a small amount of friction/awkwardness (acknowledging the tool *can* be misused) for credibility — silence on this topic looks naive once it inevitably comes up in a GitHub issue or Reddit thread.

## Future Implications

- If Obscura succeeds at the "trusted tooling layer" vision, the project will eventually need a governance model beyond "founder-led" (see TECH_DECISIONS.md). This should be anticipated, not retrofitted under pressure.
- Acceptable-use boundaries will need periodic revisiting as Roblox's own platform policies evolve (e.g., if Roblox changes its stance on script obfuscation generally).
