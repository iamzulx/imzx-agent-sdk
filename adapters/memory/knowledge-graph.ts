/**
 * Knowledge Graph — entity-relationship memory for smarter retrieval.
 *
 * Based on:
 * - Mem0 graph memory (58K stars): 2% higher score than base Mem0 on LOCOMO
 * - Neo4j Lenny's Memory: context graphs for AI agents
 * - Cognee: self-improving AI memory with knowledge graphs
 * - SAGE (Peking University 2026): self-evolving graph memory
 *
 * Implements:
 * - Entities with types and properties
 * - Relations with adjacency lists for O(1) traversal
 * - Automatic entity extraction from messages
 * - Co-occurrence relationship creation
 * - Graph query with filtering
 * - JSON persistence
 * - Prompt injection for LLM context
 */

export interface Entity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, string>;
  mentions: number;
  first_seen: string;
  last_seen: string;
}

export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  properties: Record<string, string>;
  weight: number;
  created_at: string;
}

export class KnowledgeGraph {
  private entities: Map<string, Entity> = new Map();
  private relations: Map<string, Relation> = new Map();
  private adjacency: Map<string, string[]> = new Map();

  // --- Entity CRUD ---

  addEntity(type: string, name: string, properties: Record<string, string> = {}): Entity {
    const existing = Array.from(this.entities.values()).find(
      e => e.type === type && e.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      existing.mentions++;
      existing.last_seen = new Date().toISOString();
      Object.assign(existing.properties, properties);
      return existing;
    }

    const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const entity: Entity = { id, type, name, properties, mentions: 1, first_seen: now, last_seen: now };
    this.entities.set(id, entity);
    return entity;
  }

  getEntity(id: string): Entity | undefined { return this.entities.get(id); }

  deleteEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    const relIds = this.adjacency.get(id) || [];
    for (const relId of relIds) {
      const rel = this.relations.get(relId);
      if (rel) {
        this.relations.delete(relId);
        const otherId = rel.source_id === id ? rel.target_id : rel.source_id;
        const otherList = this.adjacency.get(otherId);
        if (otherList) {
          const idx = otherList.indexOf(relId);
          if (idx >= 0) otherList.splice(idx, 1);
        }
      }
    }
    this.adjacency.delete(id);
    this.entities.delete(id);
    return true;
  }

  // --- Relations ---

  addRelation(sourceId: string, targetId: string, type: string, properties: Record<string, string> = {}, weight: number = 1.0): Relation | null {
    if (!this.entities.has(sourceId) || !this.entities.has(targetId)) return null;
    const id = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const relation: Relation = { id, source_id: sourceId, target_id: targetId, type, properties, weight, created_at: new Date().toISOString() };
    this.relations.set(id, relation);
    if (!this.adjacency.has(sourceId)) this.adjacency.set(sourceId, []);
    if (!this.adjacency.has(targetId)) this.adjacency.set(targetId, []);
    this.adjacency.get(sourceId)!.push(id);
    this.adjacency.get(targetId)!.push(id);
    return relation;
  }

  getRelations(entityId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): Relation[] {
    return (this.adjacency.get(entityId) || [])
      .map(id => this.relations.get(id))
      .filter((r): r is Relation => {
        if (!r) return false;
        if (direction === 'outgoing' && r.source_id !== entityId) return false;
        if (direction === 'incoming' && r.target_id !== entityId) return false;
        return true;
      });
  }

  getConnected(entityId: string, relationType?: string): Entity[] {
    return this.getRelations(entityId, 'both')
      .filter(r => !relationType || r.type === relationType)
      .map(r => {
        const otherId = r.source_id === entityId ? r.target_id : r.source_id;
        return this.entities.get(otherId);
      })
      .filter((e): e is Entity => !!e);
  }

  // --- Auto-Extraction ---

  extractEntities(message: string): Array<{ name: string; type: string }> {
    const entities: Array<{ name: string; type: string }> = [];
    const seen = new Set<string>();

    const add = (name: string, type: string) => {
      const key = `${type}:${name.toLowerCase()}`;
      if (!seen.has(key)) { entities.push({ name, type }); seen.add(key); }
    };

    for (const m of message.matchAll(/[\w/.-]+\.(ts|js|rs|py|json|md|toml|yaml|yml)/g)) add(m[0], 'file');
    for (const m of message.matchAll(/https?:\/\/[^\s]+/g)) add(m[0], 'url');
    for (const m of message.matchAll(/"([^"]{3,50})"/g)) add(m[1], 'concept');

    const tools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'run_command', 'search_files', 'web_search', 'web_fetch', 'calculate', 'run_code'];
    for (const t of tools) { if (message.includes(t)) add(t, 'tool'); }

    const stops = new Set(['The', 'This', 'That', 'What', 'When', 'Where', 'How', 'Why', 'Can', 'Fix', 'Add', 'Run', 'Use', 'Get', 'Set']);
    for (const m of message.matchAll(/\b[A-Z][a-z]{2,}\b/g)) { if (!stops.has(m[0])) add(m[0], 'concept'); }

    return entities;
  }

  processMessage(message: string): void {
    const extracted = this.extractEntities(message);
    for (const { name, type } of extracted) this.addEntity(type, name);

    const ids = extracted
      .map(e => Array.from(this.entities.values()).find(ge => ge.type === e.type && ge.name.toLowerCase() === e.name.toLowerCase())?.id)
      .filter(Boolean) as string[];

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        this.addRelation(ids[i], ids[j], 'co_occurs', {}, 0.3);
      }
    }
  }

  // --- Search ---

  search(query: string, limit: number = 5): Array<{ entity: Entity; context: string }> {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = Array.from(this.entities.values()).map(entity => {
      let score = 0;
      const nameLower = entity.name.toLowerCase();
      if (nameLower.includes(query.toLowerCase())) score += 50;
      for (const word of words) {
        if (nameLower.includes(word)) score += 20;
        for (const val of Object.values(entity.properties)) { if (val.toLowerCase().includes(word)) score += 10; }
      }
      score += Math.min(entity.mentions, 10);
      const ageDays = (Date.now() - new Date(entity.last_seen).getTime()) / 86400000;
      score += Math.max(0, 5 - ageDays);
      return { entity, score };
    });

    return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(s => {
      const rels = this.getRelations(s.entity.id, 'outgoing').slice(0, 3);
      const ctx = rels.map(r => { const t = this.entities.get(r.target_id); return `→${r.type}→${t?.name || '?'}`; }).join('; ');
      return { entity: s.entity, context: ctx || s.entity.name };
    });
  }

  // --- Prompt Injection ---

  formatForPrompt(query?: string): string {
    let entities = query ? this.search(query, 5).map(r => r.entity) :
      Array.from(this.entities.values()).sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()).slice(0, 10);
    if (entities.length === 0) return '';

    const parts = entities.map(e => {
      const props = Object.entries(e.properties).map(([k, v]) => `${k}: ${v}`).join(', ');
      const rels = this.getRelations(e.id, 'outgoing').slice(0, 3).map(r => { const t = this.entities.get(r.target_id); return `→ ${r.type} → ${t?.name || '?'}`; });
      return `- [${e.type}] ${e.name} (mentioned ${e.mentions}x)${props ? ': ' + props : ''}${rels.length ? '\n  ' + rels.join('\n  ') : ''}`;
    });

    return `\n\n## Knowledge Graph:\n${parts.join('\n')}`;
  }

  // --- Stats & Persistence ---

  stats(): { entities: number; relations: number; topEntities: Array<{ name: string; type: string; mentions: number }> } {
    return {
      entities: this.entities.size,
      relations: this.relations.size,
      topEntities: Array.from(this.entities.values()).sort((a, b) => b.mentions - a.mentions).slice(0, 10).map(e => ({ name: e.name, type: e.type, mentions: e.mentions })),
    };
  }

  export(): string { return JSON.stringify({ entities: Array.from(this.entities.values()), relations: Array.from(this.relations.values()) }, null, 2); }

  import(json: string): void {
    const data = JSON.parse(json) as { entities: Entity[]; relations: Relation[] };
    for (const e of data.entities) this.entities.set(e.id, e);
    for (const r of data.relations) {
      this.relations.set(r.id, r);
      if (!this.adjacency.has(r.source_id)) this.adjacency.set(r.source_id, []);
      if (!this.adjacency.has(r.target_id)) this.adjacency.set(r.target_id, []);
      this.adjacency.get(r.source_id)!.push(r.id);
      this.adjacency.get(r.target_id)!.push(r.id);
    }
  }
}
