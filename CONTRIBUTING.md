# Contributing to Obscura

Thanks for considering a contribution. This document is the whole process — there's no separate RFC pipeline or contributor ladder yet (see [Governance](#governance) below for why, and when that changes).

## Before You Start

- **Read [VISION.md](docs/VISION.md)** if your change touches positioning, features, or scope. Obscura is a source protection toolkit, not an obfuscator, and PRs whose primary value is exploit/cheat enablement will be declined regardless of technical merit — see [Acceptable Use](README.md#acceptable-use).
- **Check [ROADMAP.md](docs/ROADMAP.md)** and open issues before starting significant work, to avoid duplicate effort.
- For anything larger than a small fix, open an issue first describing the change. This is especially true for anything touching the AST schema, Binder rename-safety logic, or the Plugin API — these are locked/frozen surfaces (see below) and changes need discussion before code.

## Filing a Good Issue

- **Bug reports:** include the exact input `.luau` snippet, the command/options used, expected vs. actual output, and Obscura version. If the bug is behavioral (output runs differently than the input), include what you expected the Luau runtime to do.
- **Feature requests:** explain the use case, not just the feature. "I want X" is less useful than "I'm trying to do Y and X would let me."

## Development Setup

```bash
git clone https://github.com/p4inz-code/obscura.git
cd obscura
npm install
```

The real WASM parser (`packages/core/native/luau-parser.cjs`) ships pre-built — you don't need Emscripten to use or test the library day-to-day. You only need to rebuild it if you change `packages/core/native-src/ObscuraSerializer.cpp` (the canonical source — it lives here, not inside the Luau clone, since it's Obscura's own code, not Luau's):

```bash
# Clone Luau at the pinned tag and drop in our serializer
git clone --depth 1 --branch 0.701 https://github.com/luau-lang/luau.git
cp packages/core/native-src/ObscuraSerializer.cpp luau/CLI/src/ObscuraSerializer.cpp

# Rebuild the WASM parser (only needed if ObscuraSerializer.cpp changes)
cd luau && mkdir build-wasm && cd build-wasm
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF
emmake make Luau.Ast Luau.Common -j4
emcc -O2 -std=c++17 -fexceptions -I ../Ast/include -I ../Analysis/include -I ../Common/include \
    ../CLI/src/ObscuraSerializer.cpp libLuau.Ast.a libLuau.Common.a \
    -sEXPORTED_FUNCTIONS='["_obscura_parse","_malloc","_free"]' \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' \
    -sENVIRONMENT=node -sMODULARIZE=1 -sEXPORT_NAME=createObscuraModule -sSINGLE_FILE=1 \
    -o ../../packages/core/native/luau-parser.cjs
```

**Important:** the output must be named `luau-parser.cjs`, not `.js`. With `"type": "module"` in `package.json`, Node silently resolves a `.js` file as an empty ES module namespace instead of respecting the file's actual `module.exports = ...` — costly to debug, easy to avoid.

For the native test stand-in (`obscura_native`, used by the test suite for fast synchronous parsing without the async WASM init dance):

```bash
cd luau  # same clone as above, ObscuraSerializer.cpp already copied in
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF
make Luau.Ast Luau.Common Luau.Repl.CLI -j4
g++ -O2 -std=c++17 -DOBSCURA_NATIVE_TEST \
    -I ../Ast/include -I ../Common/include \
    ../CLI/src/ObscuraSerializer.cpp libLuau.Ast.a libLuau.Common.a \
    -o obscura_native

# Run tests (from repo root)
export OBSCURA_NATIVE_BIN=$(pwd)/obscura_native
export LUAU_BIN=$(pwd)/luau
cd ../../packages/core && npm test
cd ../cli && npm test
```

## The Regression Test Policy (non-negotiable)

**Every confirmed bug must produce a regression test before the fix is merge-ready. No exceptions for "obvious" fixes or time pressure.**

