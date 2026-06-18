// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Agent module — ReAct loop with security hardening.
// Security fixes applied:
//   [C1]  Typed ToolCall parsing + pre-execution validation
//   [M3]  Tool observations sanitized via UntrustedObservation
//   [M4]  Budget cap (max_tokens + budget_usd) enforced

use std::fmt;
use crate::tools::{ToolRegistry, ToolCall, UntrustedObservation};
use crate::memory::MemoryManager;
use crate::embedding::LocalEmbedder;
use crate::llm::{LlmProvider, ModelRegistry};
use crate::orchestration::{Orchestrator, OrchestrationStrategy, AgentRole};
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, Default)]
pub struct SessionStats {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_usd: f64,
    pub request_count: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    Idle,
    Planning,
    Thinking,
    CallingTool { tool_name: String, args: String },
    Observing,
    Reviewing,
    Responding,
    Error(String),
}

/// [M4 FIX] Budget configuration to prevent runaway costs.
#[derive(Debug, Clone)]
pub struct BudgetConfig {
    pub max_tokens: u64,
    pub budget_usd: f64,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            max_tokens: 500_000,     // 500K tokens per session
            budget_usd: 5.0,         // $5 USD per session
        }
    }
}

pub struct Agent {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub state: AgentState,
    pub tool_registry: ToolRegistry,
    pub memory: MemoryManager,
    pub embedder: Option<LocalEmbedder>,
    pub llm_registry: ModelRegistry,
    pub orchestrator: Orchestrator,
    pub default_model: String,
    pub stats: SessionStats,
    /// [M4 FIX] Budget cap — agent halts when exceeded.
    pub budget: BudgetConfig,
}

impl Agent {
    pub fn new(name: String, description: String, prompt: String) -> Self {
        Self {
            name,
            description,
            prompt,
            state: AgentState::Idle,
            tool_registry: ToolRegistry::new(),
            memory: MemoryManager::new(),
            embedder: None,
            llm_registry: ModelRegistry::new(),
            orchestrator: Orchestrator::new(OrchestrationStrategy::Router),
            default_model: "claude-3-5-sonnet".to_string(),
            stats: SessionStats::default(),
            budget: BudgetConfig::default(),
        }
    }

    pub fn get_stats_summary(&self) -> String {
        format!(
            "Session Summary: {} requests, Total Tokens: {} (In: {}, Out: {}), Est. Cost: ${:.4}",
            self.stats.request_count,
            self.stats.total_input_tokens + self.stats.total_output_tokens,
            self.stats.total_input_tokens,
            self.stats.total_output_tokens,
            self.stats.total_cost_usd
        )
    }

    pub fn set_model(&mut self, model_name: &str) {
        self.default_model = model_name.to_string();
    }

    pub fn set_orchestrator(&mut self, orchestrator: Orchestrator) {
        self.orchestrator = orchestrator;
    }

    pub fn set_embedder(&mut self, embedder: LocalEmbedder) {
        self.embedder = Some(embedder);
    }

    /// [M4 FIX] Set custom budget limits.
    pub fn set_budget(&mut self, max_tokens: u64, budget_usd: f64) {
        self.budget = BudgetConfig { max_tokens, budget_usd };
    }

    /// [M4 FIX] Check if budget has been exceeded.
    fn check_budget(&self) -> Result<()> {
        let total_tokens = self.stats.total_input_tokens + self.stats.total_output_tokens;
        if total_tokens >= self.budget.max_tokens {
            return Err(anyhow!(
                "Budget exceeded: {} tokens used (limit: {}). Halting to prevent cost overrun.",
                total_tokens, self.budget.max_tokens
            ));
        }
        if self.stats.total_cost_usd >= self.budget.budget_usd {
            return Err(anyhow!(
                "Budget exceeded: ${:.4} spent (limit: ${:.2}). Halting to prevent cost overrun.",
                self.stats.total_cost_usd, self.budget.budget_usd
            ));
        }
        Ok(())
    }

