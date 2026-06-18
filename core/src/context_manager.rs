// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Context manager — token budgeting, compaction, progressive disclosure.
// Based on Anthropic's "Effective Context Engineering for AI Agents" (Sep 2025).
// Key insight: context is a finite resource with diminishing marginal returns.
// Must be curated, not stuffed.

use std::collections::VecDeque;
use serde::{Serialize, Deserialize};
use anyhow::Result;

/// A context entry with metadata for intelligent pruning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextEntry {
    pub content: String,
    pub role: ContextRole,
    pub token_estimate: usize,
    pub priority: Priority,
    pub source: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ContextRole {
    System,
    UserMessage,
    AssistantResponse,
    ToolResult,
    Plan,
    Observation,
    Memory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// Must never be pruned (system prompt, current user message).
    Critical = 0,
    /// High-value context (recent tool results, active plan).
    High = 1,
    /// Normal context (recent conversation turns).
    Normal = 2,
    /// Low priority (old observations, distant history).
    Low = 3,
    /// Can be freely discarded.
    Disposable = 4,
}

/// Compaction strategy — how to reduce context size.
#[derive(Debug, Clone)]
pub enum CompactionStrategy {
    /// Remove oldest low-priority entries.
    PruneOldest,
    /// Summarize old entries into a single summary.
    Summarize,
    /// Keep only the N most recent entries per role.
    SlidingWindow { max_per_role: usize },
    /// Drop all Disposable entries, then Low entries if still over budget.
    PriorityBased,
}

/// Context window configuration.
#[derive(Debug, Clone)]
pub struct ContextConfig {
    /// Maximum tokens in the context window.
    pub max_tokens: usize,
    /// Reserve tokens for the response.
    pub response_reserve: usize,
    /// Compaction trigger threshold (0.0-1.0).
    pub compaction_threshold: f64,
    /// Default compaction strategy.
    pub strategy: CompactionStrategy,
    /// Whether to enable progressive disclosure.
    pub progressive_disclosure: bool,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            max_tokens: 100_000,
            response_reserve: 4_096,
            compaction_threshold: 0.8,
            strategy: CompactionStrategy::PriorityBased,
            progressive_disclosure: true,
        }
    }
}

/// Context manager — curates the optimal set of tokens for each inference.
pub struct ContextManager {
    config: ContextConfig,
    entries: VecDeque<ContextEntry>,
    total_tokens: usize,
    compaction_count: u32,
}

impl ContextManager {
    pub fn new(config: ContextConfig) -> Self {
        Self {
            config,
            entries: VecDeque::new(),
            total_tokens: 0,
            compaction_count: 0,
        }
    }

    /// Add a new context entry. Triggers compaction if over threshold.
    pub fn push(&mut self, entry: ContextEntry) {
        self.total_tokens += entry.token_estimate;
        self.entries.push_back(entry);

        if self.usage_ratio() >= self.config.compaction_threshold {
            self.compact();
        }
    }

    /// Current token usage ratio (0.0 - 1.0).
    pub fn usage_ratio(&self) -> f64 {
        let available = self.config.max_tokens - self.config.response_reserve;
        self.total_tokens as f64 / available as f64
    }

    /// Available tokens for new content.
    pub fn available_tokens(&self) -> usize {
        let available = self.config.max_tokens - self.config.response_reserve;
        available.saturating_sub(self.total_tokens)
    }

