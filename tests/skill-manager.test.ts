/**
 * Tests for skill-manager.ts — skill CRUD, search, auto-extraction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SkillManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imzx-skills-'));
  });

  it('should save and load a skill', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    mgr.save({
      name: 'test-skill',
      description: 'A test skill',
      category: 'testing',
      steps: ['Step 1', 'Step 2'],
      tools_used: ['read_file'],
      gotchas: ['Watch out for X'],
      tags: ['test'],
    });
    const skill = mgr.load('test-skill');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('test-skill');
    expect(skill!.steps).toEqual(['Step 1', 'Step 2']);
  });

  it('should search skills by query', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    mgr.save({ name: 'rust-builder', description: 'Build Rust projects with cargo', category: 'build', steps: [], tools_used: [], gotchas: [], tags: ['rust', 'cargo'] });
    mgr.save({ name: 'node-runner', description: 'Run Node.js scripts', category: 'run', steps: [], tools_used: [], gotchas: [], tags: ['node'] });
    const results = mgr.search('rust cargo');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('rust-builder');
  });

  it('should track success and failure counts', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    mgr.save({ name: 'tracked', description: 'Tracked skill', category: 'test', steps: [], tools_used: [], gotchas: [], tags: [] });
    mgr.recordSuccess('tracked');
    mgr.recordSuccess('tracked');
    mgr.recordFailure('tracked');
    const skill = mgr.load('tracked');
    expect(skill!.success_count).toBe(2);
    expect(skill!.failure_count).toBe(1);
  });

  it('should auto-extract skill from task', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    const skill = mgr.extractFromTask(
      'Create REST API with Express',
      ['run_command', 'write_file'],
      ['Install express', 'Create routes', 'Start server'],
      'const app = express()'
    );
    expect(skill.name).toContain('auto-');
    expect(skill.tools_used).toContain('run_command');
    expect(skill.code_template).toContain('express');
  });

  it('should delete a skill', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    mgr.save({ name: 'deleteme', description: 'x', category: 'test', steps: [], tools_used: [], gotchas: [], tags: [] });
    expect(mgr.load('deleteme')).not.toBeNull();
    expect(mgr.delete('deleteme')).toBe(true);
    expect(mgr.load('deleteme')).toBeNull();
  });

  it('should format skills for prompt', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    mgr.save({ name: 'api-builder', description: 'Build REST APIs', category: 'build', steps: ['Init project', 'Add routes', 'Test'], tools_used: ['run_command', 'write_file'], gotchas: ['Always use HTTPS'], tags: ['api'] });
    const formatted = mgr.formatForPrompt('REST API');
    expect(formatted).toContain('api-builder');
    expect(formatted).toContain('HTTPS');
  });

  it('should list all skills sorted by success', async () => {
    const { SkillManager } = await import('../../adapters/memory/skill-manager.js');
    const mgr = new SkillManager(tmpDir);
    mgr.save({ name: 'popular', description: 'x', category: 'test', steps: [], tools_used: [], gotchas: [], tags: [] });
    mgr.save({ name: 'unpopular', description: 'x', category: 'test', steps: [], tools_used: [], gotchas: [], tags: [] });
    mgr.recordSuccess('popular');
    mgr.recordSuccess('popular');
    mgr.recordSuccess('popular');
    const list = mgr.list();
    expect(list[0].name).toBe('popular');
    expect(list[0].success_count).toBe(3);
  });
});
