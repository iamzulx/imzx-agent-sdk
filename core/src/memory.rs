// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Memory module — conversation history with persistence and semantic search.
// [H4 FIX] Added JSON persistence to .imzx/memory.json

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MemoryEntry {
    pub role: String,
    pub content: String,
    pub embedding: Option<Vec<f32>>,
    pub timestamp: u64,
}

pub struct MemoryManager {
    pub history: VecDeque<MemoryEntry>,
    pub max_tokens: usize,
    persist_path: Option<PathBuf>,
    dirty: bool,
}

impl MemoryManager {
    pub fn new() -> Self {
        Self {
            history: VecDeque::new(),
            max_tokens: 4000,
            persist_path: None,
            dirty: false,
        }
    }

    /// Create with persistence enabled.
    pub fn with_persistence(path: PathBuf) -> Self {
        let mut mgr = Self {
            history: VecDeque::new(),
            max_tokens: 4000,
            persist_path: Some(path),
            dirty: false,
        };
        mgr.load();
        mgr
    }

    pub fn add_message(&mut self, role: &str, content: &str, embedding: Option<Vec<f32>>) {
        self.history.push_back(MemoryEntry {
            role: role.to_string(),
            content: content.to_string(),
            embedding,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
        self.dirty = true;
        self.prune_memory();
    }

    /// Save to disk if dirty.
    pub fn flush(&mut self) {
        if !self.dirty || self.persist_path.is_none() {
            return;
        }
        if let Some(path) = &self.persist_path {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string_pretty(&self.history) {
                let _ = fs::write(path, json);
                self.dirty = false;
            }
        }
    }

    fn load(&mut self) {
        if let Some(path) = &self.persist_path {
            if let Ok(data) = fs::read_to_string(path) {
                if let Ok(entries) = serde_json::from_str::<VecDeque<MemoryEntry>>(&data) {
                    self.history = entries;
                }
            }
        }
    }

    fn prune_memory(&mut self) {
        let mut current_tokens: usize = self.history.iter().map(|m| m.content.len() / 4).sum();
        while current_tokens > self.max_tokens && self.history.len() > 1 {
            if let Some(removed) = self.history.pop_front() {
                current_tokens -= removed.content.len() / 4;
            }
        }
    }

    pub fn get_context(&self) -> String {
        self.history
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<String>>()
            .join("\n")
    }

    /// Semantic search using cosine similarity on embeddings.
    pub fn semantic_search(&self, query_embedding: &[f32], top_k: usize) -> Vec<MemoryEntry> {
        let mut scored: Vec<(f32, &MemoryEntry)> = self
            .history
            .iter()
            .filter_map(|entry| {
                entry.embedding.as_ref().map(|emb| {
                    let score = cosine_similarity(query_embedding, emb);
                    (score, entry)
                })
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
            .into_iter()
            .take(top_k)
            .map(|(_, entry)| entry.clone())
            .collect()
    }

    pub fn len(&self) -> usize {
        self.history.len()
    }

    pub fn is_empty(&self) -> bool {
        self.history.is_empty()
    }

    /// Clear all entries and flush.
    pub fn clear(&mut self) {
        self.history.clear();
        self.dirty = true;
        self.flush();
    }
}

impl Drop for MemoryManager {
    fn drop(&mut self) {
        self.flush();
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_get_context() {
        let mut mgr = MemoryManager::new();
        mgr.add_message("user", "hello", None);
        mgr.add_message("assistant", "hi there", None);
        let ctx = mgr.get_context();
        assert!(ctx.contains("hello"));
        assert!(ctx.contains("hi there"));
    }

    #[test]
    fn test_prune_memory() {
        let mut mgr = MemoryManager::new();
        mgr.max_tokens = 10; // very small
        for i in 0..100 {
            mgr.add_message("user", &format!("message {}", i), None);
        }
        assert!(mgr.len() < 100);
    }

    #[test]
    fn test_semantic_search() {
        let mut mgr = MemoryManager::new();
        mgr.add_message("user", "rust", Some(vec![1.0, 0.0, 0.0]));
        mgr.add_message("user", "python", Some(vec![0.0, 1.0, 0.0]));
        mgr.add_message("user", "rust safety", Some(vec![0.9, 0.1, 0.0]));

        let results = mgr.semantic_search(&[1.0, 0.0, 0.0], 2);
        assert_eq!(results.len(), 2);
        // First result should be "rust" (exact match)
        assert_eq!(results[0].content, "rust");
    }

    #[test]
    fn test_clear() {
        let mut mgr = MemoryManager::new();
        mgr.add_message("user", "test", None);
        mgr.clear();
        assert!(mgr.is_empty());
    }
}
