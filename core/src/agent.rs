// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Agent module — ReAct loop with security hardening + context engineering.
// Security fixes: C1 (typed ToolCall), M3 (UntrustedObservation), M4 (budget cap)
// v2.0 additions: hooks integration, context management, streaming support.

use crate::context_manager::{
    estimate_tokens, ContextConfig, ContextEntry, ContextManager, ContextRole, Priority,
};
use crate::embedding::LocalEmbedder;
use crate::hooks::{HookEvent, HookRegistry, HookResult};
use crate::llm::ModelRegistry;
use crate::memory::MemoryManager;
use crate::orchestration::{OrchestrationStrategy, Orchestrator};
use crate::tools::{ToolCall, ToolRegistry, UntrustedObservation};
use anyhow::{anyhow, Result};
use std::fmt;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
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

impl fmt::Display for AgentState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentState::Idle => write!(f, "idle"),
            AgentState::Planning => write!(f, "planning"),
            AgentState::Thinking => write!(f, "thinking"),
            AgentState::CallingTool { tool_name, .. } => write!(f, "calling_tool:{}", tool_name),
            AgentState::Observing => write!(f, "observing"),
            AgentState::Reviewing => write!(f, "reviewing"),
            AgentState::Responding => write!(f, "responding"),
            AgentState::Error(e) => write!(f, "error:{}", e),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BudgetConfig {
    pub max_tokens: u64,
    pub budget_usd: f64,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            max_tokens: 500_000,
            budget_usd: 5.0,
        }
    }
}

/// Main agent struct — ReAct loop with hooks, context management, and streaming.
/// [A1 FIX] Fields are pub(crate) to limit external access; use accessor methods.
pub struct Agent {
    pub(crate) name: String,
    #[allow(dead_code)]
    pub(crate) description: String,
    pub(crate) prompt: String,
    pub(crate) state: AgentState,
    pub(crate) tool_registry: ToolRegistry,
    pub(crate) memory: MemoryManager,
    pub(crate) embedder: Option<LocalEmbedder>,
    pub(crate) llm_registry: ModelRegistry,
    pub(crate) orchestrator: Orchestrator,
    pub(crate) default_model: String,
    pub(crate) stats: SessionStats,
    pub(crate) budget: BudgetConfig,
    /// Hook registry for middleware lifecycle events.
    pub(crate) hooks: HookRegistry,
    /// Context manager for token budgeting and compaction.
    pub(crate) context: ContextManager,
    /// Maximum iterations before forced stop.
    pub(crate) max_iterations: u32,
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
            hooks: HookRegistry::new(),
            context: ContextManager::new(ContextConfig::default()),
            max_iterations: 10,
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

    // [A1 FIX] Accessor methods for external access
    /// Get the current agent state.
    pub fn state(&self) -> &AgentState {
        &self.state
    }

    /// Get session statistics.
    pub fn stats(&self) -> &SessionStats {
        &self.stats
    }

    /// Get the agent name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Get the system prompt.
    pub fn prompt(&self) -> &str {
        &self.prompt
    }

    /// Get the default model name.
    pub fn default_model(&self) -> &str {
        &self.default_model
    }

    /// Get mutable reference to the LLM registry (for registering providers).
    pub fn llm_registry_mut(&mut self) -> &mut ModelRegistry {
        &mut self.llm_registry
    }

    /// Get the budget configuration.
    pub fn budget(&self) -> &BudgetConfig {
        &self.budget
    }

    pub fn set_budget(&mut self, max_tokens: u64, budget_usd: f64) {
        self.budget = BudgetConfig {
            max_tokens,
            budget_usd,
        };
    }

    fn check_budget(&self) -> Result<()> {
        let total_tokens = self.stats.total_input_tokens + self.stats.total_output_tokens;
        if total_tokens >= self.budget.max_tokens {
            return Err(anyhow!(
                "Budget exceeded: {} tokens used (limit: {}). Halting to prevent cost overrun.",
                total_tokens,
                self.budget.max_tokens
            ));
        }
        if self.stats.total_cost_usd >= self.budget.budget_usd {
            return Err(anyhow!(
                "Budget exceeded: ${:.4} spent (limit: ${:.2}). Halting to prevent cost overrun.",
                self.stats.total_cost_usd,
                self.budget.budget_usd
            ));
        }
        Ok(())
    }

    /// Register a hook for lifecycle events.
    pub fn add_hook(&mut self, hook: std::sync::Arc<dyn crate::hooks::Hook>) {
        self.hooks.register(hook);
    }

