use std::fmt;
use crate::tools::ToolRegistry;
use crate::memory::MemoryManager;
use crate::embedding::LocalEmbedder;
use crate::llm::{LlmProvider, ModelRegistry};
use crate::orchestration::{Orchestrator, OrchestrationStrategy, AgentRole};
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    Idle,
    Thinking,
    CallingTool { tool_name: String, args: String },
    Observing,
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
        }
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

        // 2. ReAct Loop
        let mut current_input = input.to_string();
        let mut iteration_count = 0;
        let max_iterations = 5;

        loop {
            if iteration_count >= max_iterations {
                self.state = AgentState::Error("Max ReAct iterations reached".to_string());
                return Err(anyhow!("Max iterations reached"));
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

            let response = match provider.generate(&self.prompt, &current_input, &context).await {
                Ok(res) => res,
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
            AgentState::Thinking => write!(f, "Thinking"),
            AgentState::CallingTool { tool_name, .. } => write!(f, "Calling Tool: {}", tool_name),
            AgentState::Observing => write!(f, "Observing"),
            AgentState::Responding => write!(f, "Responding"),
            AgentState::Error(err) => write!(f, "Error: {}", err),
        }
    }
}
