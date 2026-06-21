/**
 * Advanced RAG Pipeline — GraphRAG retrieval combining Knowledge Graph + TF-IDF.
 *
 * Features:
 * - TF-IDF vector similarity search (zero-dependency)
 * - Knowledge graph entity-based retrieval
 * - Hybrid ranking: graph context × vector similarity
 * - Chunk-based document storage
 * - Automatic indexing from files/directories
 * - Export/import for persistence
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  path: string;
  content: string;
  chunks: string[];
  metadata: Record<string, string>;
  indexedAt: string;
}

export interface RetrievalResult {
  documentId: string;
  path: string;
  chunk: string;
  score: number;
  source: 'graph' | 'vector' | 'hybrid';
  graphContext?: string[];
}

export interface RAGConfig {
  basePath?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  maxResults?: number;
}

// ─── RAG Pipeline ────────────────────────────────────────────────────────────

export class RAGPipeline {
  private documents: Map<string, Document> = new Map();
  private chunks: Array<{ docId: string; chunk: string }> = [];
  private vocab: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private basePath: string;
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(config: RAGConfig = {}) {
    this.basePath = config.basePath || join(process.cwd(), '.imzx', 'rag');
    this.chunkSize = config.chunkSize || 512;
    this.chunkOverlap = config.chunkOverlap || 64;
    mkdirSync(this.basePath, { recursive: true });
    this.loadIndex();
  }

  /** Index a single file. */
  indexFile(filePath: string, metadata: Record<string, string> = {}): Document | null {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, 'utf-8');
      return this.indexDocument(filePath, content, metadata);
    } catch {
      return null;
    }
  }

  /** Index raw text content. */
  indexDocument(sourcePath: string, content: string, metadata: Record<string, string> = {}): Document {
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const chunks = this.chunkText(content);
    const doc: Document = {
      id, path: sourcePath, content, chunks, metadata,
      indexedAt: new Date().toISOString(),
    };

    this.documents.set(id, doc);
    for (const chunk of chunks) {
      this.chunks.push({ docId: id, chunk });
    }

    this.rebuildIndex();
    this.saveIndex();
    return doc;
  }

  /** Index all files in a directory recursively. */
  indexDirectory(dir: string, extensions: string[] = ['.md', '.txt', '.ts', '.rs']): number {
    let count = 0;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'target') {
          count += this.indexDirectory(fullPath, extensions);
        } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
          this.indexFile(fullPath);
          count++;
        }
      }
    } catch { /* ignore permission errors */ }
    return count;
  }

  /** Search using TF-IDF vector similarity. */
  search(query: string, maxResults: number = 5): RetrievalResult[] {
    const queryTokens = this.tokenize(query);
    const queryVec = this.tfidf(queryTokens);
    const results: RetrievalResult[] = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const chunkTokens = this.tokenize(chunk.chunk);
      const chunkVec = this.tfidf(chunkTokens);
      const score = this.cosineSimilarity(queryVec, chunkVec);

      if (score > 0.01) {
        results.push({
          documentId: chunk.docId,
          path: this.documents.get(chunk.docId)?.path || '',
          chunk: chunk.chunk,
          score,
          source: 'vector',
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * [v0.8.0] Hybrid search — combines TF-IDF vector search with knowledge graph retrieval.
   * Implements GraphRAG pattern: entity extraction → graph traversal → hybrid ranking.
   */
  searchHybrid(
    query: string,
    knowledgeGraph: {
      searchEntities: (query: string, limit?: number) => Array<{ name: string; type: string; properties: Record<string, string>; relations: Array<{ target: string; type: string }> }>;
    },
    maxResults: number = 5
  ): RetrievalResult[] {
    // Step 1: TF-IDF vector search
    const vectorResults = this.search(query, maxResults * 2);

    // Step 2: Knowledge graph entity search
    const graphEntities = knowledgeGraph.searchEntities(query, 10);
    const graphContextChunks: string[] = [];
    const graphContextMap = new Map<string, string[]>();

    for (const entity of graphEntities) {
      // Build context string from entity + relations
      const relDescriptions = entity.relations
        .map(r => `${entity.name} --[${r.type}]--> ${r.target}`)
        .join('; ');
      const contextLine = `${entity.name} (${entity.type}): ${relDescriptions || 'no relations'}`;
      graphContextChunks.push(contextLine);

      // Map entity name to relevant chunk indices
      const entityLower = entity.name.toLowerCase();
      for (let i = 0; i < this.chunks.length; i++) {
        if (this.chunks[i].chunk.toLowerCase().includes(entityLower)) {
          if (!graphContextMap.has(String(i))) graphContextMap.set(String(i), []);
          graphContextMap.get(String(i))!.push(contextLine);
        }
      }
    }

    // Step 3: Hybrid ranking — boost vector results that have graph context
    const hybridResults: RetrievalResult[] = [];

    for (const vr of vectorResults) {
      const chunkIndex = this.chunks.findIndex(c => c.docId === vr.documentId && c.chunk === vr.chunk);
      const graphContext = graphContextMap.get(String(chunkIndex));

      if (graphContext && graphContext.length > 0) {
        // Boost score when both vector AND graph match
        const boostFactor = 1 + Math.min(graphContext.length * 0.2, 0.5);
        hybridResults.push({
          ...vr,
          score: vr.score * boostFactor,
          source: 'hybrid',
          graphContext,
        });
      } else {
        hybridResults.push({ ...vr, source: 'vector' });
      }
    }

    // Step 4: Add pure graph results (chunks that matched entities but not vectors)
    if (graphContextChunks.length > 0) {
      const existingChunkTexts = new Set(hybridResults.map(r => r.chunk));
      for (const gc of graphContextChunks.slice(0, 3)) {
        if (!existingChunkTexts.has(gc)) {
          hybridResults.push({
            documentId: 'graph',
            path: 'knowledge-graph',
            chunk: gc,
            score: 0.3, // base graph score
            source: 'graph',
            graphContext: [gc],
          });
        }
      }
    }

    hybridResults.sort((a, b) => b.score - a.score);
    return hybridResults.slice(0, maxResults);
  }

  /** Get index stats. */
  stats(): { documents: number; chunks: number; vocabularySize: number } {
    return {
      documents: this.documents.size,
      chunks: this.chunks.length,
      vocabularySize: this.vocab.size,
    };
  }

  /** Remove a document from the index. */
  removeDocument(docId: string): boolean {
    if (!this.documents.has(docId)) return false;
    this.documents.delete(docId);
    this.chunks = this.chunks.filter(c => c.docId !== docId);
    this.rebuildIndex();
    this.saveIndex();
    return true;
  }

  /** Clear all indexed data. */
  clear(): void {
    this.documents.clear();
    this.chunks = [];
    this.vocab.clear();
    this.idf.clear();
    this.saveIndex();
  }

  // ── Internal Methods ─────────────────────────────────────────────────────

  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    const words = text.split(/\s+/);
    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + this.chunkSize, words.length);
      chunks.push(words.slice(start, end).join(' '));
      start += this.chunkSize - this.chunkOverlap;
    }
    return chunks.length > 0 ? chunks : [text.slice(0, this.chunkSize)];
  }

  private tokenize(text: string): string[] {
    // Lowercase, remove punctuation, split on whitespace, filter stopwords
    const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used',
      'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'yang', 'untuk', 'dengan', 'pada']);
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w));
  }

  private tfidf(tokens: string[]): Float64Array {
    const vec = new Float64Array(this.vocab.size);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    for (const [term, freq] of tf) {
      const idx = this.vocab.get(term);
      if (idx !== undefined) {
        const idf = this.idf.get(term) || 1;
        vec[idx] = (freq / tokens.length) * idf;
      }
    }
    return vec;
  }

  private cosineSimilarity(a: Float64Array, b: Float64Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private rebuildIndex(): void {
    this.vocab.clear();
    this.idf.clear();
    const docFreq = new Map<string, number>();
    const totalChunks = this.chunks.length || 1;

    for (const { chunk } of this.chunks) {
      const tokens = new Set(this.tokenize(chunk));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
        if (!this.vocab.has(token)) this.vocab.set(token, this.vocab.size);
      }
    }

    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((totalChunks + 1) / (df + 1)) + 1);
    }
  }

  private saveIndex(): void {
    try {
      const data = {
        documents: [...this.documents.entries()],
        chunks: this.chunks.map(c => ({ docId: c.docId, chunk: c.chunk.slice(0, 200) })), // truncate for storage
        vocabSize: this.vocab.size,
      };
      writeFileSync(join(this.basePath, 'index.json'), JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* ignore write errors */ }
  }

  private loadIndex(): void {
    try {
      const indexPath = join(this.basePath, 'index.json');
      if (existsSync(indexPath)) {
        const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
        for (const [id, doc] of data.documents || []) {
          this.documents.set(id, doc as Document);
        }
        // Rebuild chunks from documents
        this.chunks = [];
        for (const doc of this.documents.values()) {
          for (const chunk of doc.chunks) {
            this.chunks.push({ docId: doc.id, chunk });
          }
        }
        this.rebuildIndex();
      }
    } catch { /* start fresh on corruption */ }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _pipeline: RAGPipeline | null = null;
export function getRAGPipeline(config?: RAGConfig): RAGPipeline {
  if (!_pipeline) _pipeline = new RAGPipeline(config);
  return _pipeline;
}
