# OBSCURA — SESSION HANDOFF
**Date:** v0.9.0 audit-pass session end, extended through fixture restoration + a critical WASM bug fix
**Status:** Fully release-ready. v0.9.0 audit complete, 0.1b (real WASM parser) built and verified, all 11 golden fixtures restored (legitimate Luau conformance-suite excerpts, not guesses), and a real WASM byte-marshaling corruption bug found + fixed along the way. **340/340 tests passing, 0 failures.** No launch blockers remain — only npm publishing is left, which is a deliberate later step.
**Next milestone:** v1.0.0 — push to GitHub, confirm CI green on GitHub's own runners, tag it. That's it.

---

## PASTE THIS PROMPT TO START NEXT SESSION

```
You are the Principal Engineer and Technical Lead of Obscura — a professional, open-source Luau source protection toolkit. Free forever, no premium tier, no subscriptions.

Read this entire handoff before doing anything. This is a continuation of an existing multi-session development arc.

CURRENT STATE: Fully release-ready, not just "close." v0.9.0 audit pass complete, 0.1b (real WASM parser) DONE, all 11 golden fixtures restored, 340/340 tests passing (313 core + 27 cli), 0 failures. Plugin API frozen. CONTRIBUTING.md, README.md, LICENSE, CHANGELOG.md, V1_0_0_LAUNCH_CHECKLIST.md all written and accurate. ESLint/Prettier/CI all wired up and clean. Don't assume any of this is still pending — it isn't.

CRITICAL BUG FIXED THIS SESSION (read before touching parser.ts): the WASM parser's cwrap() call used Emscripten's automatic string marshaling, which silently UTF-8-re-encoded any non-ASCII source byte before the C++ parser saw it (0xE1 became 0xC3 0xA1). This was invisible to the entire prior test suite because every test used the native-binary stand-in, not the real WASM path — there was ZERO test coverage of real parse() before this session. Fixed by writing raw bytes directly into WASM heap memory (see callParse() in parser.ts). New tests/parser.test.ts covers this — don't remove it, and don't revert to cwrap's string arg type without re-reading why.

ROLE: Act as Principal Engineer. Challenge bad ideas. No blind agreement. Think 2-3 years ahead. Optimize for trust, reliability, developer experience. No feature creep. No new architecture unless it solves a real problem.

COMMUNICATION STYLE:
- Findings, not process
- Conclusions, not search logs
- Keep status updates under 5 lines
- Bullet points over long paragraphs
- No milestone recaps unless status changes
- Minimize motivational text
- Focus on execution

0.1b COMPLETION NOTES (read this before touching the parser):
- Built via emcc against Luau tag 0.701 (BUILD_INSTRUCTIONS_0_1B.md's documented command,
  used as-is, no changes needed).
- The compiled module MUST be named packages/core/native/luau-parser.cjs, NOT .js — with
  "type": "module" in package.json, Node silently resolves a .js file as an empty ES module
  namespace instead of respecting the file's actual `module.exports = ...` (CommonJS). This
  cost real debugging time; don't rename it back.
- parser.ts's WASM_BUILT flag is now true. Don't flip it back without a reason.
- Verified with a real parse() -> generate() round trip AND a full `obscura build` CLI run
  (not just unit tests) — output was byte-identical / correctly transformed.
- The SINGLE_FILE=1 build flag (already in the documented build command) avoids a separate
  known issue: Emscripten <=3.1.6's glue code misdetects Node as browser-like when Node's
  native `fetch` global is present, breaking external .wasm loading. Embedding the wasm as
  base64 sidesteps it entirely. Don't remove SINGLE_FILE=1.

NEXT TASK: v1.0.0 launch is mechanical at this point — see docs/V1_0_0_LAUNCH_CHECKLIST.md.
1. Push to GitHub (git init/add/commit/push — this sandbox has no GitHub credentials, has to run on your machine).
2. Confirm CI goes green on GitHub's own runners (not just local/sandbox verification).
3. Tag v1.0.0.
4. Whenever you're ready (not blocking v1.0.0): npm publish — exact two-step sequence
   (publish core, swap cli's file:../core dependency to a real semver range, publish cli)
   is fully documented in V1_0_0_LAUNCH_CHECKLIST.md.

Full project context in the handoff document below.
```

