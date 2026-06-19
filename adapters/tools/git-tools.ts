/**
 * Git Tools — Git-aware agent operations.
 * Enables the agent to understand code context through git.
 * Based on: Claude Code git awareness, Aider git integration (2026).
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  remote: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  lastCommit: { hash: string; message: string; date: string } | null;
}

export interface GitDiff {
  files: string[];
  insertions: number;
  deletions: number;
  patch: string;
}

export class GitTools {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  private exec(cmd: string): string {
    try {
      return execSync(cmd, { cwd: this.cwd, encoding: 'utf-8', timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
    } catch { return ''; }
  }

  isGitRepo(): boolean {
    return this.exec('git rev-parse --is-inside-work-tree') === 'true';
  }

  getStatus(): GitStatus {
    if (!this.isGitRepo()) {
      return { isRepo: false, branch: '', remote: '', staged: [], modified: [], untracked: [], ahead: 0, behind: 0, lastCommit: null };
    }

    const branch = this.exec('git branch --show-current');
    const remote = this.exec('git remote get-url origin 2>/dev/null');
    const statusRaw = this.exec('git status --porcelain');
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    for (const line of statusRaw.split('\n').filter(l => l.trim())) {
      const index = line[0];
      const work = line[1];
      const file = line.substring(3).trim();
      if (index !== ' ' && index !== '?') staged.push(file);
      else if (work === 'M' || work === 'D') modified.push(file);
      else if (index === '?') untracked.push(file);
    }

    let ahead = 0, behind = 0;
    const tracking = this.exec('git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null');
    if (tracking) {
      const [a, b] = tracking.split('\t').map(Number);
      ahead = a; behind = b;
    }

    const lastHash = this.exec('git log -1 --format=%H');
    const lastMsg = this.exec('git log -1 --format=%s');
    const lastDate = this.exec('git log -1 --format=%ci');
    const lastCommit = lastHash ? { hash: lastHash.substring(0, 8), message: lastMsg, date: lastDate } : null;

    return { isRepo: true, branch, remote, staged, modified, untracked, ahead, behind, lastCommit };
  }

  getDiff(staged: boolean = true): GitDiff {
    const flag = staged ? '--cached' : '';
    const diff = this.exec(`git diff ${flag} --stat`);
    const patch = this.exec(`git diff ${flag} --no-color`).substring(0, 50000);
    const files = this.exec(`git diff ${flag} --name-only`).split('\n').filter(f => f.trim());
    const insertions = (diff.match(/\d+(?= insertion)/) || ['0']).map(Number)[0];
    const deletions = (diff.match(/\d+(?= deletion)/) || ['0']).map(Number)[0];
    return { files, insertions, deletions, patch };
  }

  getLog(count: number = 10): string {
    return this.exec(`git log --oneline -${count}`);
  }

  blame(file: string): string {
    return this.exec(`git blame --porcelain "${file}" 2>/dev/null`).substring(0, 30000);
  }

  getProjectContext(): string {
    if (!this.isGitRepo()) return '';
    const status = this.getStatus();
    const parts = [`Git: ${status.branch} (${status.remote || 'no remote'})`];
    if (status.staged.length) parts.push(`Staged: ${status.staged.join(', ')}`);
    if (status.modified.length) parts.push(`Modified: ${status.modified.join(', ')}`);
    if (status.untracked.length) parts.push(`Untracked: ${status.untracked.join(', ')}`);
    if (status.ahead || status.behind) parts.push(`Ahead: ${status.ahead}, Behind: ${status.behind}`);
    if (status.lastCommit) parts.push(`Last: ${status.lastCommit.hash} ${status.lastCommit.message}`);
    return parts.join(' | ');
  }

  formatForPrompt(): string {
    const ctx = this.getProjectContext();
    return ctx ? `\n\n## Git Context:\n${ctx}` : '';
  }
}
