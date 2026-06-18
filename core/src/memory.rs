use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MemoryEntry {
    pub role: String,
    pub content: String,
    pub embedding: Option<Vec<f32>>, // Vector representation for semantic search
}

pub struct MemoryManager {
    pub history: VecDeque<MemoryEntry>,
    pub max_tokens: usize,
}

impl MemoryManager {
    pub fn new() -> Self {
        Self {
            history: VecDeque::new(),
            max_tokens: 4000,
        }
    }

    pub fn add_message(&mut self, role: &str, content: &str, embedding: Option<Vec<f32>>) {
        self.history.push_back(MemoryEntry {
            role: role.to_string(),
            content: content.to_string(),
            embedding,
        });

        self.prune_memory();
    }

    fn prune_memory(&mut self) {
        // Use a simple heuristic for token counting (1 token approx 4 characters)
        // This avoids the heavy 'tokenizers' dependency that crashes in Termux
        let mut current_tokens = self
            .history
            .iter()
            .map(|m| m.content.len() / 4)
            .sum::<usize>();

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

    /// Performs semantic search using cosine similarity
    pub fn semantic_search(&self, query_embedding: &[f32], top_k: usize) -> Vec<MemoryEntry> {
        let mut scored_entries: Vec<(f32, &MemoryEntry)> = self
            .history
            .iter()
            .filter_map(|entry| {
                entry.embedding.as_ref().map(|emb| {
                    let score = self.cosine_similarity(query_embedding, emb);
                    (score, entry)
                })
            })
            .collect();

        // Sort by score descending
        scored_entries.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        scored_entries
            .into_iter()
            .take(top_k)
            .map(|(_, entry)| entry.clone())
            .collect()
    }

    fn cosine_similarity(&self, a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() {
            return 0.0;
        }

        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            0.0
        } else {
            dot_product / (norm_a * norm_b)
        }
    }

    /// Combines recent history and semantic context for the LLM
    pub fn get_augmented_context(&self, query_embedding: &[f32], top_k: usize) -> String {
        let mut context = self.get_context();

        let relevant_memories = self.semantic_search(query_embedding, top_k);

        if !relevant_memories.is_empty() {
            context.push_str("\n\n--- Relevant Long-term Memories ---\n");
            for mem in relevant_memories {
                context.push_str(&format!("{}: {}\n", mem.role, mem.content));
            }
        }

        context
    }
}