---

## PROJECT IDENTITY

**Name:** Obscura  
**Repo:** github.com/p4inz-code/obscura  
**Owner:** p4inz-code (Grim / Atharva Patil)  
**License:** MIT  
**Mission:** Professional Luau source protection toolkit. Free forever.  
**North Star:** Developer discovers Obscura, says "Wait... this is free?", uses it, never leaves.

---

## VERSION MAP (LOCKED)

| Version | Status | Description |
|---|---|---|
| v0.0.1 | ✅ DONE | Project scaffold |
| v0.0.2 | ✅ DONE | AST contract finalized |
| v0.0.3 | ✅ DONE | Generator complete |
| v0.0.4 | ✅ DONE | Corpus framework |
| v0.0.5 | ✅ DONE | WASM integration (0.1b — built and verified end-to-end) |
| v0.1.0 | ✅ DONE | Milestone 0 complete |
| v0.2.0 | ✅ DONE | Binder |
| v0.3.0 | ✅ DONE | Safe Rename Transform |
| v0.4.0 | ✅ DONE | String Transform |
| v0.5.0 | ✅ DONE | Constant Transform |
| v0.6.0 | ✅ DONE | Dead Code Transform |
| v0.7.0 | ✅ DONE | Plugin System |
| v0.8.0 | ✅ DONE | CLI |
| v0.9.0 | ✅ DONE | Release Candidate — audit pass, 3 bugs fixed, plugin API frozen, docs written, lint/format wired up |
| v1.0.0 | 🎯 NEXT | Stable public release — blocked only on fixture re-packaging + CI/publish setup |

---

## TECH STACK (LOCKED)

- **Language:** TypeScript
- **Runtime:** Node.js 22
- **Package Manager:** npm, using real npm workspaces at the repo root (`packages/core`, `packages/cli`) — not a sandbox workaround, this is the actual setup
- **Testing:** Vitest
- **Linting:** ESLint (flat config, type-checked) — configured, wired into CI, zero errors
- **Formatting:** Prettier — configured, wired into CI, whole codebase reformatted and verified behavior-identical
- **Luau pinned:** tag `0.701` (luau-lang/luau)
- **Parser strategy:** Path A — Official Luau WASM. **Done** (0.1b complete) — real WASM parser built and verified end-to-end, not pending

---

## REPOSITORY STRUCTURE

```
obscura/
├── package.json                 ← root npm workspaces manifest (lint/format/build/test scripts)
├── .gitignore
├── .github/workflows/ci.yml     ← builds native Luau test binary, then build/lint/format/typecheck/test
├── README.md                    ← Quick Start, usage, acceptable use — verbatim-tested
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE                      ← MIT
├── eslint.config.mjs / .prettierrc.json / .prettierignore
├── packages/
│   ├── core/                    ← Main package (@obscura/core)
│   │   ├── src/
│   │   │   ├── ast.ts           ← AST types, schema v1, AstExprRaw
│   │   │   ├── generator.ts     ← AST → Luau source
│   │   │   ├── binder.ts        ← Scope analysis, rename safety
│   │   │   ├── rename-transform.ts  ← Variable renaming
│   │   │   ├── string-transform.ts  ← String encoding (decimal/hex/split)
│   │   │   ├── constant-transform.ts ← Number/bool obfuscation
│   │   │   ├── dead-code-transform.ts ← Dead code insertion
│   │   │   ├── plugin-api.ts    ← Public Transform interface + runPipeline (FROZEN)
│   │   │   ├── builtin-transforms.ts ← 4 transforms as Transform objects
│   │   │   ├── parser.ts        ← WASM wrapper — WASM_BUILT=true, real parser, not a stub
│   │   │   ├── parser-native.ts ← Native binary wrapper (used by the test suite for speed)
│   │   │   └── index.ts         ← Public exports
│   │   ├── native/luau-parser.cjs      ← the actual compiled WASM parser, ships with the package
│   │   ├── native-src/ObscuraSerializer.cpp ← canonical source, committed here (not inside luau/)
│   │   ├── tests/                ← unit + golden-corpus tests
│   │   └── plugins/noop-wrap-transform.ts ← Example third-party plugin
│   └── cli/                     ← @obscura/cli
│       ├── src/cli.ts           ← Full CLI implementation
│       ├── bin/obscura.js       ← Entry shim
│       └── tests/cli.test.ts
├── luau/                        ← NOT committed (gitignored) — CI and CONTRIBUTING.md's dev
│                                   setup both clone this fresh at tag 0.701 when needed
└── docs/                        ← Planning documents, this handoff, launch checklist
```

