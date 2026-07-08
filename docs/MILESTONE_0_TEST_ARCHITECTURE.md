# MILESTONE_0_TEST_ARCHITECTURE.md — Obscura

**Status:** Milestone 0 — Tasks 0.4 / 0.6 / 0.7 / 0.8
**Luau runtime:** `build/luau` compiled from pinned tag `0.701`
**Luau source corpus:** `luau-lang/luau` conformance suite (MIT licensed — directly usable)

---

## Findings

### Headless Runtime
`Luau.Repl.CLI` builds successfully from the cloned source using `cmake + g++`.
Binary: `/home/claude/obscura/luau/build/luau`
This is the **same version as the pinned parser** — behavioral equivalence testing is bytecode-matched by construction, not just semantically approximate.

### Conformance Fixture Viability
All candidate conformance fixtures run headlessly, produce deterministic stdout output, and are MIT-licensed — directly usable as corpus sources without modification.

**Excluded:** `tables.luau` — uses `_G[i] = i` mutation (hits safe-env read-only restriction in standalone runtime). This fixture is archived as a **named exclusion** because it's exactly the `_G` dynamic-write pattern the Binder must flag conservatively.

### Behavioral Equivalence Mechanism — Resolved
**Method:** run original source and round-tripped source through the same `luau` binary, capture stdout, diff. Exit code + stdout together form the equivalence signal.
- Exit code `0` + matching stdout = **PASS**
- Any diff in stdout = **FAIL**
- Non-zero exit on either = **FAIL**
- Nondeterminism: all selected fixtures are verified deterministic across consecutive runs.

**Known gap (accepted):** coroutine/`task.spawn` timing-sensitive tests may produce false equivalence positives if a transform introduces subtle scheduling differences. Not solvable at v0.1.0 without a more invasive execution harness. Flagged, not fixed.

---

## Decisions

1. **Runtime for equivalence testing:** compiled `luau` binary from pinned tag `0.701`. Not `fengari` (Lua 5.3, not Luau), not a Roblox sandbox.
2. **Equivalence signal:** stdout diff + exit code. Not deep value comparison or bytecode diff — too fragile, over-specified.
3. **Corpus source:** `luau-lang/luau` conformance suite (MIT). No external Roblox game scripts needed for v0.1.0 — conformance suite already covers all required categories.
4. **`tables.luau` exclusion is a named policy, not a gap.** Documents `_G`-write patterns as a confirmed-unsupported behavior for v0.1.0. Becomes a Binder exclusion test, not a round-trip test.
5. **Snapshot format:** Vitest `.toMatchSnapshot()` against serialized `ObscuraParseResult` (minus `source` field). Stored in `tests/golden-ast/snapshots/`.

---

## Golden Corpus Specification

Location: `tests/golden/`

### Fixture Structure
```
tests/
├── golden/
│   ├── fixtures/          # source .luau files
│   │   ├── 01-locals.luau
│   │   ├── 02-closures.luau
│   │   ├── 03-constructs.luau
│   │   ├── 04-iterators.luau
│   │   ├── 05-coroutines.luau
│   │   ├── 06-string-interp.luau
│   │   ├── 07-if-else-expr.luau
│   │   ├── 08-literals.luau
│   │   ├── 09-attributes.luau
│   │   ├── 10-trivial.luau
│   │   ├── 11-large-basic.luau
│   │   └── 12-global-access-excluded.luau  # named exclusion
│   └── expected/          # expected stdout per fixture
│       ├── 01-locals.txt
│       └── ...
└── golden-ast/
    ├── fixtures/          # same .luau source files (symlinked or copied)
    └── snapshots/         # Vitest snapshot files
        ├── 01-locals.snap.json
        └── ...
```

### Corpus Fixtures — Sourcing Map

