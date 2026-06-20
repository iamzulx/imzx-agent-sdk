/**
 * TF-IDF Embedding Engine
 * Zero-dependency TF-IDF + cosine similarity for semantic search.
 */

const STOP_WORDS = new Set([
  // English
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','am','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','can','could',
  'not','no','nor','so','if','then','than','that','this','these','those','it',
  'its','he','she','they','we','you','i','me','my','your','his','her','their',
  'our','who','which','what','where','when','how','all','each','every','both',
  'few','more','most','other','some','such','only','own','same','about','above',
  'after','again','also','any','because','before','between','during','here',
  'into','just','over','out','through','under','up','very','while','as',
  // Indonesian
  'yang','di','dan','ini','itu','untuk','dengan','pada','dari','adalah',
  'tidak','ke','oleh','juga','akan','telah','sudah','ada','bisa','dalam',
  'lebih','sangat','atau','jika','karena','namun','serta','bagi','seperti',
  'antara','hanya','masih','pernah','setelah','sebelum','mereka','kami','kita',
  'aku','engkau','beliau','sesuatu','semua','setiap','tiap','mana','apakah',
  'begitu','demikian','lagi','lalu','kemudian','maka','nah','ya','pun','lah',
  'sih','deh','dong',
]);

const MAX_VOCAB = 10_000;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\u024F]+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

export class TfIdfEmbedder {
  private vocab: Map<string, number> = new Map();
  private idf: Float64Array = new Float64Array(0);
  private fitted = false;

  /** Build vocabulary and IDF weights from a corpus. */
  fit(documents: string[]): void {
    const df = new Map<string, number>();
    const N = documents.length;

    for (const doc of documents) {
      const seen = new Set<string>();
      for (const token of tokenize(doc)) {
        if (!seen.has(token)) {
          df.set(token, (df.get(token) ?? 0) + 1);
          seen.add(token);
        }
      }
    }

    // Sort by document frequency descending, cap at MAX_VOCAB
    const sorted = [...df.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VOCAB);

    this.vocab = new Map();
    this.idf = new Float64Array(sorted.length);

    for (let i = 0; i < sorted.length; i++) {
      const [term, docFreq] = sorted[i]!;
      this.vocab.set(term, i);
      // smoothed IDF: log((N + 1) / (df + 1)) + 1
      this.idf[i] = Math.log((N + 1) / (docFreq + 1)) + 1;
    }

    this.fitted = true;
  }

  /** Produce a TF-IDF vector for a piece of text. */
  embed(text: string): Float64Array {
    const vec = new Float64Array(this.vocab.size);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vec;

    // Count term frequencies
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    // TF-IDF: (count / doc_length) * idf
    for (const [term, count] of tf) {
      const idx = this.vocab.get(term);
      if (idx !== undefined) {
        vec[idx] = (count / tokens.length) * this.idf[idx]!;
      }
    }

    return vec;
  }

  /** Cosine similarity between two vectors, returns 0-1. */
  similarity(a: Float64Array, b: Float64Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Find the most similar documents to a query. */
  search(query: string, documents: string[], topK = 5): Array<{ index: number; score: number }> {
    if (!this.fitted) {
      this.fit(documents);
    }
    const qVec = this.embed(query);
    const scores: Array<{ index: number; score: number }> = [];

    for (let i = 0; i < documents.length; i++) {
      const dVec = this.embed(documents[i]!);
      scores.push({ index: i, score: this.similarity(qVec, dVec) });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}

/** Singleton instance for convenience. */
export const tfidfEmbedder = new TfIdfEmbedder();