---

## ARCHITECTURE (LOCKED)

### Pipeline
```
Source Code
    ↓
obscura_native / WASM (0.1b)  ← ObscuraSerializer.cpp
    ↓
ObscuraParseResult (JSON, schema v1)
    ↓
Binder                         ← binder.ts — O(n), single pass
    ↓
Transform Pipeline             ← runPipeline() via plugin-api.ts
    │  ├─ RenameTransform      ← localId-based, Binder.safeToRename
    │  ├─ StringTransform      ← AstExprRaw injection
    │  ├─ ConstantTransform    ← AstExprRaw injection, mulberry32 PRNG
    │  └─ DeadCodeTransform    ← Synthetic negative localIds
    ↓
generate()                     ← generator.ts → Luau source text
    ↓
Output
```

### Key Decisions (All Locked)
- **AST schema v1 FROZEN** — breaking changes require major version bump
- **`AstExprRaw`** — transform-only node, never emitted by parser, generator emits `.rawSource` verbatim
- **`declarationKind`** on `ObscuraLocal` — 6 values: `local|param|self|for_num|for_in|function`
- **`localId: number`** — stable integer IDs assigned by serializer pre-order DFS
- **Normalized locals table** — flat `Record<number, ObscuraLocal>`, all node refs use `localId`
- **Plugin API stable** — `Transform` interface with `name`, `dependsOn`, `apply(ctx, options)`
- **`TransformContext`** — unified interface, `binder()` lazy + cached per step
- **Ordering** — `runPipeline()` validates `dependsOn`, fails loud on wrong order, never silently reorders
- **MIT license** — accepted risk of fork-and-close as a trust/execution bet
- **No `const`/`let` in generated Luau** — generator uses only `local` per Luau conventions
- **Latin-1 fixture reading** — `readFileSync(path, 'latin1')` preserves original bytes

---

## CRITICAL TECHNICAL FACTS

### 0.1b WASM Build (LOCAL MACHINE REQUIRED)
The most important outstanding task. All tests use `obscura_native` binary as stand-in.

```bash
# Prerequisites
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh

# Build steps
cd luau  # the cloned luau-lang/luau tag 0.701
mkdir build-wasm && cd build-wasm
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF -DLUAU_BUILD_WEB=ON
emmake make Luau.ObscuraParser -j4

# Activate in parser.ts
# Set WASM_BUILT = true in packages/core/src/parser.ts
# Copy output to packages/core/native/luau-parser.js

# Activate in tests
# Set WASM_AVAILABLE = true in tests/equivalence.test.ts and tests/snapshots.test.ts
```

The `ObscuraSerializer.cpp` is at `luau/CLI/src/ObscuraSerializer.cpp` — complete, correct, with exception guard. Three bugs were fixed (AstExprInstantiate recursion, AstStatIf elseBody, AstExprTable typo). The C++ code is production-ready.