    pub async fn run(&mut self, input: &str) -> Result<String> {
        // 1. Process Input & Update Memory
        let mut input_embedding = None;
        if let Some(ref embedder) = self.embedder {
            match embedder.embed(input) {
                Ok(emb) => input_embedding = Some(emb),
                Err(e) => {
                    self.state = AgentState::Error(e.to_string());
                    return Err(e);
                }
            }
        }

        // Retrieve augmented context (History + Semantic Memories)
        let context = if let Some(ref emb) = input_embedding {
             self.memory.get_augmented_context(emb, 3)
        } else {
             self.memory.get_context()
        };

        self.memory.add_message("user", input, input_embedding);

        // 2. ReAct/Planning Loop
        let mut current_input = input.to_string();
        let mut iteration_count = 0;
        let max_iterations = 10;

        loop {
            if iteration_count >= max_iterations {
                self.state = AgentState::Error("Max iterations reached".to_string());
                return Err(anyhow!("Max iterations reached"));
            }

            // [M4 FIX] Check budget before each iteration
            if let Err(e) = self.check_budget() {
                self.state = AgentState::Error(e.to_string());
                return Err(e);
            }

            // --- PHASE 1: PLANNING (If not already planned) ---
            if iteration_count == 0 {
                self.state = AgentState::Planning;

                let planner = self.orchestrator.select_model(&self.llm_registry, AgentRole::Head, Some(&context))
                    .unwrap_or_else(|_| {
                        let model_name = self.default_model.clone();
                        self.llm_registry.get(&model_name)
                            .expect("Default model must exist in registry")
                    });

                let plan_prompt = format!(
                    "Create a step-by-step execution plan for the following task. \
                    Return ONLY a JSON list of strings representing the steps. \
                    Example: [\"step 1\", \"step 2\"] \n\nTask: {}",
                    current_input
                );

                let plan_res = planner.generate(&self.prompt, &plan_prompt, &context).await?;

                if let Some(start_idx) = plan_res.find('[') {
                    if let Some(end_idx) = plan_res.find(']') {
                        let json_str = &plan_res[start_idx..=end_idx];
                        let steps: Vec<String> = serde_json::from_str(json_str)
                            .map_err(|e| anyhow!("Failed to parse plan JSON: {}", e))?;

                        if !steps.is_empty() {
                            current_input = format!("Plan: {:?}", steps);
                            self.memory.add_message("system", &format!("Plan created: {:?}", steps), None);
                        }
                    }
                }
            }

            self.state = AgentState::Thinking;

            let provider = self.orchestrator.select_model(&self.llm_registry, AgentRole::Worker, Some(&context))
                .unwrap_or_else(|_| {
                    let model_name = self.default_model.clone();
                    self.llm_registry.get(&model_name)
                        .expect("Default model must exist in registry")
                });

            let start_time = std::time::Instant::now();
            let response = match provider.generate(&self.prompt, &current_input, &context).await {
                Ok(res) => {
                    let elapsed = start_time.elapsed().as_millis() as f32;
                    self.llm_registry.update_latency(provider.name(), elapsed);

                    self.stats.request_count += 1;
                    let input_tokens = current_input.len() as u64;
                    let output_tokens = res.len() as u64;
                    self.stats.total_input_tokens += input_tokens;
                    self.stats.total_output_tokens += output_tokens;
                    self.stats.total_cost_usd += (input_tokens as f64 * 0.000001) + (output_tokens as f64 * 0.000002);

                    res
                },
                Err(e) => {
                    self.state = AgentState::Error(e.to_string());
                    return Err(e);
                }
            };

            // [C1 FIX] Use typed ToolCall parser instead of raw string matching
            if let Some(tool_call) = ToolCall::parse_from_response(&response) {
                self.state = AgentState::CallingTool {
                    tool_name: tool_call.tool_name.clone(),
                    args: tool_call.args.clone(),
                };

                // Execute Tool — validator runs inside execute_tool (C1)
                let tool_result = match self.tool_registry.execute_tool(&tool_call.tool_name, &tool_call.args).await {
                    Ok(res) => res.content,
                    Err(e) => format!("Error executing tool '{}': {}", tool_call.tool_name, e),
                };

                // [M3 FIX] Sanitize tool output before feeding back to LLM
                let safe_observation = UntrustedObservation::sanitize(&tool_result);

                self.state = AgentState::Observing;
                self.memory.add_message("assistant", &response, None);
                self.memory.add_message("system", &safe_observation, None);

                current_input = safe_observation;
                iteration_count += 1;
                continue;
            } else {
                // Final Response
                self.state = AgentState::Responding;
                self.memory.add_message("assistant", &response, None);
                self.state = AgentState::Idle;
                return Ok(response);
            }
        }
    }
}

impl fmt::Display for AgentState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentState::Idle => write!(f, "Idle"),
            AgentState::Planning => write!(f, "Planning"),
            AgentState::Thinking => write!(f, "Thinking"),
            AgentState::CallingTool { tool_name, .. } => write!(f, "Calling Tool: {}", tool_name),
            AgentState::Observing => write!(f, "Observing"),
            AgentState::Reviewing => write!(f, "Reviewing"),
            AgentState::Responding => write!(f, "Responding"),
            AgentState::Error(err) => write!(f, "Error: {}", err),
        }
    }
}
