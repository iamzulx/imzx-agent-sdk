// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Embedding module — TF-IDF vectorizer for semantic search.
// [H1 FIX] Replaced hash-based embedding with real TF-IDF implementation.
// Zero external dependencies — pure Rust, no ML model needed.

use anyhow::Result;
use std::collections::HashMap;

/// TF-IDF embedder — produces sparse vectors from text.
/// Vocabulary capped at 10,000 terms for memory efficiency.
pub struct LocalEmbedder {
    vocab: HashMap<String, usize>,
    idf: HashMap<String, f64>,
    doc_count: usize,
    max_vocab: usize,
}

impl LocalEmbedder {
    pub fn new() -> Result<Self> {
        Ok(Self {
            vocab: HashMap::new(),
            idf: HashMap::new(),
            doc_count: 0,
            max_vocab: 10_000,
        })
    }

    /// Fit the embedder on a corpus of documents.
    pub fn fit(&mut self, documents: &[String]) {
        self.doc_count = documents.len();
        let mut doc_freq: HashMap<String, usize> = HashMap::new();

        for doc in documents {
            let tokens: Vec<String> = self.tokenize(doc);
            let unique: std::collections::HashSet<&String> = tokens.iter().collect();
            for token in unique {
                *doc_freq.entry(token.clone()).or_insert(0) += 1;
            }
        }

        // Build vocabulary (top N by document frequency)
        let mut freq_vec: Vec<(String, usize)> = doc_freq.into_iter().collect();
        freq_vec.sort_by_key(|b| std::cmp::Reverse(b.1));
        freq_vec.truncate(self.max_vocab);

        self.vocab.clear();
        self.idf.clear();
        for (i, (term, df)) in freq_vec.iter().enumerate() {
            self.vocab.insert(term.clone(), i);
            // Smoothed IDF: log((N+1)/(df+1)) + 1
            let idf_val = ((self.doc_count as f64 + 1.0) / (*df as f64 + 1.0)).ln() + 1.0;
            self.idf.insert(term.clone(), idf_val);
        }
    }

    /// Embed text into a TF-IDF vector (dense, vocab-sized).
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        if text.is_empty() {
            return Err(anyhow::anyhow!("Cannot embed empty text"));
        }

        let tokens = self.tokenize(text);
        if tokens.is_empty() {
            return Ok(vec![0.0; self.vocab.len()]);
        }

        let mut tf: HashMap<String, f64> = HashMap::new();
        for token in &tokens {
            *tf.entry(token.clone()).or_insert(0.0) += 1.0;
        }

        let mut vec = vec![0.0f32; self.vocab.len()];
        let len = tokens.len() as f64;

        for (term, freq) in &tf {
            if let Some(&idx) = self.vocab.get(term) {
                let idf = self.idf.get(term).copied().unwrap_or(1.0);
                vec[idx] = ((freq / len) * idf) as f32;
            }
        }

        Ok(vec)
    }

    /// Cosine similarity between two vectors.
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm_a == 0.0 || norm_b == 0.0 {
            0.0
        } else {
            dot / (norm_a * norm_b)
        }
    }

    /// Get vocabulary size.
    pub fn vocab_size(&self) -> usize {
        self.vocab.len()
    }

    // ── Internal ───────────────────────────────────────────────────────────

    fn tokenize(&self, text: &str) -> Vec<String> {
        let stopwords: std::collections::HashSet<&str> = [
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do",
            "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can",
            "need", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
            "as", "into", "through", "during", "dan", "di", "ke", "dari", "ini", "itu", "yang",
            "untuk", "dengan", "pada", "adalah", "akan", "oleh",
        ]
        .iter()
        .cloned()
        .collect();

        text.to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .filter(|w| w.len() > 2 && !stopwords.contains(w))
            .map(|w| w.to_string())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embed_empty_fails() {
        let embedder = LocalEmbedder::new().unwrap();
        assert!(embedder.embed("").is_err());
    }

    #[test]
    fn test_embed_produces_vector() {
        let mut embedder = LocalEmbedder::new().unwrap();
        embedder.fit(&["hello world rust programming".to_string()]);
        let vec = embedder.embed("hello rust").unwrap();
        assert!(!vec.is_empty());
        assert!(vec.len() <= 10_000);
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0, 2.0, 3.0];
        let sim = LocalEmbedder::cosine_similarity(&v, &v);
        assert!((sim - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let sim = LocalEmbedder::cosine_similarity(&a, &b);
        assert!(sim.abs() < 0.001);
    }

    #[test]
    fn test_fit_then_search() {
        let docs = vec![
            "rust programming language".to_string(),
            "python machine learning".to_string(),
            "rust memory safety".to_string(),
        ];
        let mut embedder = LocalEmbedder::new().unwrap();
        embedder.fit(&docs);

        let q = embedder.embed("rust safety").unwrap();
        let d0 = embedder.embed(&docs[0]).unwrap();
        let d1 = embedder.embed(&docs[1]).unwrap();
        let d2 = embedder.embed(&docs[2]).unwrap();

        let sim_rust = LocalEmbedder::cosine_similarity(&q, &d0);
        let sim_python = LocalEmbedder::cosine_similarity(&q, &d1);
        let sim_safety = LocalEmbedder::cosine_similarity(&q, &d2);

        // "rust safety" should be closer to doc0 and doc2 than doc1
        assert!(sim_rust > sim_python);
        assert!(sim_safety > sim_python);
    }
}
