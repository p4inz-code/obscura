/**
 * Test harness utilities for Obscura golden corpus testing.
 * Provides: fixture loading, Luau runtime execution, behavioral equivalence checking.
 */

import { execFileSync, ExecFileSyncOptions } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = resolve(__dir, 'golden/fixtures');
export const EXPECTED_DIR = resolve(__dir, 'golden/expected');
export const SNAPSHOTS_DIR = resolve(__dir, 'golden-ast/snapshots');

/**
 * LUAU_BIN resolution order:
 * 1. LUAU_BIN env var (CI / local override)
 * 2. Sibling luau build from cloned source (development default)
 */
export const LUAU_BIN: string = (() => {
  if (process.env['LUAU_BIN']) return process.env['LUAU_BIN'];
  const devBin = resolve(__dir, '../../../luau/build/luau');
  return devBin;
})();

// ---------------------------------------------------------------------------
// Manifest + Fixture types
// ---------------------------------------------------------------------------

export type FixtureMode = 'full' | 'parse-only';

export interface FixtureEntry {
  id: string;
  mode: FixtureMode;
  note?: string;
}

export interface Fixture {
  id: string;
  mode: FixtureMode;
  source: string;
  expectedStdout: string | null; // null for parse-only
}

export function loadManifest(): FixtureEntry[] {
  const raw = readFileSync(join(FIXTURES_DIR, 'MANIFEST.json'), 'utf-8');
  return (JSON.parse(raw) as { fixtures: FixtureEntry[] }).fixtures;
}

export function loadFixture(entry: FixtureEntry): Fixture {
  // Read as 'latin1' (binary-safe) to preserve original bytes from fixtures
  // that contain non-UTF-8 sequences (e.g. 08-literals.luau has Latin-1 encoded strings).
  // The Luau parser binary receives these bytes verbatim via the temp file.
  const source = readFileSync(join(FIXTURES_DIR, `${entry.id}.luau`), 'latin1');
  let expectedStdout: string | null = null;
  if (entry.mode === 'full') {
    expectedStdout = readFileSync(join(EXPECTED_DIR, `${entry.id}.txt`), 'utf-8');
  }
  return { id: entry.id, mode: entry.mode, source, expectedStdout };
}

export function fullFixtures(): Fixture[] {
  return loadManifest()
    .filter(e => e.mode === 'full')
    .map(loadFixture);
}

export function allFixtures(): Fixture[] {
  return loadManifest().map(loadFixture);
}

// ---------------------------------------------------------------------------
// Luau runtime execution
// ---------------------------------------------------------------------------

export interface RunResult {
  stdout: string;
  exitCode: number;
}

/** Run a .luau file through the pinned Luau binary. */
export function runFile(filePath: string, timeoutMs = 5000): RunResult {
  try {
    const opts: ExecFileSyncOptions = {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const out = execFileSync(LUAU_BIN, [filePath], opts);
    return { stdout: out.toString('utf-8'), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer; status?: number };
    const stdout = (e.stdout?.toString('utf-8') ?? '') + (e.stderr?.toString('utf-8') ?? '');
    return { stdout, exitCode: e.status ?? 1 };
  }
}

/** Write source to a temp file, run it, clean up. Returns result. */
export function runSource(source: string, label: string, timeoutMs = 5000): RunResult {
  // mkdtempSync, NOT a process.pid-based shared directory: process.pid is shared
  // across every worker_thread in the same Node process, and Vitest's default pool
  // runs test files concurrently via worker_threads. Multiple test FILES calling
  // runSource with the same fixture id as `label` (very common — every transform's
  // corpus-equivalence test loop uses fixture.id as the label) raced on the exact
  // same path, and one call's `finally { rmSync(dir) }` could delete a directory
  // another concurrent call still needed mid-flight. mkdtempSync atomically creates
  // a unique directory per call — no shared state between concurrent invocations.
  const dir = mkdtempSync(join(tmpdir(), 'obscura-test-'));
  const file = join(dir, `${label.replace(/[^a-z0-9]/gi, '_')}.luau`);
  writeFileSync(file, source, 'utf-8');
  try {
    return runFile(file, timeoutMs);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Behavioral equivalence
// ---------------------------------------------------------------------------

export interface EquivalenceResult {
  pass: boolean;
  originalStdout: string;
  generatedStdout: string;
  originalExit: number;
  generatedExit: number;
  diff: string | null;
}

export function checkEquivalence(fixture: Fixture, generatedSource: string): EquivalenceResult {
  if (fixture.mode !== 'full') {
    throw new Error(`checkEquivalence called on parse-only fixture: ${fixture.id}`);
  }

  const expected = fixture.expectedStdout!;
  const generated = runSource(generatedSource, fixture.id);

  const pass = generated.exitCode === 0 && generated.stdout === expected;

  return {
    pass,
    originalStdout: expected,
    generatedStdout: generated.stdout,
    originalExit: 0,
    generatedExit: generated.exitCode,
    diff: pass ? null : buildDiff(expected, generated.stdout),
  };
}

function buildDiff(expected: string, actual: string): string {
  const eLines = expected.split('\n');
  const aLines = actual.split('\n');
  const max = Math.max(eLines.length, aLines.length);
  const lines: string[] = ['--- expected', '+++ generated'];
  for (let i = 0; i < max; i++) {
    const e = eLines[i] ?? '<missing>';
    const a = aLines[i] ?? '<missing>';
    if (e !== a) {
      lines.push(`  line ${i + 1}:`);
      lines.push(`  - ${e}`);
      lines.push(`  + ${a}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Snapshot utilities
// ---------------------------------------------------------------------------

export interface SnapshotContent {
  locals: Record<string, unknown>;
  rootStructure: unknown;
}

/** Strip location fields recursively — used for large-fixture structural snapshots. */
export function stripLocations(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripLocations);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'location') continue;
      result[k] = stripLocations(v);
    }
    return result;
  }
  return obj;
}

/** Strip locations from locals table entries (keep id, name, shadowId, kinds). */
export function stripLocalLocations(locals: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(locals)) {
    if (v !== null && typeof v === 'object') {
      const { location: _loc, ...rest } = v as Record<string, unknown>;
      out[k] = rest;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regression test helpers
// ---------------------------------------------------------------------------

export interface RegressionFixture {
  id: string; // reg-<slug>
  source: string;
  description: string; // what bug this catches
}

export function loadRegressionFixtures(): RegressionFixture[] {
  const manifest = loadManifest();
  // Regression fixtures not in MANIFEST — discovered by glob
  // For now return empty (populated as bugs are found)
  void manifest;
  return [];
}
