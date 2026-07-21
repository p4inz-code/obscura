# Changelog

All notable changes to Obscura are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows the compatibility policy in [ARCHITECTURE.md](docs/ARCHITECTURE.md) — supported Luau syntax is defined empirically by golden test corpus coverage.

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-07

First stable release. Everything below shipped as part of getting here — the WASM parser, the full golden-fixture corpus, and three real bugs found and fixed along the way (one of them on the very first push to real CI).

### Fixed (found on first GitHub CI push)
- **Critical: test-harness temp files raced under real concurrency, corrupting test results on CI.** `parser-native.ts`, `tests/harness.ts`, and `packages/cli/src/cli.ts` all built temp file paths from `process.pid` (e.g. `obscura-parse-${process.pid}`). This is **not** a safe uniqueness key: `process.pid` is shared across every `worker_thread` in the same Node process, and Vitest's default pool runs test files concurrently via `worker_threads` — so every concurrent call raced on the exact same file path. One call's `finally { rmSync(dir) }` cleanup could delete a directory another concurrent call still needed mid-flight ("Cannot open ... input.luau"), and two writes racing without a delete in between meant a test could silently execute a *different test's* source content (surfaced on GitHub's CI as e.g. `01-locals` producing `"HELLO"` instead of its actual expected output — cross-contamination, not a logic bug). This was invisible in local/sandbox testing, which didn't race hard enough to trigger it every time; GitHub's real multi-core runners exposed it on the very first push, with 115 of 340 tests failing. Fixed by switching all three call sites from a fixed pid-based path to `mkdtempSync()`, which atomically creates a guaranteed-unique directory per call — no shared mutable state between concurrent invocations, so the race is structurally impossible rather than just less likely. Verified with a direct `worker_threads` stress test mimicking Vitest's exact concurrency model: the old code failed **30/30** concurrent calls (100% corruption rate); the fix passed **30/30**.

- **Critical: WASM parser silently corrupted non-ASCII/binary source bytes.** `parser.ts` used Emscripten's `cwrap(..., 'string', ['string'])`, which automatically UTF-8-encodes the input argument. Since source is read as `'latin1'` upstream (each JS char code 0-255 is meant to be the literal raw byte), any byte > 0x7F was silently re-encoded as multi-byte UTF-8 before the C++ parser ever saw it — e.g. a single byte `0xE1` became the two bytes `0xC3 0xA1`. This was invisible to the entire existing test suite because every other test used `parser-native.ts` (a native binary stand-in that doesn't cross the WASM FFI boundary at all) — there was no test coverage of the real WASM `parse()` path whatsoever. Found via real Latin-1 content (restoring the golden fixture corpus, below) failing full pipeline round-trip despite parsing without errors — the corruption was silent, not a parse error. Fixed by writing raw bytes directly into WASM heap memory instead of relying on cwrap's automatic string marshaling. Added `tests/parser.test.ts` — the first dedicated test file for the real WASM `parse()`/`parseSync()` — including regression tests verified to actually fail against the buggy version before being confirmed against the fix.

- **`obscura --version` reported a hardcoded, already-stale `v0.0.1-dev`.** The CLI's `VERSION` constant was a literal string, completely disconnected from `package.json` — this would have shipped v1.0.0 self-reporting as v0.0.1-dev. Fixed by reading the version from `package.json` dynamically at runtime, so it can't drift again. The existing test only checked the output matched `/obscura v/` — a pattern loose enough to pass on the wrong value, which is exactly how this went unnoticed. Strengthened the test to check the actual value against `package.json`; verified it fails against the reverted bug before confirming the fix.

### Added
- Restored all 9 missing golden fixture `.luau` files (`01-locals`, `03-constructs`, `04-iterators`, `05-coroutines`, `06-string-interp`, `07-if-else-expr`, `08-literals`, `09-attributes`, `11-large-basic`). Not reconstructed guesses — these are legitimate excerpts of Luau's own official conformance test suite (`luau/tests/conformance/*.luau`, pinned tag 0.701), trimmed to reproduce the exact pre-existing `expected/*.txt` outputs, and verified via the real parser + real Luau runtime, not just written and hoped for.

### Summary
Full test suite at release: **340/340 passing, 0 failures** (313 core + 27 cli). All four bugs above were found via real verification, not assumed away — the golden corpus, a direct GitHub CI push, a targeted `worker_threads` stress test, and a manual sweep while bumping version numbers (which also exposed that the existing `--version` test was too loose to have caught it).

## [0.9.0] — 2026-07

