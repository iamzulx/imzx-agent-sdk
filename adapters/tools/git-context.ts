import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitBranches {
  current: string;
  local: string[];
  remote: string[];
}

export class GitContext {
  private repoPath: string;
  private isGit: boolean;

  constructor(repoPath?: string) {
    this.repoPath = repoPath ? resolve(repoPath) : process.cwd();
    this.isGit = existsSync(join(this.repoPath, '.git')) || this.detectGitDir();
  }

  private detectGitDir(): boolean {
    try {
      this.exec('git rev-parse --is-inside-work-tree');
      return true;
    } catch {
      return false;
    }
  }

  private exec(cmd: string): string {
    try {
      return execSync(`git --no-pager ${cmd}`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err: any) {
      const msg = err.stderr?.toString?.() ?? err.message ?? String(err);
      throw new Error(`git command failed: ${msg}`);
    }
  }

  private safeExec(cmd: string, fallback: string = ''): string {
    try {
      return this.exec(cmd);
    } catch {
      return fallback;
    }
  }

  isGitRepo(): boolean {
    return this.isGit;
  }

  getStatus(): GitStatus {
    if (!this.isGit) {
      return { branch: '', ahead: 0, behind: 0, modified: [], staged: [], untracked: [] };
    }

    const branch = this.safeExec('rev-parse --abbrev-ref HEAD');

    let ahead = 0;
    let behind = 0;
    try {
      const tracking = this.safeExec('rev-list --left-right --count HEAD...@{u}');
      if (tracking) {
        const parts = tracking.split(/\s+/);
        ahead = parseInt(parts[0] ?? '0', 10) || 0;
        behind = parseInt(parts[1] ?? '0', 10) || 0;
      }
    } catch { /* no upstream */ }

    const statusRaw = this.safeExec('status --porcelain=v1');
    const modified: string[] = [];
    const staged: string[] = [];
    const untracked: string[] = [];

    for (const line of statusRaw.split('\n').filter(Boolean)) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const file = line.slice(3);

      if (indexStatus === '?' && workTreeStatus === '?') {
        untracked.push(file);
      } else {
        if (indexStatus !== ' ' && indexStatus !== '?') {
          staged.push(file);
        }
        if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
          modified.push(file);
        }
      }
    }

    return { branch, ahead, behind, modified, staged, untracked };
  }

  getDiff(staged: boolean = false): string {
    if (!this.isGit) return '';
    return this.safeExec(staged ? 'diff --cached' : 'diff');
  }

  getLog(count: number = 10): GitCommit[] {
    if (!this.isGit) return [];
    const raw = this.safeExec(`log -${count} --format=%H|%an|%aI|%s`);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return { hash: hash!, author: author!, date: date!, message: msgParts.join('|') };
    });
  }

  getBranches(): GitBranches {
    if (!this.isGit) {
      return { current: '', local: [], remote: [] };
    }
    const current = this.safeExec('rev-parse --abbrev-ref HEAD');
    const all = this.safeExec('branch -a --format=%(refname:short)');
    const local: string[] = [];
    const remote: string[] = [];
    for (const b of all.split('\n').filter(Boolean)) {
      if (b.startsWith('remotes/')) {
        remote.push(b.replace(/^remotes\//, ''));
      } else if (b !== current) {
        local.push(b);
      }
    }
    return { current, local, remote };
  }

  async commit(message: string, files?: string[]): Promise<{ hash: string; message: string }> {
    if (!this.isGit) throw new Error('Not a git repository');
    if (files?.length) {
      this.exec(`add ${files.map((f) => `"${f}"`).join(' ')}`);
    }
    this.exec(`commit -m "${message.replace(/"/g, '\\"')}"`);
    const hash = this.exec('rev-parse HEAD');
    return { hash, message };
  }

  async createBranch(name: string): Promise<void> {
    if (!this.isGit) throw new Error('Not a git repository');
    this.exec(`checkout -b "${name.replace(/"/g, '\\"')}"`);
  }

  getLastCommit(): { hash: string; message: string; date: string } {
    if (!this.isGit) return { hash: '', message: '', date: '' };
    const raw = this.safeExec('log -1 --format=%H|%s|%aI');
    if (!raw) return { hash: '', message: '', date: '' };
    const [hash, message, date] = raw.split('|');
    return { hash: hash!, message: message!, date: date! };
  }

  formatForPrompt(): string {
    if (!this.isGit) return '[Git: not a repository]';

    const status = this.getStatus();
    const lastCommit = this.getLastCommit();
    const recent = this.getLog(5);
    const stagedDiff = this.getDiff(true);

    const lines: string[] = [
      `## Git Context`,
      `Branch: ${status.branch}`,
      `Ahead: ${status.ahead} | Behind: ${status.behind}`,
      '',
    ];

    if (status.staged.length) lines.push(`Staged: ${status.staged.join(', ')}`);
    if (status.modified.length) lines.push(`Modified: ${status.modified.join(', ')}`);
    if (status.untracked.length) lines.push(`Untracked: ${status.untracked.join(', ')}`);

    lines.push('', `Last commit: ${lastCommit.hash?.slice(0, 8)} — ${lastCommit.message}`);

    if (recent.length) {
      lines.push('', '### Recent commits');
      for (const c of recent) {
        lines.push(`- ${c.hash.slice(0, 8)} ${c.message} (${c.author}, ${c.date})`);
      }
    }

    if (stagedDiff) {
      lines.push('', '### Staged changes (summary)', '```diff');
      const diffLines = stagedDiff.split('\n');
      lines.push(...diffLines.slice(0, 60));
      if (diffLines.length > 60) lines.push(`... (${diffLines.length - 60} more lines)`);
      lines.push('```');
    }

    return lines.join('\n');
  }
}