- Reproduce the bug first as a failing test — behavioral bugs go in `tests/golden/`, AST-shape bugs go in `tests/golden-ast/` (or both).
- The fix and its regression test land in the same PR. A fix without a test is incomplete, not just under-documented.
- Applies regardless of source: internal, external report, or CI catching it on an unrelated change.
- Regression tests are never deleted once added, even as the corpus grows. The test suite is Obscura's actual reliability record — that's the whole trust thesis. See [ARCHITECTURE.md §4](docs/ARCHITECTURE.md) for the full rationale.

## Compatibility Policy

- Supported Luau syntax is defined **empirically by golden test corpus coverage** — not by what the parser happens to handle. If a construct has no golden test, it's not a supported guarantee.
- New syntax support is additive and proven by tests, never assumed.
- Breaking changes to previously-supported syntax handling require a major version bump and changelog entry.
- Full policy: [ARCHITECTURE.md §4a](docs/ARCHITECTURE.md).

## Locked / Frozen Surfaces

These require a major version bump (or, pre-1.0, explicit maintainer sign-off) to change:

| Surface | File | Notes |
|---|---|---|
| AST schema v1 | `packages/core/src/ast.ts` | Breaking changes require a `schemaVersion` bump |
| Plugin API (`Transform`, `TransformContext`, `PipelineResult`) | `packages/core/src/plugin-api.ts` | Frozen as of v0.9.0 — see [PLUGIN_API_DESIGN.md](docs/PLUGIN_API_DESIGN.md) |
| Binder's `UnsafeReason` / `RenameClass` types | `packages/core/src/binder.ts` | Public API surface consumed by plugin authors |

If your change touches one of these, say so explicitly in the PR description and expect more scrutiny.

## Writing a Transform (Plugin API)

Third-party transforms implement the `Transform` interface — see `packages/core/plugins/noop-wrap-transform.ts` for a minimal reference implementation, and [PLUGIN_API_DESIGN.md](docs/PLUGIN_API_DESIGN.md) for the design rationale.

```typescript
interface Transform<Options, Stats> {
  readonly name: string;
  readonly description: string;
  readonly dependsOn: readonly string[];
  apply(ctx: TransformContext, options?: Options): TransformOutput<Stats>;
}
```

Rules:
- `apply()` must be side-effect free with respect to `ctx.parsed` — return a new `ObscuraParseResult`, never mutate the input.
- Declare `dependsOn` explicitly if your transform requires another to run first. `runPipeline()` validates this and throws loudly if the order is wrong — it never silently reorders.
- `name` must be unique within a pipeline.

## Code Style

- TypeScript, strict mode. `npx tsc --noEmit` must pass with zero errors before you open a PR.
- No `any` beyond what's already in the codebase (`PipelineStep.options`, etc.) — if you need it, say why in a comment.
- Match existing patterns: transforms are pure functions that deep-clone and return a new `ObscuraParseResult`; the Binder does a single O(n) walk; the Generator is a class with `emit*` methods.
- ESLint/Prettier are set up at the repo root (flat config, type-checked). `npm run lint` and `npm run format:check` must pass before you open a PR.

## Pull Request Checklist

- [ ] `npx tsc --noEmit` passes in every touched package
- [ ] `npm test` passes in every touched package
- [ ] New behavior has a test; every fixed bug has a regression test (see policy above)
- [ ] If you touched a locked surface (table above), you've called it out in the PR description
- [ ] If you added a new transform or CLI flag, the README/help text is updated to match

## License

MIT. By contributing, you agree your contributions are licensed under the same terms.

## Governance

Obscura is currently founder-led with no formal contribution process beyond this document — that's a deliberate, temporary choice, not an oversight (see [TECH_DECISIONS.md](docs/TECH_DECISIONS.md) for the full reasoning). Concretely, this means:

- There's no CLA/DCO requirement yet. That'll be decided before the first large external PR is merged, not reactively mid-review.
- There's no RFC process yet for API design proposals. One is planned to accompany future plugin-API evolution.
- This document is expected to grow as the contributor base does. If you're reading this as an early external contributor, feedback on what's missing here is itself a welcome contribution.
