/**
 * Tests for persistent-memory.ts — memory CRUD, search, auto-detection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('PersistentMemory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imzx-test-'));
  });

  it('should save and recall by keyword', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    mem.save('user', 'pref_style', 'Prefers concise responses', { tags: ['style'] });
    mem.save('knowledge', 'fact_rust', 'Rust uses ownership model', { tags: ['rust'] });
    const results = mem.recall('concise');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('concise');
  });

  it('should update existing entry on duplicate key', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    mem.save('user', 'pref_lang', 'Language: TypeScript');
    mem.save('user', 'pref_lang', 'Language: JavaScript');
    const results = mem.recall('Language');
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Language: JavaScript');
  });

  it('should detect corrections', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    const isCorrection = mem.detectCorrection('Salah, jangan pakai TypeScript');
    expect(isCorrection).toBe(true);
    const corrections = mem.getByCategory('correction');
    expect(corrections.length).toBe(1);
    expect(corrections[0].importance).toBe(9);
  });

  it('should detect preferences', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    mem.detectPreferences('Jangan pakai Python, lebih suka Rust');
    mem.detectPreferences('Tolong jangan panjang, singkat aja');
    const prefs = mem.getByCategory('user');
    expect(prefs.length).toBeGreaterThanOrEqual(2);
  });

  it('should forget by key', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    mem.save('user', 'test_key', 'test content');
    expect(mem.stats().total).toBe(1);
    mem.forget('test_key');
    expect(mem.stats().total).toBe(0);
  });

  it('should return stats', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    mem.save('user', 'a', 'content a');
    mem.save('knowledge', 'b', 'content b');
    mem.save('correction', 'c', 'content c');
    const stats = mem.stats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory['user']).toBe(1);
    expect(stats.byCategory['knowledge']).toBe(1);
  });

  it('should format for prompt injection', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem = new PersistentMemory(tmpDir);
    mem.save('correction', 'corr1', "Don't use TypeScript", { importance: 9 });
    mem.save('user', 'pref1', 'Prefers concise', { importance: 8 });
    const formatted = mem.formatForPrompt('TypeScript');
    expect(formatted).toContain('Memory');
  });

  it('should persist to disk and reload', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const mem1 = new PersistentMemory(tmpDir);
    mem1.save('user', 'persist_test', 'This should persist');
    mem1.flush();
    const mem2 = new PersistentMemory(tmpDir);
    const results = mem2.recall('persist');
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('This should persist');
  });
});
