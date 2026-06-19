/**
 * Persistent Memory — cross-session memory for self-improving agents.
 * 
 * Based on:
 * - Hermes Agent MEMORY.md pattern (persistent facts across sessions)
 * - Mem0 (vector + graph memory, 48K stars)
 * - SAGE paper (Peking University 2026, self-evolving graph memory)
 * 
 * Memory categories:
 * - user: preferences, corrections, habits, personal details
 * - knowledge: facts, domain knowledge, learned patterns
 * - session: summaries of past sessions
 * - correction: user corrections that must not be repeated
 * 
 * Storage: JSON file at .imzx/memory.json (no SQLite dependency)
 * Search: keyword matching + recency scoring
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface MemoryEntry {
  id: string;
  category: 'user' | 'knowledge' | 'session' | 'correction';
  key: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  access_count: number;
  importance: number; // 1-10, higher = more important
}

export interface MemoryStore {
  entries: MemoryEntry[];
  version: number;
}

export class PersistentMemory {
  private store: MemoryStore;
  private filePath: string;
  private dirty: boolean = false;

  constructor(baseDir?: string) {
    const dir = baseDir || path.join(process.cwd(), '.imzx');
    this.filePath = path.join(dir, 'memory.json');
    this.store = this.load();
  }

  // --- CRUD Operations ---

  /** Save a memory entry. */
  save(category: MemoryEntry['category'], key: string, content: string, options: {
    tags?: string[];
    importance?: number;
  } = {}): MemoryEntry {
    // Check if key already exists — update instead of duplicate
    const existing = this.store.entries.find(e => e.category === category && e.key === key);
    if (existing) {
      existing.content = content;
      existing.tags = options.tags || existing.tags;
      existing.importance = options.importance || existing.importance;
      existing.updated_at = new Date().toISOString();
      existing.access_count++;
      this.dirty = true;
      this.persist();
      return existing;
    }

    const entry: MemoryEntry = {
      id: `${category}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category,
      key,
      content,
      tags: options.tags || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      access_count: 0,
      importance: options.importance || 5,
    };

    this.store.entries.push(entry);
    this.dirty = true;
    this.persist();
    return entry;
  }

  /** Recall memories matching a query. Returns sorted by relevance. */
  recall(query: string, options: {
    category?: MemoryEntry['category'];
    limit?: number;
    minImportance?: number;
  } = {}): MemoryEntry[] {
    const limit = options.limit || 10;
    const minImportance = options.minImportance || 1;
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    let candidates = this.store.entries.filter(e => {
      if (options.category && e.category !== options.category) return false;
      if (e.importance < minImportance) return false;
      return true;
    });

    // Score each candidate
    const scored = candidates.map(entry => {
      let score = 0;
      const contentLower = entry.content.toLowerCase();
      const keyLower = entry.key.toLowerCase();
      const tagsLower = entry.tags.map(t => t.toLowerCase());

      // Exact key match = highest score
      if (keyLower === queryLower) score += 100;

      // Key contains query
      if (keyLower.includes(queryLower) || queryLower.includes(keyLower)) score += 50;

      // Word matches in content
      for (const word of queryWords) {
        if (contentLower.includes(word)) score += 10;
        if (keyLower.includes(word)) score += 15;
        if (tagsLower.some(t => t.includes(word))) score += 20;
      }

      // Importance bonus
      score += entry.importance * 2;

      // Recency bonus (newer = higher score)
      const ageMs = Date.now() - new Date(entry.updated_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      score += Math.max(0, 10 - ageDays); // Bonus decays over 10 days

      // Access frequency bonus
      score += Math.min(entry.access_count, 10);

      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => {
        s.entry.access_count++;
        this.dirty = true;
        return s.entry;
      });
  }

  /** Get all memories in a category. */
  getByCategory(category: MemoryEntry['category']): MemoryEntry[] {
    return this.store.entries.filter(e => e.category === category);
  }

  /** Delete a memory by id or key. */
  forget(identifier: string): boolean {
    const idx = this.store.entries.findIndex(e => e.id === identifier || e.key === identifier);
    if (idx >= 0) {
      this.store.entries.splice(idx, 1);
      this.dirty = true;
      this.persist();
      return true;
    }
    return false;
  }

  /** Get memory stats. */
  stats(): { total: number; byCategory: Record<string, number>; oldestEntry: string; newestEntry: string } {
    const byCategory: Record<string, number> = {};
    for (const e of this.store.entries) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    }
    const dates = this.store.entries.map(e => new Date(e.created_at).getTime());
    return {
      total: this.store.entries.length,
      byCategory,
      oldestEntry: dates.length ? new Date(dates.reduce((a, b) => Math.min(a, b), Infinity)).toISOString() : 'none',
      newestEntry: dates.length ? new Date(dates.reduce((a, b) => Math.max(a, b), -Infinity)).toISOString() : 'none',
    };
  }

  // --- Auto-Detection ---

  /** Detect and save user preferences from conversation. */
  detectPreferences(userMessage: string): void {
    const patterns = [
      { regex: /jangan\s+(pakai|gunakan|gunakan)\s+(\w+)/i, key: 'avoid', extract: (m: RegExpMatchArray) => `Avoid: ${m[2]}` },
      { regex: /selalu\s+(pakai|gunakan)\s+(\w+)/i, key: 'prefer', extract: (m: RegExpMatchArray) => `Always use: ${m[2]}` },
      { regex: /lebih\s+suka\s+(.+)/i, key: 'preference', extract: (m: RegExpMatchArray) => `Prefers: ${m[1]}` },
      { regex: /tolong\s+jangan\s+(.+)/i, key: 'dont', extract: (m: RegExpMatchArray) => `Don't: ${m[1]}` },
      { regex: /format\s+(\w+)/i, key: 'format', extract: (m: RegExpMatchArray) => `Format: ${m[1]}` },
      { regex: /bahasa\s+(\w+)/i, key: 'language', extract: (m: RegExpMatchArray) => `Language: ${m[1]}` },
      { regex: /singkat|padat|jangan panjang/i, key: 'style', extract: () => 'Response style: concise' },
      { regex: /detail|lengkap|jelaskan/i, key: 'style', extract: () => 'Response style: detailed' },
    ];

    for (const p of patterns) {
      const match = userMessage.match(p.regex);
      if (match) {
        const content = p.extract(match);
        this.save('user', `pref_${p.key}_${Date.now()}`, content, {
          tags: ['preference', 'auto-detected'],
          importance: 8,
        });
      }
    }
  }

  /** Detect corrections (user says agent was wrong). */
  detectCorrection(userMessage: string): boolean {
    const correctionPatterns = [
      /salah|wrong|incorrect|bukan itu/i,
      /jangan\s+.*lagi|don't\s+.*again/i,
      /seharusnya|should be|it should/i,
      /yang benar|the correct/i,
      /koreksi|correction|fix this/i,
    ];

    for (const pattern of correctionPatterns) {
      if (pattern.test(userMessage)) {
        this.save('correction', `correction_${Date.now()}`, userMessage, {
          tags: ['correction', 'user-feedback'],
          importance: 9, // Corrections are high importance
        });
        return true;
      }
    }
    return false;
  }

  // --- Context Injection ---

  /** Format memories for injection into system prompt. */
  formatForPrompt(query?: string): string {
    let memories: MemoryEntry[];

    if (query) {
      memories = this.recall(query, { limit: 8 });
    } else {
      // No query — return high-importance memories
      memories = this.store.entries
        .filter(e => e.importance >= 7)
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 10);
    }

    if (memories.length === 0) return '';

    const grouped: Record<string, string[]> = {};
    for (const m of memories) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(`- ${m.key}: ${m.content}`);
    }

    const sections: string[] = [];
    if (grouped['correction']) sections.push(`## User Corrections (MUST follow):\n${grouped['correction'].join('\n')}`);
    if (grouped['user']) sections.push(`## User Preferences:\n${grouped['user'].join('\n')}`);
    if (grouped['knowledge']) sections.push(`## Known Facts:\n${grouped['knowledge'].join('\n')}`);
    if (grouped['session']) sections.push(`## Past Sessions:\n${grouped['session'].join('\n')}`);

    return `\n\n## Memory (from past sessions):\n${sections.join('\n\n')}`;
  }

  // --- Persistence ---

  private load(): MemoryStore {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const store = JSON.parse(data) as MemoryStore;
        // Migrate old versions
        if (!store.version) store.version = 1;
        return store;
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { entries: [], version: 1 };
  }

  private persist(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      console.error(`[Memory] Failed to persist: ${err}`);
    }
  }

  /** Force save to disk. */
  flush(): void {
    this.dirty = true;
    this.persist();
  }
}