    /// Get context window disclosure summary.
    pub fn context_summary(&self) -> crate::context_manager::ContextDisclosure {
        self.context.disclosure_summary()
    }

    /// Main execution loop — ReAct pattern with hooks and context engineering.
    pub async fn run(&mut self, input: &str) -> Result<String> {
        // Fire AgentStart hook
        self.state = AgentState::Planning;
        let start_event = HookEvent::AgentStart {
            input: input.to_string(),
        };
        if let HookResult::Block(reason) = self.hooks.execute(&start_event).await? {
            return Err(anyhow!("Agent blocked by hook: {}", reason));
        }

        // [C1/S8 FIX] Only add system prompt if not already present in context
        // (prevents duplication across multiple run() calls)
        let has_system = self.context.has_entry_with_source("system");
        if !has_system {
            self.context.push(ContextEntry {
                content: self.prompt.clone(),
                role: ContextRole::System,
                token_estimate: estimate_tokens(&self.prompt),
                priority: Priority::Critical,
                source: "system".to_string(),
                timestamp: 0,
            });
        }

        // Add user input to context
        self.context.push(ContextEntry {
            content: input.to_string(),
            role: ContextRole::UserMessage,
            token_estimate: estimate_tokens(input),
            priority: Priority::Critical,
            source: "user".to_string(),
            timestamp: self.stats.request_count,
        });

        // Get augmented context from memory (embeddings if available)
        let augmented_context = if let Some(embedder) = &self.embedder {
            let embedding = embedder.embed(input)?;
            self.memory
                .add_message("user", input, Some(embedding.clone()));
            let results = self.memory.semantic_search(&embedding, 3);
            results
                .iter()
                .map(|e| format!("{}: {}", e.role, e.content))
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            self.memory.add_message("user", input, None);
            self.memory.get_context()
        };

        let mut final_response = String::new();

        for iteration in 0..self.max_iterations {
            // Budget check before each iteration
            if let Err(e) = self.check_budget() {
                let _ = self
                    .hooks
                    .execute(&HookEvent::OnError {
                        error: e.to_string(),
                        context: "budget_check".to_string(),
                    })
                    .await;
                return Err(e);
            }

            // Build the full context for this iteration
            // [C7 FIX] Exclude System role entries from context render — they are already
            // passed as the system_prompt parameter to generate(), so including them
            // in context would duplicate the system prompt in the LLM call.
            let context_str = self.context.render_excluding_role(&ContextRole::System);
            let full_context = if augmented_context.is_empty() {
                context_str
            } else {
                format!(
                    "{}\n\n## Augmented Memory:\n{}",
                    context_str, augmented_context
                )
            };

            // Select model via orchestrator
            let model_name = match self.orchestrator.get_execution_plan() {
                crate::orchestration::ExecutionPlan::Single => self
                    .orchestrator
                    .route_selection(&self.llm_registry)
                    .unwrap_or_else(|| self.default_model.clone()),
                _ => self.default_model.clone(),
            };

            // Get LLM provider
            let provider = self
                .llm_registry
                .get(&model_name)
                .or_else(|| self.llm_registry.get(&self.default_model))
                .ok_or_else(|| {
                    anyhow!(
                        "No LLM provider available. Registered: {:?}",
                        self.llm_registry.list()
                    )
                })?;

            // Generate response
            self.state = AgentState::Thinking;
            let response = provider
                .generate(&self.prompt, input, &full_context)
                .await?;

            // [C2 FIX] Use estimate_tokens() consistently (not raw len/4 heuristic)
            let input_tokens = estimate_tokens(&full_context) as u64;
            let output_tokens = estimate_tokens(&response) as u64;
            self.stats.total_input_tokens += input_tokens;
            self.stats.total_output_tokens += output_tokens;
            self.stats.request_count += 1;
            let price = provider.current_price().0 as f64;
            self.stats.total_cost_usd += (input_tokens as f64 * price / 1_000_000.0)
                + (output_tokens as f64 * price * 2.0 / 1_000_000.0);

            // Fire OnIteration hook
            if let HookResult::Block(reason) = self
                .hooks
                .execute(&HookEvent::OnIteration {
                    iteration,
                    thinking: response.to_string(),
                })
                .await?
            {
                return Err(anyhow!("Iteration blocked by hook: {}", reason));
            }

            // Add assistant response to context
            self.context.push(ContextEntry {
                content: response.to_string(),
                role: ContextRole::AssistantResponse,
                token_estimate: estimate_tokens(&response),
                priority: Priority::Normal,
                source: format!("model:{}", model_name),
                timestamp: self.stats.request_count,
            });

            // Try to parse a tool call from the response
            if let Some(tool_call) = ToolCall::parse_from_response(&response) {
                self.state = AgentState::CallingTool {
                    tool_name: tool_call.tool_name.clone(),
                    args: tool_call.args.clone(),
                };

                // Fire PreToolUse hook
                let pre_event = HookEvent::PreToolUse {
                    tool_name: tool_call.tool_name.clone(),
                    args: tool_call.args.clone(),
                };
                match self.hooks.execute(&pre_event).await? {
                    HookResult::Block(reason) => {
                        self.context.push(ContextEntry {
                            content: format!("[Tool call blocked: {}]", reason),
                            role: ContextRole::Observation,
                            token_estimate: estimate_tokens(&reason),
                            priority: Priority::Normal,
                            source: "hook".to_string(),
                            timestamp: self.stats.request_count,
                        });
                        continue;
                    }
                    HookResult::Transform(new_args) => {
                        // Hook transformed the args — use the new version
                        let transformed_call = ToolCall {
                            tool_name: tool_call.tool_name.clone(),
                            args: new_args,
                        };
                        let tool_start = std::time::Instant::now();
                        let result = self
                            .tool_registry
                            .execute_tool(&transformed_call.tool_name, &transformed_call.args)
                            .await;
                        let duration_ms = tool_start.elapsed().as_millis() as u64;

                        self.process_tool_result(&transformed_call.tool_name, result, duration_ms)
                            .await?;
                    }
                    HookResult::Continue => {
                        // Normal execution
                        let tool_start = std::time::Instant::now();
                        let result = self
                            .tool_registry
                            .execute_tool(&tool_call.tool_name, &tool_call.args)
                            .await;
                        let duration_ms = tool_start.elapsed().as_millis() as u64;

                        self.process_tool_result(&tool_call.tool_name, result, duration_ms)
                            .await?;
                    }
                }

                self.state = AgentState::Observing;
            } else {
                // No tool call — this is the final response
                final_response = response.to_string();
                self.state = AgentState::Responding;

                // Add to memory
                if let Some(embedder) = &self.embedder {
                    let embedding = embedder.embed(&response)?;
                    self.memory
                        .add_message("assistant", &response, Some(embedding));
                } else {
                    self.memory.add_message("assistant", &response, None);
                }

                break;
            }
        }

        // [C3 FIX] Return error if max_iterations exhausted without a final response
        if final_response.is_empty() {
            return Err(anyhow!(
                "Agent reached maximum iterations ({}) without producing a final response. \
                 The task may be too complex or the model may be stuck in a tool-calling loop.",
                self.max_iterations
            ));
        }

        // Fire AgentEnd hook
        let _ = self
            .hooks
            .execute(&HookEvent::AgentEnd {
                response: final_response.clone(),
                total_iterations: self.stats.request_count as u32,
            })
            .await;

        self.state = AgentState::Idle;
        Ok(final_response)
    }

