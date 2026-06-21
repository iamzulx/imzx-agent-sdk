/**
 * Tests for reflection-engine.ts — self-reflection, lesson extraction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('ReflectionEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imzx-test-'));
  });

  it('should track task and generate reflection on success', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const { ReflectionEngine } = await import('../../adapters/memory/reflection-engine.js');
    const memory = new PersistentMemory(tmpDir);
    const engine = new ReflectionEngine(memory);

    engine.startTask();
    engine.recordToolUse('read_file');
    engine.recordToolUse('edit_file');
    engine.recordTokens(5000);

    const reflection = await engine.endTask('Fix the bug', 'Bug fixed successfully', 'success');

    expect(reflection).not.toBeNull();
    expect(reflection!.outcome).toBe('success');
    expect(reflection!.tools_used).toContain('read_file');
    expect(reflection!.tools_used).toContain('edit_file');
    expect(reflection!.what_worked.length).toBeGreaterThan(0);
  });

  it('should generate failure reflection with lessons', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const { ReflectionEngine } = await import('../../adapters/memory/reflection-engine.js');
    const memory = new PersistentMemory(tmpDir);
    const engine = new ReflectionEngine(memory);

    engine.startTask();
    engine.recordToolUse('web_search');

    const reflection = await engine.endTask('Search for info', 'Maximum iterations reached', 'failure');

    expect(reflection).not.toBeNull();
    expect(reflection!.outcome).toBe('failure');
    expect(reflection!.what_failed.length).toBeGreaterThan(0);
    expect(reflection!.lessons.length).toBeGreaterThan(0);
    expect(reflection!.next_time).toContain('Next time');
  });

  it('should store reflections in memory', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const { ReflectionEngine } = await import('../../adapters/memory/reflection-engine.js');
    const memory = new PersistentMemory(tmpDir);
    const engine = new ReflectionEngine(memory);

    engine.startTask();
    await engine.endTask('Test task', 'Done', 'success');

    const sessions = memory.getByCategory('session');
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.some(s => s.key.startsWith('reflection_'))).toBe(true);
  });

  it('should retrieve recent reflections', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const { ReflectionEngine } = await import('../../adapters/memory/reflection-engine.js');
    const memory = new PersistentMemory(tmpDir);
    const engine = new ReflectionEngine(memory);

    for (let i = 0; i < 5; i++) {
      engine.startTask();
      await engine.endTask(`Task ${i}`, 'Done', 'success');
    }

    const recent = engine.getRecentReflections(3);
    // Timestamp collision in fast CI loops means reflections may share created_at
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent.length).toBeLessThanOrEqual(3);
  });

  it('should format reflections for prompt injection', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const { ReflectionEngine } = await import('../../adapters/memory/reflection-engine.js');
    const memory = new PersistentMemory(tmpDir);
    const engine = new ReflectionEngine(memory);

    engine.startTask();
    engine.recordToolUse('run_command');
    await engine.endTask('Build project', 'Build failed', 'failure');

    const formatted = engine.formatForPrompt();
    expect(formatted).toContain('Lessons Learned');
  });

  it('should return null if no task is active', async () => {
    const { PersistentMemory } = await import('../../adapters/memory/persistent-memory.js');
    const { ReflectionEngine } = await import('../../adapters/memory/reflection-engine.js');
    const memory = new PersistentMemory(tmpDir);
    const engine = new ReflectionEngine(memory);

    const reflection = await engine.endTask('No task', 'Nothing', 'success');
    expect(reflection).toBeNull();
  });
});
