/**
 * Neo4j GraphRAG Adapter — connect knowledge graph to Neo4j for production GraphRAG.
 * [v0.8.0] Based on Microsoft GraphRAG architecture: entity extraction → community detection → hybrid retrieval.
 *
 * Usage:
 *   const graph = new Neo4jGraphAdapter('bolt://localhost:7687', 'neo4j', password);
 *   await graph.connect();
 *   const entities = await graph.searchEntities('TypeScript', 10);
 *   const paths = await graph.traverseRelationships('TypeScript', 2);
 *   await graph.disconnect();
 *
 * Environment:
 *   NEO4J_URI — Bolt URI (default: bolt://localhost:7687)
 *   NEO4J_USER — Username (default: neo4j)
 *   NEO4J_PASSWORD — Password
 */

import neo4j, { type Driver, type Session } from 'neo4j-driver';

export interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description: string;
  properties: Record<string, string>;
  relations: Array<{ target: string; type: string; weight: number }>;
}

export interface Community {
  id: string;
  level: number;
  entities: string[];
  summary: string;
}

export class Neo4jGraphAdapter {
  private driver: Driver | null = null;
  private uri: string;
  private user: string;
  private password: string;

  constructor(uri?: string, user?: string, password?: string) {
    this.uri = uri || process.env.NEO4J_URI || 'bolt://localhost:7687';
    this.user = user || process.env.NEO4J_USER || 'neo4j';
    this.password = password || process.env.NEO4J_PASSWORD || '';
  }

  /** Connect to Neo4j and verify connectivity. */
  async connect(): Promise<void> {
    this.driver = neo4j.driver(
      this.uri,
      neo4j.auth.basic(this.user, this.password),
      { disableLosslessIntegers: true }
    );
    await this.driver.verifyConnectivity();
  }

  /** Close the connection. */
  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  private getSession(): Session {
    if (!this.driver) throw new Error('Neo4j not connected. Call connect() first.');
    return this.driver.session();
  }

  /**
   * Search entities by text similarity (requires vector index).
   * Falls back to Cypher CONTAINS search if no vector index exists.
   */
  async searchEntities(query: string, limit: number = 10): Promise<GraphEntity[]> {
    const session = this.getSession();
    try {
      // Try vector search first, fall back to text search
      try {
        const result = await session.executeRead((tx) =>
          tx.run(
            `CALL db.index.vector.queryNodes('entityEmbeddings', $limit, $embedding)
             YIELD node AS entity, score
             RETURN entity.name AS name, entity.type AS type,
                    entity.description AS description, score
             ORDER BY score DESC LIMIT $limit`,
            { embedding: [], limit: neo4j.int(limit) } // placeholder embedding
          )
        );
        return result.records.map((r) => ({
          id: r.get('name'),
          name: r.get('name'),
          type: r.get('type') || 'concept',
          description: r.get('description') || '',
          properties: {},
          relations: [],
        }));
      } catch {
        // Vector index not available — use text search
        const result = await session.executeRead((tx) =>
          tx.run(
            `MATCH (e:Entity)
             WHERE toLower(e.name) CONTAINS toLower($query)
                OR toLower(e.description) CONTAINS toLower($query)
             RETURN e.name AS name, e.type AS type,
                    e.description AS description
             LIMIT $limit`,
            { query, limit: neo4j.int(limit) }
          )
        );
        return result.records.map((r) => ({
          id: r.get('name'),
          name: r.get('name'),
          type: r.get('type') || 'concept',
          description: r.get('description') || '',
          properties: {},
          relations: [],
        }));
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Traverse relationships from an entity (multi-hop).
   */
  async traverseRelationships(entityName: string, depth: number = 2): Promise<GraphEntity[]> {
    const session = this.getSession();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH path = (e:Entity {name: $name})-[*1..${depth}]-(related:Entity)
           RETURN DISTINCT related.name AS name, related.type AS type,
                  related.description AS description
           LIMIT 50`,
          { name: entityName }
        )
      );

      return result.records.map((r) => ({
        id: r.get('name'),
        name: r.get('name'),
        type: r.get('type') || 'concept',
        description: r.get('description') || '',
        properties: {},
        relations: [],
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Store an entity in the graph.
   */
  async storeEntity(entity: GraphEntity): Promise<void> {
    const session = this.getSession();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `MERGE (e:Entity {name: $name})
           SET e.type = $type, e.description = $description`,
          { name: entity.name, type: entity.type, description: entity.description }
        )
      );

      // Store relations
      for (const rel of entity.relations) {
        await session.executeWrite((tx) =>
          tx.run(
            `MATCH (a:Entity {name: $source})
             MATCH (b:Entity {name: $target})
             MERGE (a)-[r:RELATED_TO {type: $relType}]->(b)
             SET r.weight = $weight`,
            {
              source: entity.name,
              target: rel.target,
              relType: rel.type,
              weight: rel.weight || 0.5,
            }
          )
        );
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Run Leiden community detection on the graph.
   * Requires Neo4j GDS (Graph Data Science) plugin.
   */
  async detectCommunities(): Promise<{ communityCount: number; modularity: number }> {
    const session = this.getSession();
    try {
      // Create graph projection
      await session.executeWrite((tx) =>
        tx.run(`
          CALL gds.graph.project(
            'graphRAG',
            'Entity',
            { RELATED_TO: { orientation: 'UNDIRECTED' } }
          )
        `)
      );

      // Run Leiden
      const result = await session.executeWrite((tx) =>
        tx.run(`
          CALL gds.leiden.write('graphRAG', {
            resolution: 1.0,
            maxLevels: 10,
            maxIterations: 10,
            writeProperty: 'community'
          })
          YIELD communityCount, modularity
          RETURN communityCount, modularity
        `)
      );

      return {
        communityCount: result.records[0]?.get('communityCount') ?? 0,
        modularity: result.records[0]?.get('modularity') ?? 0,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get community summaries for global search.
   */
  async getCommunitySummaries(limit: number = 20): Promise<Community[]> {
    const session = this.getSession();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (e:Entity)
           WHERE e.community IS NOT NULL
           WITH e.community AS cid, collect(e.name) AS entities
           RETURN cid, entities, size(entities) AS entityCount
           ORDER BY entityCount DESC
           LIMIT $limit`,
          { limit: neo4j.int(limit) }
        )
      );

      return result.records.map((r) => ({
        id: String(r.get('cid')),
        level: 0,
        entities: r.get('entities') || [],
        summary: `Community with ${r.get('entityCount')} entities: ${(r.get('entities') || []).slice(0, 5).join(', ')}...`,
      }));
    } finally {
      await session.close();
    }
  }

  /** Get graph statistics. */
  async stats(): Promise<{ entities: number; relationships: number; communities: number }> {
    const session = this.getSession();
    try {
      const entityResult = await session.executeRead((tx) => tx.run('MATCH (e:Entity) RETURN count(e) AS count'));
      const relResult = await session.executeRead((tx) => tx.run('MATCH ()-[r:RELATED_TO]->() RETURN count(r) AS count'));

      let communityCount = 0;
      try {
        const commResult = await session.executeRead((tx) =>
          tx.run('MATCH (e:Entity) WHERE e.community IS NOT NULL RETURN count(DISTINCT e.community) AS count')
        );
        communityCount = commResult.records[0]?.get('count') ?? 0;
      } catch { /* no communities yet */ }

      return {
        entities: entityResult.records[0]?.get('count') ?? 0,
        relationships: relResult.records[0]?.get('count') ?? 0,
        communities: communityCount,
      };
    } finally {
      await session.close();
    }
  }
}