    /// Process a tool result — sanitize, add to context, fire PostToolUse hook.
    async fn process_tool_result(
        &mut self,
        tool_name: &str,
        result: Result<crate::tools::ToolResult>,
        duration_ms: u64,
    ) -> Result<()> {
        let sanitized = match result {
            Ok(tr) => UntrustedObservation::sanitize(&tr.content),
            Err(e) => format!("[Tool error: {}]", e),
        };

        // Fire PostToolUse hook
        let post_event = HookEvent::PostToolUse {
            tool_name: tool_name.to_string(),
            result: sanitized.clone(),
            duration_ms,
        };
        let _ = self.hooks.execute(&post_event).await?;

        // Add tool result to context
        self.context.push(ContextEntry {
            content: sanitized.clone(),
            role: ContextRole::ToolResult,
            token_estimate: estimate_tokens(&sanitized),
            priority: Priority::High,
            source: format!("tool:{}", tool_name),
            timestamp: self.stats.request_count,
        });

        // Add to memory
        if let Some(embedder) = &self.embedder {
            let embedding = embedder.embed(&sanitized)?;
            self.memory
                .add_message("tool_result", &sanitized, Some(embedding));
        } else {
            self.memory.add_message("tool_result", &sanitized, None);
        }

        Ok(())
    }
}