### Known Bugs Fixed (Important to Know)
1. **`--` comment ambiguity** — `-(-x)` was generating `--x`. Fixed: generator wraps inner unary minus operand in parens when outer is also unary minus
2. **Interpolated string escaping** — `\n` in backtick strings wasn't escaped. Fixed: full per-char encoding in `escapeInterpString()`
3. **String byte semantics** — chars > 0x7e were emitted as UTF-8 bytes, changing string.find() positions. Fixed: `quoteString()` emits `\xNN` for all bytes > 0x7e
4. **Split encoding precedence** — `"he" .. "llo"` without parens causes `#("he") .. "llo"`. Fixed: `encodeSplit()` always wraps in `(...)`
5. **`~` is NOT a Luau operator** — Luau has no infix bitwise operators. Fixed: ConstantTransform uses `bit32.bxor()` library function
6. **Latin-1 fixture files** — `readFileSync('utf-8')` converts 0xe1 → U+FFFD, corrupting byte-string semantics. Fixed: all fixture reads use `'latin1'` encoding

### Parser Architecture
- **AstLocal** — pre-resolved by Luau parser. `AstExprLocal.local` is a pointer to `AstLocal*`, not a name string
- **`upvalue: bool`** on `AstExprLocal` — free closure-capture signal from parser
- **Shadow chain** — `AstLocal.shadow` points to the shadowed outer binding
- **`functionDepth` + `loopDepth`** — numeric, provided by parser, scope boundary detection for free
- **NO infix bitwise operators in Luau** — use `bit32.bxor()`, `bit32.band()`, etc.
- **AstExprInstantiate** — `visit()` does NOT call `expr->visit()`, only visits typeArguments. Safe for LocalCollector (usage site only, not declaration)

### Corpus Fixtures
Located at `packages/core/tests/golden/fixtures/`

| ID | File | Mode | Notes |
|---|---|---|---|
| 01 | 01-locals.luau | full | |
| 02 | 02-closures.luau | full | Trimmed at line 158 (coroutine section removed) |
| 03 | 03-constructs.luau | full | |
| 04 | 04-iterators.luau | full | |
| 05 | 05-coroutines.luau | parse-only | coroutine.isyieldable() fails standalone |
| 06 | 06-string-interp.luau | full | |
| 07 | 07-if-else-expr.luau | full | |
| 08 | 08-literals.luau | full | Latin-1 encoded (has 0xe1 byte) |
| 09 | 09-attributes.luau | full | |
| 10 | 10-trivial.luau | full | Hand-written minimal baseline |
| 11 | 11-large-basic.luau | parse-only | _G writes + path-in-pcall incompatible |

---

## TEST SUITE

**Current verified counts: 313 tests / 11 files in `packages/core`, 27 tests / 1 file in `packages/cli`. 340/340 passing. 0 failures.**

All 11 golden fixtures are restored and verified. This is not "expected once fixtures are restored" — it's the actual, current, re-confirmed state after restoration.

Don't hand-maintain a per-file breakdown table here — it drifted out of date once already this session. To check current counts yourself:

```bash
cd packages/core && npx vitest run --reporter=verbose
cd ../cli && npx vitest run --reporter=verbose
```

`packages/core/tests/` covers: AST generation (all node types, operator precedence), Binder (all declaration kinds, `getfenv`, `_G` writes, dynamic keys, dynamic `loadstring`), Rename/String/Constant/DeadCode transforms (safety, corpus equivalence, determinism), Plugin API (`runPipeline`, `dependsOn` enforcement, lazy binder caching), golden-corpus integration/equivalence tests, and `parser.test.ts` (the real WASM `parse()` path — see the byte-marshaling bug fix above).

`packages/cli/tests/cli.test.ts` covers: CLI basics (version, help, error handling), the full corpus run through the CLI end-to-end, and every flag (`--transforms`, `--no-*`, `--string-encoding`, `--number-encoding`, `--dead-code-rate`, `--seed`, `--dry-run`, `--verbose`, `-o`).