    /// Get all entries as a single context string, ordered by priority then timestamp.
    pub fn render(&self) -> String {
        let mut sorted: Vec<&ContextEntry> = self.entries.iter().collect();
        sorted.sort_by(|a, b| {
            a.priority.cmp(&b.priority)
                .then_with(|| a.timestamp.cmp(&b.timestamp))
        });

        sorted.iter()
            .map(|e| e.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// Render only entries of a specific role.
    pub fn render_by_role(&self, role: &ContextRole) -> String {
        self.entries.iter()
            .filter(|e| &e.role == role)
            .map(|e| e.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// Run compaction based on the configured strategy.
    pub fn compact(&mut self) {
        match &self.config.strategy.clone() {
            CompactionStrategy::PriorityBased => {
                // First: remove all Disposable entries
                self.entries.retain(|e| e.priority != Priority::Disposable);
                self.recalculate_tokens();

                // If still over threshold, remove Low entries
                if self.usage_ratio() >= self.config.compaction_threshold {
                    self.entries.retain(|e| e.priority != Priority::Low);
                    self.recalculate_tokens();
                }
            }
            CompactionStrategy::PruneOldest => {
                // Remove oldest non-critical entries until under threshold
                while self.usage_ratio() >= self.config.compaction_threshold && !self.entries.is_empty() {
                    if let Some(idx) = self.entries.iter().position(|e| e.priority != Priority::Critical) {
                        let removed = self.entries.remove(idx).unwrap();
                        self.total_tokens = self.total_tokens.saturating_sub(removed.token_estimate);
                    } else {
                        break;
                    }
                }
            }
            CompactionStrategy::SlidingWindow { max_per_role } => {
                let max = *max_per_role;
                // For each role, keep only the most recent N entries
                let roles = [ContextRole::ToolResult, ContextRole::Observation, ContextRole::AssistantResponse];
                for role in &roles {
                    let role_entries: Vec<usize> = self.entries.iter()
                        .enumerate()
                        .filter(|(_, e)| &e.role == role && e.priority != Priority::Critical)
                        .map(|(i, _)| i)
                        .collect();

                    if role_entries.len() > max {
                        let to_remove = &role_entries[..role_entries.len() - max];
                        for &idx in to_remove.iter().rev() {
                            if let Some(removed) = self.entries.remove(idx) {
                                self.total_tokens = self.total_tokens.saturating_sub(removed.token_estimate);
                            }
                        }
                    }
                }
            }
            CompactionStrategy::Summarize => {
                // Summarize is a no-op at the Rust level — requires LLM call.
                // Fallback to PriorityBased pruning.
                self.config.strategy = CompactionStrategy::PriorityBased;
                self.compact();
                return;
            }
        }
        self.compaction_count += 1;
    }

    fn recalculate_tokens(&mut self) {
        self.total_tokens = self.entries.iter().map(|e| e.token_estimate).sum();
    }

    /// Progressive disclosure: get a summary of available context without full content.
    /// Returns metadata about what's in the context window.
    pub fn disclosure_summary(&self) -> ContextDisclosure {
        let mut by_role = std::collections::HashMap::new();
        for entry in &self.entries {
            let count = by_role.entry(format!("{:?}", entry.role)).or_insert(0usize);
            *count += 1;
        }

        ContextDisclosure {
            total_entries: self.entries.len(),
            total_tokens: self.total_tokens,
            available_tokens: self.available_tokens(),
            usage_pct: (self.usage_ratio() * 100.0) as u8,
            entries_by_role: by_role,
            compaction_count: self.compaction_count,
        }
    }

    /// Get statistics about the context window.
    pub fn stats(&self) -> (usize, usize, f64, u32) {
        (self.entries.len(), self.total_tokens, self.usage_ratio(), self.compaction_count)
    }

    /// Clear all non-critical entries.
    pub fn clear(&mut self) {
        self.entries.retain(|e| e.priority == Priority::Critical);
        self.recalculate_tokens();
    }
}

/// Summary of context window state for progressive disclosure.
#[derive(Debug, Serialize)]
pub struct ContextDisclosure {
    pub total_entries: usize,
    pub total_tokens: usize,
    pub available_tokens: usize,
    pub usage_pct: u8,
    pub entries_by_role: std::collections::HashMap<String, usize>,
    pub compaction_count: u32,
}

/// Estimate token count from text (1 token ≈ 4 chars for English, ~2-3 for code).
pub fn estimate_tokens(text: &str) -> usize {
    // Heuristic: count words + punctuation, roughly 1.3 tokens per word
    let word_count = text.split_whitespace().count();
    let char_estimate = text.len() / 4;
    // Use the average of both heuristics
    (word_count * 13 / 10).max(char_estimate).max(1)
}
