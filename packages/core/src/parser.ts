/**
 * WASM parser wrapper — Milestone 0 task 0.1b
 *
 * Integration contract (enforced here, not by caller):
 *   1. Module init is async — parse() throws until init completes
 *   2. Return string from obscura_parse() is copied SYNCHRONOUSLY before any await
 *   3. obscura_parse() result with errors.length > 0 is returned, not thrown
 *   4. Non-JSON / null return from WASM is a hard throw (serializer internal error)
 *
 * To activate: place the built luau-parser.js in packages/core/native/ and
 * set WASM_BUILT=true below. Then replace the parse() stub in index.ts.
 */

import type { ObscuraParseResult } from './ast.js';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// WASM module state
// ---------------------------------------------------------------------------

const WASM_BUILT = true; // Flipped 2026-07 — see docs/BUILD_INSTRUCTIONS_0_1B.md for the build steps.

type ObscuraWasmModule = {
  cwrap: (name: string, returnType: string, argTypes: string[]) => (...args: unknown[]) => unknown;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
};

let _module: ObscuraWasmModule | null = null;
let _parseFn: ((ptr: number) => string) | null = null;
let _initPromise: Promise<void> | null = null;
let _initError: Error | null = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function initWasm(): Promise<void> {
  if (!WASM_BUILT) {
    throw new Error(
      'WASM module not built. Complete Milestone 0 task 0.1b:\n' +
        '  1. Install emsdk (https://github.com/emscripten-core/emsdk)\n' +
        '  2. Follow BUILD_INSTRUCTIONS_0_1B.md\n' +
        '  3. Copy build output to packages/core/native/luau-parser.js\n' +
        '  4. Set WASM_BUILT = true in src/parser.ts',
    );
  }

  const __dir = dirname(fileURLToPath(import.meta.url));
  const nativePath = resolve(__dir, '../native/luau-parser.cjs');

  // Dynamic require — the WASM module uses CommonJS exports
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const createModule: (opts?: object) => Promise<ObscuraWasmModule> = req(nativePath);

  _module = await createModule();

  // cwrap: (source: string) -> string
  // CRITICAL: return type is 'string' — Emscripten cwrap with 'string' return
  // automatically calls UTF8ToString on the pointer. This is a synchronous copy
  // inside cwrap itself, satisfying the "copy synchronously" contract.
  // Input uses 'number' (raw pointer), not 'string' — see writeRawBytes() below for why.
  _parseFn = _module.cwrap('obscura_parse', 'string', ['number']) as (ptr: number) => string;
}

export function ensureInit(): Promise<void> {
  if (_initError) return Promise.reject(_initError);
  if (_initPromise) return _initPromise;
  _initPromise = initWasm().catch((e: unknown) => {
    _initError = e instanceof Error ? e : new Error(String(e));
    throw _initError;
  });
  return _initPromise;
}

// ---------------------------------------------------------------------------
// Raw-byte call helper
// ---------------------------------------------------------------------------

/**
 * Call obscura_parse() with the source's raw bytes written directly into WASM
 * heap memory — NOT via cwrap's automatic string argument marshaling.
 *
 * Why: source is read as 'latin1' upstream, meaning each JS char code (0-255)
 * already IS the intended raw byte value. Emscripten's default 'string' arg
 * type calls stringToUTF8() on the way in, which re-encodes any char > 0x7F
 * as multi-byte UTF-8 — e.g. a single Latin-1 byte 0xE1 becomes the two bytes
 * 0xC3 0xA1 before the C++ parser ever sees it. That's silent, undetected
 * corruption of exactly the kind golden-fixture tests with non-ASCII content
 * exist to catch. This bypasses that entirely.
 */
function callParse(
  parseFn: (ptr: number) => string,
  mod: ObscuraWasmModule,
  source: string,
): string {
  const len = source.length;
  const ptr = mod._malloc(len + 1);
  try {
    for (let i = 0; i < len; i++) {
      mod.HEAPU8[ptr + i] = source.charCodeAt(i) & 0xff;
    }
    mod.HEAPU8[ptr + len] = 0; // null terminator — obscura_parse() takes const char*
    return parseFn(ptr);
  } finally {
    mod._free(ptr);
  }
}

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

/**
 * Parse Luau source via the WASM-compiled official Luau parser.
 *
 * Throws if:
 *   - WASM module is not built (WASM_BUILT = false)
 *   - WASM module failed to initialize
 *   - WASM returned null or non-JSON output (internal serializer error)
 *
 * Does NOT throw if the source has parse errors — returns result with
 * errors.length > 0. Callers must check errors before calling generate().
 */
export async function parse(source: string): Promise<ObscuraParseResult> {
  await ensureInit();

  if (!_parseFn || !_module) {
    throw new Error('WASM parser not initialized');
  }

  // Call into WASM via raw heap bytes (see callParse doc comment for why).
  // Return value copies synchronously via UTF8ToString — no await between
  // call and string capture; that side is safe since ObscuraSerializer.cpp's
  // JSON output is always pure ASCII (non-ASCII bytes are \u00XX-escaped).
  const raw: string = callParse(_parseFn, _module, source);

  if (!raw) {
    throw new Error('obscura_parse() returned null — WASM module may have crashed');
  }

  let result: ObscuraParseResult;
  try {
    result = JSON.parse(raw) as ObscuraParseResult;
  } catch (e) {
    throw new Error(
      `obscura_parse() returned non-JSON output.\n` +
        `First 200 chars: ${raw.slice(0, 200)}\n` +
        `JSON.parse error: ${String(e)}`,
      { cause: e },
    );
  }

  if (result.schemaVersion !== 1) {
    throw new Error(
      `Schema version mismatch: expected 1, got ${result.schemaVersion as number}. ` +
        `Rebuild the WASM module against the current ObscuraSerializer.cpp.`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Synchronous parse (for test environments where async is inconvenient)
// Only usable AFTER ensureInit() has resolved.
// ---------------------------------------------------------------------------

export function parseSync(source: string): ObscuraParseResult {
  if (!_parseFn || !_module) {
    throw new Error(
      'parseSync() called before WASM module initialized. ' + 'Call and await ensureInit() first.',
    );
  }

  const raw: string = callParse(_parseFn, _module, source);

  if (!raw) {
    throw new Error('obscura_parse() returned null');
  }

  return JSON.parse(raw) as ObscuraParseResult;
}
