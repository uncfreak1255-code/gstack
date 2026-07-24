/**
 * gstack-slug SLUG_SOURCE signal.
 *
 * gstack-slug falls back to basename($PWD) when the cwd has no git remote.
 * That fallback is silent, so a /context-save in a non-git dir lands in a
 * per-folder junk bucket and a later /context-restore from the real repo
 * never finds it. gstack-slug now emits an eval-safe `SLUG_SOURCE` line
 * (git | basename-fallback) so context-save / context-restore can warn.
 *
 * These tests pin: (1) the signal is correct in a repo-with-remote vs a
 * non-git dir, (2) the legacy SLUG=/BRANCH= output is unchanged, and
 * (3) every output line stays eval-safe (VAR=value only).
 *
 * Gate-tier, free, ~100ms.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const REPO_ROOT = process.cwd();
const SLUG_BIN = join(REPO_ROOT, 'bin', 'gstack-slug');

let TMP_HOME: string;

function runSlug(cwd: string): { stdout: string; status: number } {
  const result = spawnSync(SLUG_BIN, [], {
    cwd,
    encoding: 'utf-8',
    // Isolate HOME so the real ~/.gstack/slug-cache is never read or written.
    env: { ...process.env, HOME: TMP_HOME },
    timeout: 5000,
  });
  return { stdout: result.stdout || '', status: result.status ?? -1 };
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', timeout: 5000 });
  if ((r.status ?? -1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

function parse(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.trim().split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

beforeEach(() => {
  TMP_HOME = mkdtempSync(join(tmpdir(), 'gstack-slugsrc-home-'));
});

afterEach(() => {
  try { rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('gstack-slug SLUG_SOURCE', () => {
  test('git repo with a remote → SLUG_SOURCE=git and repo-derived slug', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gstack-slugsrc-repo-'));
    try {
      git(dir, ['init', '-q']);
      git(dir, ['remote', 'add', 'origin', 'https://github.com/acme/widget.git']);
      const vars = parse(runSlug(dir).stdout);
      expect(vars.SLUG_SOURCE).toBe('git');
      expect(vars.SLUG).toBe('acme-widget');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-git dir → SLUG_SOURCE=basename-fallback and folder-name slug', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gstack-slugsrc-plain-'));
    try {
      const vars = parse(runSlug(dir).stdout);
      expect(vars.SLUG_SOURCE).toBe('basename-fallback');
      // slug is the sanitized basename of the temp dir
      expect(vars.SLUG).toBe(dir.split('/').pop()!.replace(/[^a-zA-Z0-9._-]/g, ''));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('git repo WITHOUT a remote → basename-fallback (no remote to key on)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gstack-slugsrc-noremote-'));
    try {
      git(dir, ['init', '-q']);
      const vars = parse(runSlug(dir).stdout);
      expect(vars.SLUG_SOURCE).toBe('basename-fallback');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('legacy SLUG= and BRANCH= lines still present (no regression)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gstack-slugsrc-legacy-'));
    try {
      const { stdout, status } = runSlug(dir);
      expect(status).toBe(0);
      const vars = parse(stdout);
      expect(vars.SLUG).toBeDefined();
      expect(vars.BRANCH).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every output line is eval-safe (VAR=value, sanitized value)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gstack-slugsrc-safe-'));
    try {
      const { stdout } = runSlug(dir);
      for (const line of stdout.trim().split('\n')) {
        expect(line).toMatch(/^[A-Z_]+=[a-zA-Z0-9._-]*$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
