use std::fmt;
use crate::tools::ToolRegistry;
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
        let max_iterations = 10; // Increased for planning steps

        loop {
            if iteration_count >= max_iterations {
                self.state = AgentState::Error("Max iterations reached".to_string());
                return Err(anyhow!("Max iterations reached"));
            }

            // --- PHASE 1: PLANNING (If not already planned) ---
            if iteration_count == 0 {
                self.state = AgentState::Planning;

                // Use a high-intelligence model for planning
                let planner = self.orchestrator.select_model(&self.llm_registry, AgentRole::Head, Some(&context))
                    .unwrap_or_else(|_| {
                        // Fallback to the default model if orchestration fails or no role is assigned
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

                // Parse the plan (simple extraction)
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

            // Use orchestrator to select model for the current task (defaulting to Worker role for standard ReAct)
            let provider = self.orchestrator.select_model(&self.llm_registry, AgentRole::Worker, Some(&context))
                .unwrap_or_else(|_| {
                    // Fallback to the default model if orchestration fails or no role is assigned
                    let model_name = self.default_model.clone();
                    self.llm_registry.get(&model_name)
                        .expect("Default model must exist in registry")
                });

            // Measure actual latency
            let start_time = std::time::Instant::now();
            let response = match provider.generate(&self.prompt, &current_input, &context).await {
                Ok(res) => {
                    let elapsed = start_time.elapsed().as_millis() as f32;
                    self.llm_registry.update_latency(provider.name(), elapsed);

                    // TRACK TOKENS AND COST (Simulated for now)
                    self.stats.request_count += 1;
                    let input_tokens = current_input.len() as u64; // Placeholder
                    let output_tokens = res.len() as u64; // Placeholder
                    self.stats.total_input_tokens += input_tokens;
                    self.stats.total_output_tokens += output_tokens;
                    // Assume $0.001 per 1k tokens for demo
                    self.stats.total_cost_usd += (input_tokens as f64 * 0.000001) + (output_tokens as f64 * 0.000002);

                    res
                },
                Err(e) => {
                    self.state = AgentState::Error(e.to_string());
                    return Err(e);
                }
            };

            // Basic parser for ReAct (Thought/Action/Observation)
            if response.contains("Action:") && response.contains("Action Input:") {
                self.state = AgentState::CallingTool {
                    tool_name: "".to_string(),
                    args: "".to_string()
                };

                let lines: Vec<&str> = response.lines().collect();
                let mut tool_name = String::new();
                let mut tool_args = String::new();

                for line in lines {
                    if line.starts_with("Action:") {
                        tool_name = line.replace("Action:", "").trim().to_string();
                    } else if line.starts_with("Action Input:") {
                        tool_args = line.replace("Action Input:", "").trim().to_string();
                    }
                }

                self.state = AgentState::CallingTool { tool_name: tool_name.clone(), args: tool_args.clone() };

                // Execute Tool
                let tool_result = match self.tool_registry.execute_tool(&tool_name, &tool_args).await {
                    Ok(res) => res.content,
                    Err(e) => format!("Error executing tool '{}': {}", tool_name, e),
                };

                // Observe Result
                self.state = AgentState::Observing;
                self.memory.add_message("assistant", &response, None);
                self.memory.add_message("system", &format!("Observation: {}", tool_result), None);

                // Prepare for next iteration
                current_input = format!("Observation: {}", tool_result);
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