### Running Tests
```bash
# Core tests (requires OBSCURA_NATIVE_BIN)
cd packages/core
OBSCURA_NATIVE_BIN=/path/to/luau/build/obscura_native npx vitest run

# CLI tests
cd packages/cli
OBSCURA_NATIVE_BIN=/path/to/luau/build/obscura_native npx vitest run

# Build native binary (if not already built)
cd luau && mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF
make Luau.Repl.CLI Luau.Ast -j4

# Build ObscuraSerializer native test binary
g++ -O2 -std=c++17 -DOBSCURA_NATIVE_TEST \
    -I Ast/include -I Analysis/include -I Common/include \
    CLI/src/ObscuraSerializer.cpp build/libLuau.Ast.a build/libLuau.Common.a \
    -o build/obscura_native
```

---

## PUBLIC API (@obscura/core exports)

```typescript
// Parsing — real WASM parser (0.1b complete), not stubbed
parse(source: string): Promise<ObscuraParseResult>
parseSync(source: string): ObscuraParseResult

// Binder
bind(result: ObscuraParseResult): BinderResult

// Generator
generate(result: ObscuraParseResult): string

// Transforms (direct API)
applyRenameTransform(parsed, binder, options?): RenameTransformResult
applyStringTransform(parsed, options?): StringTransformResult
applyConstantTransform(parsed, options?): ConstantTransformResult
applyDeadCodeTransform(parsed, options?): DeadCodeTransformResult

// Plugin API (v0.7.0, stable)
runPipeline(parsed, steps: PipelineStep[]): PipelineResult

// Built-in transforms (as Transform objects)
RenameTransform    // name: 'rename',    dependsOn: []
StringTransform    // name: 'string',    dependsOn: []
ConstantTransform  // name: 'constant',  dependsOn: []
DeadCodeTransform  // name: 'dead-code', dependsOn: []
BUILTIN_TRANSFORMS // ReadonlyArray of all four
```

### Transform Interface
```typescript
interface Transform<Options, Stats> {
  name: string
  description: string
  dependsOn: readonly string[]
  apply(ctx: TransformContext, options?: Options): TransformOutput<Stats>
}

interface TransformContext {
  readonly parsed: ObscuraParseResult
  binder(): BinderResult  // lazy, cached per pipeline step
}
```

### ObscuraParseResult (schema v1 FROZEN)
```typescript
interface ObscuraParseResult {
  schemaVersion: 1
  source: string
  locals: Record<number, ObscuraLocal>  // negative IDs = synthetic (transforms only)
  root: AstStatBlock
  errors: ObscuraParseError[]           // non-empty = hard stop, no transforms
  hotcomments: ObscuraHotComment[]
}

interface ObscuraLocal {
  id: number
  name: string
  location: ObscuraLocation
  shadowId: number | null
  functionDepth: number
  loopDepth: number
  hasAnnotation: boolean
  declarationKind: 'local'|'param'|'self'|'for_num'|'for_in'|'function'
}
```

### AstExprRaw (transform-only node)
```typescript
interface AstExprRaw extends ObscuraNode {
  type: 'AstExprRaw'
  rawSource: string  // emitted verbatim by generator, no escaping
}
```

---

## CLI USAGE

```bash
# Basic
obscura build game.luau
obscura build game.luau -o game.protected.luau

# Flags
obscura build game.luau --verbose
obscura build game.luau --no-dead-code
obscura build game.luau --transforms rename,string
obscura build game.luau --string-encoding hex
obscura build game.luau --number-encoding bitwise
obscura build game.luau --dead-code-rate 0.5
obscura build game.luau --seed 42
obscura build game.luau --dry-run  # stdout only, no file written

# Environment
OBSCURA_NATIVE_BIN=/path/to/obscura_native obscura build game.luau
```

---

## POLICIES (ALL LOCKED)

### Regression Test Policy
Every confirmed bug → failing test → fix → passing test, same PR. No exceptions. Tests in `tests/golden/` (behavioral) or `tests/golden-ast/` (AST shape).

### Compatibility Policy
- Supported syntax = what the golden corpus empirically covers
- New syntax support is additive + proven by tests, never assumed
- Breaking changes to supported handling = major version bump

### Performance Targets (Advisory until v0.5.5 Benchmark Suite)
- Parser: < 200ms for 500-line script
- Binder: < 100ms
- Single transform: < 50ms
- End-to-end: < 500ms
- All stages: roughly linear scaling