| ID | File | Source | Lines | Category covered |
|---|---|---|---|---|
| 01 | `01-locals.luau` | `conformance/locals.luau` | 127 | Local vars, scope, shadowing |
| 02 | `02-closures.luau` | `conformance/closure.luau` | 404 | Closures, upvalues, `functionDepth` |
| 03 | `03-constructs.luau` | `conformance/constructs.luau` | 255 | Control flow: if/while/repeat/for |
| 04 | `04-iterators.luau` | `conformance/iter.luau` | 216 | `for-in`, generalized iteration |
| 05 | `05-coroutines.luau` | `conformance/coroutine.luau` | 414 | Coroutines (deterministic subset) |
| 06 | `06-string-interp.luau` | `conformance/stringinterp.luau` | 61 | `AstExprInterpString` |
| 07 | `07-if-else-expr.luau` | `conformance/ifelseexpr.luau` | 80 | `AstExprIfElse` (Luau-specific) |
| 08 | `08-literals.luau` | `conformance/literals.luau` | 180 | Number/string literal forms |
| 09 | `09-attributes.luau` | `conformance/attrib.luau` | 106 | `@native`, `@checked` attributes |
| 10 | `10-trivial.luau` | Hand-written | ~5 | Empty/minimal baseline |
| 11 | `11-large-basic.luau` | `conformance/basic.luau` | 1018 | Large script, mixed constructs |
| 12 | `12-global-access-excluded.luau` | `conformance/tables.luau` (trimmed) | ~50 | Named exclusion: `_G` mutation — parse-only, no equivalence test |

**Total runnable corpus: 11 fixtures, ~2800 lines of real Luau.**
Fixture 12 is parse-only: confirms the parser handles `_G` patterns without crashing and emits `AstExprGlobal` / `AstExprIndexExpr` nodes as expected — no equivalence test because behavior is runtime-env-dependent.

### Expected Output Generation (one-time, done before CI runs)
```
for each fixture 01–11:
  run: luau tests/golden/fixtures/XX-name.luau > tests/golden/expected/XX-name.txt
  commit both fixture and expected output
```
Expected outputs are committed, not generated at test time — they are the ground truth.

---

## Behavioral Equivalence Methodology

### What Is Tested
Round-trip: original source → `parse()` → `generate()` → run generated output → compare stdout.
No transforms applied. This is Walking Skeleton validation only.

### Test Flow (per fixture)
```
1. read fixture source
2. parse(source) → ObscuraParseResult
3. assert result.errors.length === 0  [hard stop if not]
4. generate(result.root) → generatedSource
5. write generatedSource to temp file
6. exec: luau <original-fixture>  → captureStdout(original)
7. exec: luau <temp-generated>    → captureStdout(generated)
8. assert captureStdout(original) === captureStdout(generated)
9. assert exitCode(original) === exitCode(generated) === 0
```

### Implementation Notes
- Luau binary path: resolved from env var `LUAU_BIN` → falls back to `build/luau` relative to repo root. CI must set `LUAU_BIN`.
- Temp file: `os.tmpdir()` scoped per test run, cleaned on exit.
- Timeout per fixture: 5 seconds. A hanging script is a test failure, not a wait.
- Stdout is captured as raw string. No trimming, no normalization — exact match required.

### Coroutine / Concurrency Caveat
Fixtures 05 (coroutines) run deterministically in this runtime. If any future fixture uses `task.spawn` or timer-based scheduling (not present in conformance suite), that fixture must be tagged `@nondeterministic` and excluded from stdout-diff equivalence testing until a more robust harness is in place.

---

## AST Snapshot Methodology

### What Is Tested
`parse(source)` → `ObscuraParseResult` shape is exact and stable across runs.
Catches: parser regressions, AST schema drift, serializer bugs, `localId` assignment instability.

### Snapshot Content
```json
{
  "schemaVersion": 1,
  "locals": {
    "0": { "id": 0, "name": "x", "location": {...}, "shadowId": null, "functionDepth": 0, "loopDepth": 0, "hasAnnotation": false },
    ...
  },
  "root": {
    "type": "AstStatBlock",
    "location": {...},
    "body": [...]
  },
  "errors": [],
  "hotcomments": []
}
```
`source` field excluded (input, not output-under-test).

### Update Policy
- Snapshots are committed to `tests/golden-ast/snapshots/`.
- Vitest `--updateSnapshot` must be run deliberately and its diff reviewed before merge.
- Any snapshot update is a **breaking AST change** and requires a `schemaVersion` bump if it affects the public contract surfaces defined in `AST_CONTRACT.md`.

---

## Regression Test Workflow

