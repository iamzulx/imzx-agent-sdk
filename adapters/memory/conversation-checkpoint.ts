/**
 * Conversation Checkpoint — undo, redo, branch, restore for multi-turn agents.
 * v0.6.0: Enhanced with auto-checkpoint, crash recovery (WAL), per-file storage.
 * Based on: AI agent conversation branching (2026), Hermes checkpoint system.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LlmMessage } from '../external/llm-provider.js';

export interface Checkpoint {
  id: string;
  parent_id?: string;
  messages: LlmMessage[];
  stats: { inputTokens: number; outputTokens: number; costUsd: number; requests: number };
  brain_state?: Record<string, unknown>;
  label: string;
  created_at: string;
  branch_name?: string;
}

export interface CheckpointManagerConfig {
  baseDir?: string;
  autoCheckpointEvery?: number; // messages between auto-checkpoints (default 10)
  maxCheckpoints?: number;
}

export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  private currentIdx: number = -1;
  private maxCheckpoints: number;
  private savePath: string;
  private checkpointDir: string;
  private walPath: string;
  private autoCheckpointEvery: number;
  private messageCount: number = 0;

  constructor(config: CheckpointManagerConfig = {}) {
    const dir = config.baseDir || path.join(process.cwd(), '.imzx');
    this.checkpointDir = path.join(dir, 'checkpoints');
    this.savePath = path.join(this.checkpointDir, 'index.json');
    this.walPath = path.join(this.checkpointDir, 'wal.jsonl');
    this.maxCheckpoints = config.maxCheckpoints ?? 100;
    this.autoCheckpointEvery = config.autoCheckpointEvery ?? 10;
    this.loadIndex();
  }

  /** Save a checkpoint. WAL write first for crash safety. */
  save(label: string, messages: LlmMessage[], stats: Checkpoint['stats'], brainState?: Record<string, unknown>, branchName?: string): Checkpoint {
    const cp: Checkpoint = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      parent_id: this.currentIdx >= 0 ? this.checkpoints[this.currentIdx]?.id : undefined,
      messages: JSON.parse(JSON.stringify(messages)),
      stats: { ...stats },
      brain_state: brainState,
      label,
      created_at: new Date().toISOString(),
      branch_name: branchName,
    };

    // WAL: write-ahead log entry before index update
    this.writeWalEntry(cp);

    // Write checkpoint to individual file
    const cpPath = path.join(this.checkpointDir, `${cp.id}.json`);
    try {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
      fs.writeFileSync(cpPath, JSON.stringify(cp, null, 2), 'utf-8');
    } catch {}

    this.checkpoints.push(cp);
    this.currentIdx = this.checkpoints.length - 1;

    // Trim old checkpoints
    if (this.checkpoints.length > this.maxCheckpoints) {
      const removed = this.checkpoints.splice(0, this.checkpoints.length - this.maxCheckpoints);
      for (const old of removed) {
        try { fs.unlinkSync(path.join(this.checkpointDir, `${old.id}.json`)); } catch {}
      }
      this.currentIdx = this.checkpoints.length - 1;
    }

    this.persistIndex();
    this.trimWal();
    return cp;
  }

  /** Auto-checkpoint: saves if message count threshold is met. */
  maybeAutoCheckpoint(messages: LlmMessage[], stats: Checkpoint['stats'], brainState?: Record<string, unknown>): Checkpoint | null {
    this.messageCount++;
    if (this.messageCount >= this.autoCheckpointEvery) {
      this.messageCount = 0;
      return this.save(`auto_${new Date().toISOString()}`, messages, stats, brainState);
    }
    return null;
  }

  /** Load the latest checkpoint for crash recovery. */
  loadLatest(): Checkpoint | null {
    // First try WAL recovery
    const walEntry = this.recoverFromWal();
    if (walEntry) return walEntry;

    // Then try normal index
    if (this.checkpoints.length === 0) return null;
    const latest = this.checkpoints[this.checkpoints.length - 1];
    if (!latest) return null;

    // Try loading full checkpoint from individual file
    const cpPath = path.join(this.checkpointDir, `${latest.id}.json`);
    try {
      return JSON.parse(fs.readFileSync(cpPath, 'utf-8')) as Checkpoint;
    } catch {
      return JSON.parse(JSON.stringify(latest));
    }
  }

  restore(index: number): Checkpoint | null {
    if (index < 0 || index >= this.checkpoints.length) return null;
    this.currentIdx = index;
    const cp = this.checkpoints[index]!;
    // Load from file for full data
    const cpPath = path.join(this.checkpointDir, `${cp.id}.json`);
    try {
      return JSON.parse(fs.readFileSync(cpPath, 'utf-8')) as Checkpoint;
    } catch {
      return JSON.parse(JSON.stringify(cp));
    }
  }

  undo(): Checkpoint | null {
    if (this.currentIdx <= 0) return null;
    this.currentIdx--;
    return this.restore(this.currentIdx);
  }

  redo(): Checkpoint | null {
    if (this.currentIdx >= this.checkpoints.length - 1) return null;
    this.currentIdx++;
    return this.restore(this.currentIdx);
  }

  branch(label: string, messages: LlmMessage[], stats: Checkpoint['stats'], brainState?: Record<string, unknown>): Checkpoint {
    return this.save(label, messages, stats, brainState, `branch_${Date.now()}`);
  }

  list(): Array<{ index: number; id: string; label: string; branch?: string; created_at: string; is_current: boolean }> {
    return this.checkpoints.map((cp, i) => ({
      index: i,
      id: cp.id,
      label: cp.label,
      branch: cp.branch_name,
      created_at: cp.created_at,
      is_current: i === this.currentIdx,
    }));
  }

  delete(index: number): boolean {
    if (index < 0 || index >= this.checkpoints.length) return false;
    const [removed] = this.checkpoints.splice(index, 1);
    if (removed) {
      try { fs.unlinkSync(path.join(this.checkpointDir, `${removed.id}.json`)); } catch {}
    }
    if (this.currentIdx >= this.checkpoints.length) this.currentIdx = this.checkpoints.length - 1;
    this.persistIndex();
    return true;
  }

  getCurrent(): Checkpoint | null {
    return this.currentIdx >= 0 ? this.restore(this.currentIdx) : null;
  }

  formatForPrompt(): string {
    if (this.checkpoints.length === 0) return '';
    const current = this.checkpoints[this.currentIdx];
    if (!current) return '';
    return `\n\n## Checkpoint: ${current.label} (${this.currentIdx + 1}/${this.checkpoints.length})`;
  }

  // --- WAL (Write-Ahead Log) for crash safety ---

  private writeWalEntry(cp: Checkpoint): void {
    try {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
      const entry = JSON.stringify({ type: 'checkpoint', id: cp.id, label: cp.label, created_at: cp.created_at, message_count: cp.messages.length });
      fs.appendFileSync(this.walPath, entry + '\n', 'utf-8');
    } catch {}
  }

  private recoverFromWal(): Checkpoint | null {
    try {
      if (!fs.existsSync(this.walPath)) return null;
      const lines = fs.readFileSync(this.walPath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length === 0) return null;
      // Last WAL entry tells us the latest checkpoint id
      const last = JSON.parse(lines[lines.length - 1]!) as { id: string };
      const cpPath = path.join(this.checkpointDir, `${last.id}.json`);
      if (fs.existsSync(cpPath)) {
        return JSON.parse(fs.readFileSync(cpPath, 'utf-8')) as Checkpoint;
      }
    } catch {}
    return null;
  }

  private trimWal(): void {
    try {
      // Keep WAL small — just append, trim to last 50 entries
      if (!fs.existsSync(this.walPath)) return;
      const lines = fs.readFileSync(this.walPath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length > 50) {
        fs.writeFileSync(this.walPath, lines.slice(-50).join('\n') + '\n', 'utf-8');
      }
    } catch {}
  }

  // --- Persistence ---

  private loadIndex(): void {
    try {
      if (fs.existsSync(this.savePath)) {
        const data = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
        this.checkpoints = data.checkpoints || [];
        this.currentIdx = data.currentIdx ?? this.checkpoints.length - 1;
      }
    } catch {}
  }

  private persistIndex(): void {
    try {
      fs.mkdirSync(path.dirname(this.savePath), { recursive: true });
      fs.writeFileSync(this.savePath, JSON.stringify({ checkpoints: this.checkpoints, currentIdx: this.currentIdx }, null, 2), 'utf-8');
    } catch {}
  }
}

/** @deprecated Use CheckpointManager instead */
export class ConversationCheckpoint extends CheckpointManager {}