### Acceptable Use
Obscura is for protecting legitimate developer IP — not for evading Roblox's own moderation/detection systems. No exploit-adjacent features. This is a positioning/governance boundary, not a technical one.

---

## OUTSTANDING TASKS (PRIORITY ORDER)

### 🔴 BLOCKING v1.0.0
1. **0.1b WASM build** — emsdk on local machine, `ObscuraSerializer.cpp` → `luau-parser.js`, set `WASM_BUILT=true` in `parser.ts`

### 🟠 v0.9.0 Release Candidate
2. **CONTRIBUTING.md** — must exist before first external PR arrives
3. **README.md** — public-facing, positioning as "source protection toolkit" not "obfuscator"
4. **Full audit** — correctness pass, edge cases, security review
5. **Plugin API freeze** — no breaking changes after v0.9.0
6. **ESLint + Prettier** — configure for both packages
7. **`AstExprTypeAssertion` source-span passthrough** — currently drops `:: Type` annotation; noted as TODO in generator.ts. Not blocking but noted.

### 🟡 Post-v1.0.0
8. **Website** (`apps/website`) — last app, deliberately deferred
9. **Documentation site** (`apps/docs`) 
10. **Playground** (`apps/playground`) — requires WASM-portable core
11. **Benchmark Suite** — formal CI performance gates
12. **Luau syntax sync cadence** — monitor upstream `luau-lang/luau` for grammar changes

---

## KNOWN GAPS / NAMED DEFERRALS

- **`getfenv`/`setfenv`** in corpus: present in `11-large-basic` (parse-only). Binder policy: when detected, all renaming disabled globally.
- **Coroutine/task.spawn** in corpus: `05-coroutines` is parse-only. Concurrency-related transforms may need property-based/fuzz testing eventually.
- **String concat O(n²) in ObscuraSerializer.cpp**: 32 `out +=` sites remain after `buildLocalsJson` migration. Advisory until benchmarks flag it.
- **`AstExprInstantiate`** generic args: dropped as passthrough (type-level, not runtime). Correct for v0.1.0.
- **`AstType*` subtree**: 15 node classes, all passthrough in v0.1.0. Full serialization deferred until a transform needs type reasoning.
- **Solo-maintainer burnout**: named risk, not solvable architecturally.
- **MIT fork-and-close risk**: accepted bet, revisit if a real fork gains traction.

---

## PLANNING DOCS PRODUCED (in `docs/`)

1. `VISION.md` — mission, positioning, acceptable use boundaries
2. `ARCHITECTURE.md` — pipeline, Binder, AST contract, golden test strategy
3. `TECH_DECISIONS.md` — stack rationale, monorepo staging, license tension
4. `ROADMAP.md` — milestone sequence with effort/risk markers
5. `ARCHITECTURE_REVIEW_REPORT.md` — top 10 risks, locked/deferred decisions
6. `PARSER_STRATEGY_SPIKE.md` — Path A viability research (confirmed: GO)
7. `MILESTONE_0_IMPLEMENTATION_PLAN.md` — Walking Skeleton breakdown
8. `MILESTONE_0_TEST_ARCHITECTURE.md` — corpus spec, equivalence methodology
9. `AST_CONTRACT.md` — full schema v1 specification
10. `BUILD_INSTRUCTIONS_0_1B.md` — local WASM build instructions
11. `ANNOTATION_GAP_FINDINGS.md` — type annotation scope decision
12. `PLUGIN_API_DESIGN.md` — v0.7.0 design rationale (RFC-equivalent)
13. `VERSION_MAP.md` — canonical version history

---

## DELIVERABLES FROM THIS SESSION (DOWNLOAD)

- `obscura-core.zip` — packages/core with all 12 source files + 10 test files + plugins/
- `obscura-cli.zip` — packages/cli with CLI source + 27 tests
- `obscura-planning-docs.zip` — all 13 planning documents
- `ObscuraSerializer.cpp` — production-ready C++ WASM serializer
