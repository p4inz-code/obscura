/**
 * CLI integration tests — v0.8.0
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dir = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dir, '../../../'); // tests/ -> cli/ -> packages/ -> obscura/
const CLI = resolve(__dir, '../dist/cli.js');
const LUAU = resolve(REPO_ROOT, 'luau/build/luau');
const NATIVE = resolve(REPO_ROOT, 'luau/build/obscura_native');
const FIXTURES = resolve(REPO_ROOT, 'packages/core/tests/golden/fixtures');
const EXPECTED = resolve(REPO_ROOT, 'packages/core/tests/golden/expected');

function runCli(args: string[], input?: string): { stdout: string; stderr: string; exit: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, OBSCURA_NATIVE_BIN: NATIVE },
      timeout: 10000,
      encoding: 'utf-8',
      input,
    });
    return { stdout, stderr: '', exit: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exit: e.status ?? 1,
    };
  }
}

function runLuau(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'obscura-cli-test-'));
  const file = join(dir, 'input.luau');
  try {
    writeFileSync(file, source, 'utf-8');
    return execFileSync(LUAU, [file], { encoding: 'utf-8', timeout: 5000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildAndRun(fixture: string, cliArgs: string[] = []): string {
  const result = runCli(['build', join(FIXTURES, fixture), '--dry-run', ...cliArgs]);
  expect(result.exit, `CLI failed for ${fixture}: ${result.stderr}`).toBe(0);
  return runLuau(result.stdout);
}

// ---------------------------------------------------------------------------

describe('CLI basics', () => {
  it('--version outputs version string', () => {
    const r = runCli(['--version']);
    expect(r.exit).toBe(0);
    expect(r.stdout).toMatch(/obscura v/);
  });

  it('--help outputs usage', () => {
    const r = runCli(['--help']);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('USAGE:');
    expect(r.stdout).toContain('--transforms');
    expect(r.stdout).toContain('--dry-run');
  });

  it('unknown command exits non-zero', () => {
    const r = runCli(['unknown']);
    expect(r.exit).not.toBe(0);
    expect(r.stderr).toContain('Unknown command');
  });

  it('missing file exits non-zero', () => {
    const r = runCli(['build']);
    expect(r.exit).not.toBe(0);
  });

  it('nonexistent file exits non-zero', () => {
    const r = runCli(['build', '/nonexistent/file.luau']);
    expect(r.exit).not.toBe(0);
    expect(r.stderr).toContain('Cannot read');
  });

  it('unknown flag exits non-zero', () => {
    const r = runCli(['build', join(FIXTURES, '10-trivial.luau'), '--unknown-flag']);
    expect(r.exit).not.toBe(0);
    expect(r.stderr).toContain('Unknown option');
  });
});

describe('CLI --dry-run outputs valid Luau', () => {
  const fixtures = [
    '01-locals',
    '02-closures',
    '03-constructs',
    '04-iterators',
    '06-string-interp',
    '07-if-else-expr',
    '08-literals',
    '09-attributes',
    '10-trivial',
  ];

  for (const f of fixtures) {
    it(`${f}: output matches expected stdout`, () => {
      const expected = readFileSync(join(EXPECTED, `${f}.txt`), 'utf-8');
      const actual = buildAndRun(`${f}.luau`);
      expect(actual).toBe(expected);
    });
  }
});

describe('CLI flags', () => {
  it('--transforms rename only', () => {
    const r = runCli([
      'build',
      join(FIXTURES, '10-trivial.luau'),
      '--dry-run',
      '--transforms',
      'rename',
    ]);
    expect(r.exit).toBe(0);
    expect(runLuau(r.stdout).trim()).toBe('2');
  });

  it('--no-rename preserves variable names', () => {
    const r = runCli(['build', join(FIXTURES, '10-trivial.luau'), '--dry-run', '--no-rename']);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('local x');
  });

  it('--string-encoding hex', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obscura-test-'));
    const src = join(dir, 'test.luau');
    writeFileSync(src, 'print("hello")\n', 'utf-8');
    try {
      const r = runCli(['build', src, '--dry-run', '--string-encoding', 'hex']);
      expect(r.exit).toBe(0);
      expect(r.stdout).toMatch(/\\x68|\\x65/); // h or e in hex
      expect(runLuau(r.stdout).trim()).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--string-encoding split', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obscura-test-'));
    const src = join(dir, 'test.luau');
    writeFileSync(src, 'print("hello world")\n', 'utf-8');
    try {
      const r = runCli(['build', src, '--dry-run', '--string-encoding', 'split']);
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain('..');
      expect(runLuau(r.stdout).trim()).toBe('hello world');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--number-encoding bitwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obscura-test-'));
    const src = join(dir, 'test.luau');
    writeFileSync(src, 'print(42)\n', 'utf-8');
    try {
      const r = runCli(['build', src, '--dry-run', '--number-encoding', 'bitwise']);
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain('bit32.bxor');
      expect(runLuau(r.stdout).trim()).toBe('42');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--dead-code-rate 0 inserts nothing', () => {
    const r = runCli([
      'build',
      join(FIXTURES, '10-trivial.luau'),
      '--dry-run',
      '--dead-code-rate',
      '0',
    ]);
    expect(r.exit).toBe(0);
    expect(r.stdout).not.toMatch(/1 == 2|5 ~= 5|10 < 1/);
  });

  it('--seed produces deterministic output', () => {
    const f = join(FIXTURES, '01-locals.luau');
    const a = runCli(['build', f, '--dry-run', '--seed', '7']);
    const b = runCli(['build', f, '--dry-run', '--seed', '7']);
    expect(a.stdout).toBe(b.stdout);
  });

  it('different --seed may produce different output', () => {
    const f = join(FIXTURES, '01-locals.luau');
    const a = runCli(['build', f, '--dry-run', '--seed', '1']);
    const b = runCli(['build', f, '--dry-run', '--seed', '9999']);
    // Same transforms, different seeds — extremely likely to differ on a 127-line fixture
    expect(a.stdout).not.toBe(b.stdout);
  });

  it('--verbose shows per-transform stats', () => {
    const r = runCli(['build', join(FIXTURES, '10-trivial.luau'), '--dry-run', '--verbose']);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('rename:');
    expect(r.stdout).toContain('string:');
    expect(r.stdout).toContain('constant:');
    expect(r.stdout).toContain('dead-code:');
  });
});

describe('CLI output file', () => {
  it('writes .obf.luau by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obscura-out-'));
    const src = join(dir, 'test.luau');
    const out = join(dir, 'test.obf.luau');
    writeFileSync(src, 'print("ok")\n', 'utf-8');
    try {
      const r = runCli(['build', src]);
      expect(r.exit).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(runLuau(readFileSync(out, 'utf-8')).trim()).toBe('ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('-o writes to specified path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obscura-out-'));
    const src = join(dir, 'test.luau');
    const out = join(dir, 'custom-output.luau');
    writeFileSync(src, 'print("custom")\n', 'utf-8');
    try {
      const r = runCli(['build', src, '-o', out]);
      expect(r.exit).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(runLuau(readFileSync(out, 'utf-8')).trim()).toBe('custom');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('success message includes size info', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obscura-out-'));
    const src = join(dir, 'test.luau');
    writeFileSync(src, 'local x = 42\nprint(x)\n', 'utf-8');
    try {
      const r = runCli(['build', src]);
      expect(r.exit).toBe(0);
      expect(r.stdout).toMatch(/→.*\.obf\.luau.*B →.*B/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
