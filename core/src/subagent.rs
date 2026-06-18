// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Subagent module — spawn child agents with isolated context.
// Inspired by Claude Agent SDK subagents and Anthropic's orchestrator-workers pattern.
// Each subagent gets its own memory, tools, and budget but shares the LLM registry.

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::agent::{Agent, AgentState, BudgetConfig};
use crate::llm::ModelRegistry;
use crate::memory::MemoryManager;
use crate::tools::ToolRegistry;

/// Subagent task — what to delegate to a child agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentTask {
    pub task_id: String,
    pub prompt: String,
    pub context: Option<String>,
    pub max_iterations: Option<u32>,
    pub budget_override: Option<BudgetConfig>,
}

/// Result from a completed subagent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentResult {
    pub task_id: String,
    pub response: String,
    pub iterations_used: u32,
    pub tokens_used: u64,
    pub success: bool,
    pub error: Option<String>,
}

/// Subagent — a child agent with isolated execution context.
pub struct Subagent {
    pub task: SubagentTask,
    pub agent: Agent,
}

impl Subagent {
    /// Create a new subagent from a task, inheriting the parent's LLM registry.
    pub fn new(mut task: SubagentTask, llm_registry: ModelRegistry, default_model: String) -> Self {
        let mut agent = Agent::new(
            format!("subagent-{}", task.task_id),
            "Subagent worker".to_string(),
            task.prompt.clone(),
        );
        agent.llm_registry = llm_registry;
        agent.default_model = default_model;

        if let Some(budget) = task.budget_override.take() {
            agent.budget = budget;
        }

        // Prepend context to the prompt if provided
        if let Some(ctx) = &task.context {
            agent.prompt = format!("{}\n\n## Context from parent:\n{}", agent.prompt, ctx);
        }

        Self { task, agent }
    }

    /// Execute the subagent task and return the result.
    pub async fn execute(&mut self) -> SubagentResult {
        // Note: Agent.run() already enforces max 10 iterations internally
        // Subagents use a shorter default

        match self.agent.run(&self.task.prompt).await {
            Ok(response) => SubagentResult {
                task_id: self.task.task_id.clone(),
                response,
                iterations_used: self.agent.stats.request_count as u32,
                tokens_used: self.agent.stats.total_input_tokens
                    + self.agent.stats.total_output_tokens,
                success: true,
                error: None,
            },
            Err(e) => SubagentResult {
                task_id: self.task.task_id.clone(),
                response: String::new(),
                iterations_used: self.agent.stats.request_count as u32,
                tokens_used: self.agent.stats.total_input_tokens
                    + self.agent.stats.total_output_tokens,
                success: false,
                error: Some(e.to_string()),
            },
        }
    }
}

/// Subagent orchestrator — manages multiple child agents.
/// Supports parallel execution (tokio::join!) and sequential pipelines.
pub struct SubagentOrchestrator {
    llm_registry: ModelRegistry,
    default_model: String,
    max_concurrent: usize,
}

impl SubagentOrchestrator {
    pub fn new(llm_registry: ModelRegistry, default_model: String, max_concurrent: usize) -> Self {
        Self {
            llm_registry,
            default_model,
            max_concurrent,
        }
    }

    /// Execute multiple subagent tasks in parallel (bounded by max_concurrent).
    pub async fn execute_parallel(&self, tasks: Vec<SubagentTask>) -> Vec<SubagentResult> {
        let mut results = Vec::with_capacity(tasks.len());

        // Process in chunks of max_concurrent
        for chunk in tasks.chunks(self.max_concurrent) {
            let mut handles = Vec::new();

            for task in chunk {
                let task = task.clone();
                let registry = self.llm_registry.clone();
                let model = self.default_model.clone();

                handles.push(tokio::spawn(async move {
                    let mut subagent = Subagent::new(task, registry, model);
                    subagent.execute().await
                }));
            }

            for handle in handles {
                match handle.await {
                    Ok(result) => results.push(result),
                    Err(e) => results.push(SubagentResult {
                        task_id: "unknown".to_string(),
                        response: String::new(),
                        iterations_used: 0,
                        tokens_used: 0,
                        success: false,
                        error: Some(format!("Subagent panic: {}", e)),
                    }),
                }
            }
        }

        results
    }

    /// Execute subagent tasks sequentially (pipeline pattern).
    pub async fn execute_sequential(&self, tasks: Vec<SubagentTask>) -> Vec<SubagentResult> {
        let mut results = Vec::with_capacity(tasks.len());

        for task in tasks {
            let mut subagent =
                Subagent::new(task, self.llm_registry.clone(), self.default_model.clone());
            results.push(subagent.execute().await);
        }

        results
    }

    /// Map-reduce pattern: execute all tasks in parallel, then synthesize.
    pub async fn execute_map_reduce(
        &self,
        tasks: Vec<SubagentTask>,
        synthesis_prompt: &str,
    ) -> SubagentResult {
        // Map phase — parallel execution
        let results = self.execute_parallel(tasks).await;

        // Reduce phase — synthesize results
        let combined_context: String = results
            .iter()
            .filter(|r| r.success)
            .map(|r| format!("[Task {}]: {}", r.task_id, r.response))
            .collect::<Vec<_>>()
            .join("\n\n");

        let synthesis_task = SubagentTask {
            task_id: "synthesis".to_string(),
            prompt: synthesis_prompt.to_string(),
            context: Some(combined_context),
            max_iterations: Some(3),
            budget_override: None,
        };

        let mut synthesis_agent = Subagent::new(
            synthesis_task,
            self.llm_registry.clone(),
            self.default_model.clone(),
        );
        synthesis_agent.execute().await
    }
}
