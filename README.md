# Obscura

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![CI](https://github.com/p4inz-code/obscura/actions/workflows/ci.yml/badge.svg)](https://github.com/p4inz-code/obscura/actions/workflows/ci.yml)

**A professional, open-source Luau source protection toolkit. Free forever.**

No subscriptions. No premium tier. No feature paywalls. No closed-source modules.

Obscura takes your Luau source and produces behaviorally identical, harder-to-read output — variable renaming, string encoding, constant obfuscation, and dead-code insertion, all verified against the real Luau parser and runtime so your game never breaks.

> Obscura is a **source protection toolkit**, not a "Roblox obfuscator." That distinction matters: Obscura will not market or document itself as a way to evade Roblox's moderation or anti-cheat systems, and will not add features whose primary purpose is defeating platform detection. See [Acceptable Use](#acceptable-use) below.

---

### Contents

- [Status](#status)
- [Quick Start](#quick-start)
- [What It Does](#what-it-does)
- [Usage](#usage)
- [Programmatic API](#programmatic-api)
- [Known Limitations](#known-limitations)
- [Acceptable Use](#acceptable-use)
- [Contributing](#contributing)

---

## Status

✅ **v1.0.0 — stable.** The full pipeline is real and working end-to-end: the actual official Luau parser (compiled to WASM, tag 0.701) parses your source, and the full transform pipeline + generator produce valid, behaviorally-verified output. **340/340 tests passing, 0 failures**, including a full golden-fixture corpus verified against the real Luau runtime and a CI run on real multi-core infrastructure (not just local testing).

Not yet done: publishing to npm (a deliberate later step, not a blocker — see [`docs/V1_0_0_LAUNCH_CHECKLIST.md`](docs/V1_0_0_LAUNCH_CHECKLIST.md) for the exact publish sequence). Until then, install from source — see [Quick Start](#quick-start). [`docs/ROADMAP.md`](docs/ROADMAP.md) has the longer-term feature plan (playground, VS Code extension, etc.) — note its milestone sequence predates how development actually went, see the note at the top of that file.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/p4inz-code/obscura.git
cd obscura
npm install

# Build both packages
npm run build

# Run it on a file
node packages/cli/dist/cli.js build path/to/your-script.luau --dry-run
```

That last command prints the protected output to your terminal without writing a file — drop `--dry-run` and add `-o output.luau` once you're happy with it. See [Usage](#usage) below for the full option list.

Once Obscura is published to npm (see [Status](#status)), this gets simpler:

```bash
npm install -g @obscura/cli
obscura build path/to/your-script.luau -o output.luau
```

---

## What It Does

```
Source Code
    │
    ▼
Parser              Official Luau parser (WASM), tag 0.701
    │
    ▼
Binder              Scope analysis, conservative rename-safety classification
    │
    ▼
Transform Pipeline
    ├─ Rename         Safe locals renamed to short, meaningless names
    ├─ String         "hello" → decimal/hex escapes or split concatenation
    ├─ Constant       42 → (39 + 3), true → (1 == 1), etc.
    └─ Dead Code      Provably-false, side-effect-free blocks inserted
    │
    ▼
Generator           Emits valid Luau, byte-for-byte faithful to the original
    │
    ▼
Output
```

Every transform is behaviorally verified: golden-corpus fixtures are run through the real Luau interpreter before and after each transform, and outputs must match exactly.

## Usage

```
obscura build <file.luau> [options]

OPTIONS:
  -o, --output <file>        Output file (default: <input>.obf.luau)
  --transforms <list>        Comma-separated: rename,string,constant,dead-code
  --no-rename                Disable variable renaming
  --no-string                Disable string encoding
  --no-constant              Disable constant obfuscation
  --no-dead-code             Disable dead code insertion
  --string-encoding <mode>   decimal | hex | split  (default: decimal)
  --number-encoding <mode>   arithmetic | bitwise | mixed  (default: mixed)
  --dead-code-rate <0-1>     Insertion rate (default: 0.3)
  --seed <n>                 Deterministic seed (default: 0)
  --dry-run                  Print to stdout, don't write file
  --verbose                  Show transform stats
  -v, --version              Show version
  -h, --help                 Show this help

EXAMPLES:
  obscura build game.luau
  obscura build game.luau -o game.protected.luau --verbose
  obscura build game.luau --no-dead-code --string-encoding hex
  obscura build game.luau --transforms rename,string
  obscura build game.luau --dry-run
```

## Programmatic API

```typescript
import { parse, bind, runPipeline, generate, BUILTIN_TRANSFORMS } from '@obscura/core';

const parsed = await parse(source);
const { result } = runPipeline(parsed, BUILTIN_TRANSFORMS.map(transform => ({ transform })));
const output = generate(result);
```

Third-party transforms implement the [`Transform` interface](docs/PLUGIN_API_DESIGN.md) — see `packages/core/plugins/noop-wrap-transform.ts` for a minimal example.

## Known Limitations

- **Obfuscation is not encryption.** Obscura raises the cost of reading your source; it does not make extraction impossible. A determined attacker with a deobfuscator can still recover logic. Don't rely on it as your only protection for genuinely sensitive code (licensing keys, anti-cheat secrets, etc.).
- **Type annotations are dropped.** `:: Type` assertions and generic type args are stripped from output — they're compile-time only and don't affect runtime behavior, but if you're piping output through a type checker, be aware.
- **Supported syntax = what the golden corpus empirically covers.** New Luau syntax is added when proven by tests, not assumed to work.

## Acceptable Use

The same transforms that protect a legitimate developer's game logic can, in principle, be used to hide malicious or exploit-enabling code from review. Obscura cannot technically distinguish intent — but it will not optimize for the malicious case:

- Obscura will not be marketed or documented as a way to evade Roblox's moderation, automated script review, or anti-cheat systems.
- Features whose primary purpose is defeating Roblox's own bytecode analysis or detection tooling (as opposed to general-purpose code protection) are out of scope.
- Obscura does not integrate with or reference exploit executors, cheat engines, or injection tools.
- The goal is code that's unreadable by humans, not code that's invisible to automated systems.

PRs or feature requests whose primary value proposition is exploit/cheat enablement will be declined regardless of technical merit.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