Per Regression Test Policy (ARCHITECTURE.md Section 4):

```
Bug reported / found
  ↓
Reproduce as minimal .luau fixture
  ↓
Add to tests/golden/fixtures/ (if behavioral) or tests/golden-ast/fixtures/ (if AST-shape)
  ↓
Confirm test FAILS before fix
  ↓
Implement fix
  ↓
Confirm test PASSES after fix
  ↓
Both fixture + fix in same PR — no exceptions
```

**Naming:** regression fixtures use prefix `reg-` followed by a short slug: `reg-upvalue-shadowing-false-rename.luau`. They live in the same `fixtures/` directory as corpus fixtures — no separate folder.

**No fix merges without a named, failing-then-passing test.** This is enforced at PR review, not by tooling (no automated block exists for this — depends on review discipline).

---

## Milestone 0 Completion Criteria

All of the following must be true simultaneously. No partial credit.

| # | Criterion | Verified by |
|---|---|---|
| 1 | `parse(source)` returns `errors: []` for all 12 corpus fixtures | Behavioral test suite, step 3 |
| 2 | `parse(source).errors` is non-empty **and test fails loudly** for a deliberately malformed fixture | Negative-case test (one hand-written invalid fixture required) |
| 3 | `generate(parse(source).root)` produces valid, runnable Luau for fixtures 01–11 | Behavioral equivalence test, step 4+9 |
| 4 | stdout(original) === stdout(generated) for all 11 runnable fixtures | Behavioral equivalence test, step 8 |
| 5 | All AST snapshots pass for all 12 fixtures | Snapshot test suite |
| 6 | AST snapshots are deterministic (same input → identical snapshot across 3 consecutive runs) | Snapshot stability check in CI |
| 7 | `localId` assignments are stable across runs for the same source (no randomness in id assignment) | Covered by criterion 6 |
| 8 | At least one regression fixture exists (`reg-*`) — even if self-created during development | Regression policy, enforced at PR |
| 9 | `LUAU_BIN` is documented in `README.md` / `CONTRIBUTING.md` | Documentation gate |
| 10 | CI runs behavioral + snapshot suites on every push | GitHub Actions gate |

**Exit criteria for "Milestone 0 DONE":** all 10 criteria pass on a clean CI run on the `main` branch. No criteria are waivable.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `luau` binary build fails on CI (no cmake/g++ by default in GitHub Actions runners) | Medium | Add `cmake` + `g++` install step to CI; or commit the binary (not ideal); or use a container. Must be resolved before CI gate (criterion 10) is meaningful. |
| Coroutine tests produce different output after codegen if any whitespace change affects `coroutine.status` string output | Low | Confirmed deterministic in current runs; actual risk is zero if generator preserves semantics exactly |
| `tables.luau` exclusion creates false confidence — the Binder test for `_G` patterns is in the named-exclusion fixture but coverage is lighter than a full equivalence test | Low-Medium | Acceptable for v0.1.0; add `_G`-write equivalence test as post-Binder regression once RenameTransform exists and the Binder's exclusion logic can be tested end-to-end |
| Snapshot files become large and noisy for 1018-line `basic.luau` | Low | Snapshot for `11-large-basic` may be split or stored compressed if size becomes a review burden; not a correctness risk |

---

## Go / No-Go

**GO. Test architecture for Milestone 0 is complete.**

- Golden corpus: 12 fixtures sourced from MIT-licensed official conformance suite. Runnable, deterministic, all required categories covered.
- Behavioral equivalence: `luau` binary (same pinned version as parser), stdout diff, exit-code match. Methodology is concrete and implemented-ready.
- AST snapshot: Vitest snapshots of `ObscuraParseResult`, `source` field excluded, committed to repo.
- Regression workflow: defined, merge-blocking by policy.
- Completion criteria: 10 explicit, binary pass/fail criteria. No ambiguity in "Milestone 0 done."

**Remaining Milestone 0 work (unblocked):**
- 0.1b: WASM build + Node integration (needs local machine with `emsdk`)
- 0.5: Code generator (`generate(ast) -> string`)
- 0.9: Wire everything together, run full corpus, achieve CI green

Say `go` to begin 0.5 (code generator).
