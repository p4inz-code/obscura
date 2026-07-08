/**
 * Tests for the real WASM-backed parse() / parseSync() (src/parser.ts).
 *
 * Every other test file in this suite uses parser-native.ts (the native
 * ObscuraSerializer binary), which is a fast synchronous stand-in for local
 * dev/CI — but it does NOT exercise the actual WASM FFI boundary that
 * real users of @obscura/core hit. That gap meant a real bug (below) went
 * undetected by the entire rest of the suite. This file exists specifically
 * to close that gap.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parse, parseSync, ensureInit } from '../src/parser.js';
import { generate } from '../src/generator.js';

beforeAll(async () => {
  await ensureInit();
});

describe('parse() — basic sanity', () => {
  it('parses simple source with no errors', async () => {
    const result = await parse('local x = 1\nprint(x)\n');
    expect(result.errors).toEqual([]);
    expect(result.schemaVersion).toBe(1);
  });

  it('round-trips ASCII source through parse -> generate byte-identically', async () => {
    const source = 'local x = 1\nprint(x + 2)\n';
    const result = await parse(source);
    expect(generate(result)).toBe(source);
  });

  it('parseSync works after ensureInit has resolved', () => {
    const result = parseSync('local y = 2\n');
    expect(result.errors).toEqual([]);
  });
});

describe('regression — WASM string marshaling byte corruption', () => {
  // Bug: cwrap('obscura_parse', 'string', ['string']) used Emscripten's
  // automatic argument marshaling, which calls stringToUTF8() on the way in.
  // Source strings here are latin1-decoded (each JS char code 0-255 IS the
  // intended raw byte), so any char > 0x7F got silently re-encoded as
  // multi-byte UTF-8 before the C++ parser ever saw it — e.g. a single byte
  // 0xE1 became the two bytes 0xC3 0xA1. Fixed by writing raw bytes directly
  // into WASM heap memory (see callParse() in parser.ts) instead of relying
  // on cwrap's string argument type. Found via real golden-fixture content
  // (literals.luau's Latin-1 test strings) failing full pipeline round-trip
  // despite parsing without errors — the corruption was silent.
  it('preserves a single high Latin-1 byte through parse -> generate without UTF-8 re-encoding', async () => {
    // '\u00e1' as a JS string char here represents the single raw byte 0xE1,
    // matching how harness.ts reads fixture files (readFileSync(path, 'latin1')).
    const source = 'local s = "v\u00e1rias"\nprint(s)\n';
    const result = await parse(source);
    expect(result.errors).toEqual([]);
    const generated = generate(result);
    // Must emit \xe1 (single raw byte), NOT \xc3\xa1 (UTF-8 re-encoding of the
    // same character) — the latter is exactly the corruption this test catches.
    expect(generated).toContain('\\xe1');
    expect(generated).not.toContain('\\xc3\\xa1');
  });

  it('preserves multiple non-ASCII bytes in the same string', async () => {
    const source = 'local s = "caf\u00e9 na\u00efve r\u00e9sum\u00e9"\nprint(s)\n';
    const result = await parse(source);
    expect(result.errors).toEqual([]);
    const generated = generate(result);
    for (const byte of [0xe9, 0xef, 0xe9, 0xe9]) {
      expect(generated).toContain(`\\x${byte.toString(16)}`);
    }
  });

  it('long strings with embedded non-ASCII content still execute correctly after round-trip', async () => {
    // Regression case as originally found: a long-bracket string containing
    // Latin-1 content, later executed via loadstring/dostring. Corruption
    // here doesn't show up as a parse error — it shows up as a runtime
    // assertion failure inside the dynamically-loaded code, which is exactly
    // why it went undetected until an actual behavioral equivalence check.
    const source = [
      'local prog = "print(1)\\na1 = [[v\u00e1rias]]\\nassert(string.len(a1) == 6)\\nprint(2)"',
      'local function dostring(x) return assert(loadstring(x))() end',
      'dostring(prog)',
      '',
    ].join('\n');
    const result = await parse(source);
    expect(result.errors).toEqual([]);
    const generated = generate(result);
    expect(generated).toContain('\\xe1');
  });
});