Release-candidate audit pass. No new user-facing features — this release is entirely about correctness, tooling, and closing out the last blocker before v1.0.0.

### Added
- Plugin API (`Transform`, `TransformContext`, `PipelineResult`) formally frozen — reviewed line-by-line, confirmed correct. Further changes require a major version bump.
- ESLint (flat config, type-checked) + Prettier, wired up as npm workspaces at the repo root. `npm run lint` / `lint:fix` / `format` / `format:check`.
- GitHub Actions CI (`.github/workflows/ci.yml`) — builds the native Luau test binary from source, then runs build, lint, format-check, typecheck, and test across both workspaces. Validated end-to-end via local simulation before merging.
- `CONTRIBUTING.md`, `LICENSE` (MIT), this `CHANGELOG.md`, `docs/V1_0_0_LAUNCH_CHECKLIST.md`.
- `.gitignore` — previously missing entirely; without it, a first commit would have included `node_modules`, `dist`, and other build artifacts.
- Publish-readiness metadata (`description`, `keywords`, `license`, `author`, `repository`, `bugs`, `homepage`, `files` allowlist, `engines: node>=22`) added to both `packages/core/package.json` and `packages/cli/package.json`.

### Fixed
- **`binder.ts`:** `hasDynamicLoadstring` was computed but never enforced — locals stayed renameable even when the script had a dynamic `loadstring()`/`load()` call in scope. Now correctly marks all locals unsafe, matching the existing `hasGetfenv` behavior. New `dynamic_loadstring_in_scope` unsafe reason.
- **`generator.ts`:** `escapeInterpString()` used `\u{XX}` (Unicode codepoint escape, UTF-8-encoded at runtime) for high bytes in interpolated strings instead of `\xNN` (raw byte) — silently changed byte length for any Latin-1/high-byte source, the same class of bug already fixed in `quoteString()` for regular strings. Now consistent between both.
- **`string-transform.ts`:** `isRequire` detection matched *any* call through a local variable, not just one named `require` — silently exempted the first string argument of extremely common call patterns (callbacks, event handlers, aliased helpers) from string encoding. Now resolves the local's actual declared name.
- **`parser.ts`:** a re-thrown JSON parse error didn't chain `cause`, losing the original error/stack for callers. Now attaches it.

### Changed
- `README.md` rewritten: added a Quick Start (tested verbatim, not just written), a table of contents, badges, and corrected stale status claims.

### Removed
- Dead `referenced_via_global_name` `UnsafeReason` variant — declared and documented, never implemented, removed before the Plugin API froze.
- Assorted dead code found during the audit: a vestigial always-`false` parameter threaded through `binder.ts`'s `walkBlock` and 8 call sites, two unused type imports, a duplicate/dead alphabet constant in `rename-transform.ts`, and dead imports/variables across several test files.
- Two stale per-package `package-lock.json` files (leftover from before the npm-workspaces setup) — a single root-level lockfile is the correct, non-conflicting source of truth for a workspace.

## [0.1b] — 2026-07

The real WASM-compiled Luau parser (tag 0.701), replacing the native-binary test stand-in as `parse()`'s actual implementation.

### Added
- `packages/core/native/luau-parser.cjs` — compiled via `emcc` against `packages/core/native-src/ObscuraSerializer.cpp`. See `docs/BUILD_INSTRUCTIONS_0_1B.md` and `CONTRIBUTING.md` for the build steps.
- `packages/core/native-src/ObscuraSerializer.cpp` given a permanent home in the repo (previously only existed inside the third-party Luau clone, which isn't committed).

### Fixed
- The compiled module must be named `luau-parser.cjs`, not `.js` — with `"type": "module"` in `package.json`, Node was silently resolving a `.js` file as an empty ES module namespace instead of respecting its actual `module.exports = ...`.
- Emscripten ≤3.1.6's generated glue code misdetects Node as browser-like when Node's native `fetch` global is present (Node 18+), breaking external `.wasm` file loading via a broken `fetch()` call. The `-sSINGLE_FILE=1` build flag (already in the documented build command) sidesteps this by embedding the wasm as base64, avoiding external file loading entirely.

### Changed
- `parser.ts`: `WASM_BUILT` flag flipped to `true`. `parse()` now runs the real parser, verified via a `parse()` → `generate()` round trip and a full `obscura build` CLI run.

## [0.8.0] and earlier

Not retroactively documented — this changelog starts at v0.9.0. See `docs/SESSION_HANDOFF.md`'s Version Map for a summary of what shipped in each earlier version.
