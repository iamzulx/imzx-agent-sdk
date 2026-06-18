/**
 * Tests for knowledge-graph.ts — entity/relations, extraction, search, persistence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KnowledgeGraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imzx-kg-'));
  });

  it('should add and retrieve entities', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    const e = kg.addEntity('tool', 'read_file', { description: 'Read files' });
    expect(e.name).toBe('read_file');
    expect(e.type).toBe('tool');
    expect(e.mentions).toBe(1);
    expect(kg.getEntity(e.id)).toBe(e);
  });

  it('should deduplicate entities by type+name', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    kg.addEntity('tool', 'read_file');
    kg.addEntity('tool', 'read_file');
    kg.addEntity('tool', 'read_file');
    const entities = kg.search('read_file');
    expect(entities.length).toBe(1);
    expect(entities[0].entity.mentions).toBe(3);
  });

  it('should add relations and traverse via adjacency list', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    const a = kg.addEntity('tool', 'read_file');
    const b = kg.addEntity('file', 'main.rs');
    const rel = kg.addRelation(a.id, b.id, 'reads');
    expect(rel).not.toBeNull();
    expect(rel!.source_id).toBe(a.id);
    expect(rel!.target_id).toBe(b.id);
    const connected = kg.getConnected(a.id);
    expect(connected.length).toBe(1);
    expect(connected[0].name).toBe('main.rs');
  });

  it('should auto-extract entities from text', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    const extracted = kg.extractEntities('Fix the bug in src/auth.ts using grep tool from https://example.com');
    const types = extracted.map(e => e.type);
    expect(types).toContain('file');
    expect(types).toContain('url');
    expect(types).toContain('tool');
  });

  it('should create co-occurrence relations via processMessage', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    kg.processMessage('Use read_file to check main.rs');
    const stats = kg.stats();
    expect(stats.entities).toBeGreaterThanOrEqual(2);
    expect(stats.relations).toBeGreaterThanOrEqual(1);
  });

  it('should search by keyword with scoring', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    kg.addEntity('tool', 'read_file', { desc: 'read file contents' });
    kg.addEntity('tool', 'write_file', { desc: 'write file contents' });
    kg.addEntity('tool', 'run_command', { desc: 'run shell command' });
    const results = kg.search('file');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].entity.name).toContain('file');
  });

  it('should delete entity and cascade relations', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    const a = kg.addEntity('tool', 'read_file');
    const b = kg.addEntity('file', 'main.rs');
    kg.addRelation(a.id, b.id, 'reads');
    expect(kg.stats().relations).toBe(1);
    kg.deleteEntity(a.id);
    expect(kg.stats().entities).toBe(1);
    expect(kg.stats().relations).toBe(0);
  });

  it('should export and import roundtrip', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg1 = new KnowledgeGraph();
    const a = kg1.addEntity('tool', 'read_file');
    const b = kg1.addEntity('file', 'main.rs');
    kg1.addRelation(a.id, b.id, 'reads');
    const json = kg1.export();

    const kg2 = new KnowledgeGraph();
    kg2.import(json);
    expect(kg2.stats().entities).toBe(2);
    expect(kg2.stats().relations).toBe(1);
    const connected = kg2.getConnected(a.id);
    expect(connected[0].name).toBe('main.rs');
  });

  it('should format for prompt injection', async () => {
    const { KnowledgeGraph } = await import('../../adapters/memory/knowledge-graph.js');
    const kg = new KnowledgeGraph();
    kg.addEntity('tool', 'read_file', { desc: 'read files' });
    kg.addEntity('file', 'auth.ts');
    const formatted = kg.formatForPrompt('read_file');
    expect(formatted).toContain('Knowledge Graph');
    expect(formatted).toContain('read_file');
  });
});
