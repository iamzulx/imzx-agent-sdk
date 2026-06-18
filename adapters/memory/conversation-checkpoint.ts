/**
 * Conversation Checkpoint — undo, redo, branch, restore for multi-turn agents.
 * Based on: AI agent conversation branching (2026), Hermes checkpoint system.
 * Enables agents to backtrack failed attempts and try alternative paths.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LlmMessage } from '../external/llm-provider.js';

export interface Checkpoint {
  id: string;
  parent_id?: string;
  messages: LlmMessage[];
  stats: { inputTokens: number; outputTokens: number; costUsd: number; requests: number };
  label: string;
  created_at: string;
  branch_name?: string;
}

export class ConversationCheckpoint {
  private checkpoints: Checkpoint[] = [];
  private currentIdx: number = -1;
  private maxCheckpoints: number = 50;
  private savePath: string;

  constructor(baseDir?: string) {
    const dir = baseDir || path.join(process.cwd(), '.imzx');
    this.savePath = path.join(dir, 'checkpoints.json');
    this.load();
  }

  save(label: string, messages: LlmMessage[], stats: Checkpoint['stats'], branchName?: string): Checkpoint {
    const cp: Checkpoint = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      parent_id: this.currentIdx >= 0 ? this.checkpoints[this.currentIdx]?.id : undefined,
      messages: JSON.parse(JSON.stringify(messages)),
      stats: { ...stats },
      label,
      created_at: new Date().toISOString(),
      branch_name: branchName,
    };
    this.checkpoints.push(cp);
    this.currentIdx = this.checkpoints.length - 1;
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints = this.checkpoints.slice(-this.maxCheckpoints);
      this.currentIdx = this.checkpoints.length - 1;
    }
    this.persist();
    return cp;
  }

  restore(index: number): Checkpoint | null {
    if (index < 0 || index >= this.checkpoints.length) return null;
    this.currentIdx = index;
    return JSON.parse(JSON.stringify(this.checkpoints[index]));
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

  branch(label: string, messages: LlmMessage[], stats: Checkpoint['stats']): Checkpoint {
    return this.save(label, messages, stats, `branch_${Date.now()}`);
  }

  list(): Array<{ index: number; label: string; branch?: string; created_at: string; is_current: boolean }> {
    return this.checkpoints.map((cp, i) => ({
      index: i,
      label: cp.label,
      branch: cp.branch_name,
      created_at: cp.created_at,
      is_current: i === this.currentIdx,
    }));
  }

  getCurrent(): Checkpoint | null {
    return this.currentIdx >= 0 ? JSON.parse(JSON.stringify(this.checkpoints[this.currentIdx])) : null;
  }

  formatForPrompt(): string {
    if (this.checkpoints.length === 0) return '';
    const current = this.checkpoints[this.currentIdx];
    if (!current) return '';
    return `\n\n## Checkpoint: ${current.label} (${this.currentIdx + 1}/${this.checkpoints.length})`;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.savePath)) {
        const data = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
        this.checkpoints = data.checkpoints || [];
        this.currentIdx = data.currentIdx ?? this.checkpoints.length - 1;
      }
    } catch {}
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.savePath), { recursive: true });
      fs.writeFileSync(this.savePath, JSON.stringify({ checkpoints: this.checkpoints, currentIdx: this.currentIdx }, null, 2), 'utf-8');
    } catch {}
  }
}
