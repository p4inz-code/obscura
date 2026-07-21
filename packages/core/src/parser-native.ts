/**
 * Native binary parse() — for environments where WASM is not available.
 * Calls the ObscuraSerializer native binary via child_process.
 * Produces identical output to the WASM build — same C++ code, different host.
 * Used for: Milestone 0 CI on this machine before WASM build is ready.
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ObscuraParseResult } from './ast.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// Default: native test binary built from ObscuraSerializer.cpp
const NATIVE_BIN =
  process.env['OBSCURA_NATIVE_BIN'] ?? resolve(__dir, '../../../luau/build/obscura_native');

export function parseNative(source: string): ObscuraParseResult {
  // Write source to a temp file — avoids shell escaping issues with source content.
  //
  // mkdtempSync, NOT a process.pid-based path: process.pid is shared across every
  // worker_thread in the same Node process, and Vitest's default pool runs test
  // files concurrently via worker_threads. A fixed pid-based directory meant every
  // concurrent call raced on the exact same file — one test's `finally { rmSync }`
  // could delete the directory out from under another test mid-flight ("Cannot
  // open ... input.luau"), or two writes could race so a test silently read a
  // completely different test's source content. mkdtempSync atomically creates a
  // unique directory per call (OS-level guarantee, no time-of-check/time-of-use
  // window) — every invocation gets its own directory, full stop.
  const dir = mkdtempSync(resolve(tmpdir(), 'obscura-parse-'));
  const srcFile = resolve(dir, 'input.luau');

  try {
    // Write as 'latin1' (binary-safe) — source strings may contain non-UTF-8 bytes
    // from fixtures with Latin-1 encoded content (e.g. 08-literals.luau).
    writeFileSync(srcFile, source, 'latin1');
    const output = execFileSync(NATIVE_BIN, [srcFile], {
      timeout: 5000,
      maxBuffer: 32 * 1024 * 1024, // 32MB — sufficient for any real script
    });
    const result = JSON.parse(output.toString('utf-8')) as ObscuraParseResult;
    if (result.schemaVersion !== 1) {
      throw new Error(`Schema version mismatch: expected 1, got ${result.schemaVersion as number}`);
    }
    return result;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
