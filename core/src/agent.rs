use std::fmt;
use crate::tools::ToolRegistry;
use crate::memory::MemoryManager;
use crate::embedding::LocalEmbedder;
use crate::llm::{LlmProvider, AnthropicProvider};
use anyhow::Result;

#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    Idle,
    Thinking,
    CallingTool { tool_name: String, args: String },
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
    pub llm: Box<dyn LlmProvider>,
}

impl Agent {
    pub fn new(name: String, description: String, prompt: String) -> Self {
        // Default to Anthropic provider
        let api_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_else(|_| "your_api_key".to_string());
        let llm = Box::new(AnthropicProvider { api_key });

        Self {
            name,
            description,
            prompt,
            state: AgentState::Idle,
            tool_registry: ToolRegistry::new(),
            memory: MemoryManager::new(),
            embedder: None,
            llm,
        }
    }

    pub fn set_llm(&mut self, provider: Box<dyn LlmProvider>) {
        self.llm = provider;
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

        self.state = AgentState::Thinking;

        // 2. Call real LLM with retrieved context
        let response = match self.llm.generate(&self.prompt, input, &context).await {
            Ok(res) => res,
            Err(e) => {
                self.state = AgentState::Error(e.to_string());
                return Err(e);
            }
        };

        self.state = AgentState::Responding;

        // 3. Update memory with agent's response
        let mut response_embedding = None;
        if let Some(ref embedder) = self.embedder {
            match embedder.embed(&response) {
                Ok(emb) => response_embedding = Some(emb),
                Err(e) => {
                    self.state = AgentState::Error(e.to_string());
                    return Err(e);
                }
            }
        }
        self.memory.add_message("assistant", &response, response_embedding);

        self.state = AgentState::Idle;
        Ok(response)
    }
}

impl fmt::Display for AgentState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentState::Idle => write!(f, "Idle"),
            AgentState::Thinking => write!(f, "Thinking"),
            AgentState::CallingTool { tool_name, .. } => write!(f, "Calling Tool: {}", tool_name),
            AgentState::Responding => write!(f, "Responding"),
            AgentState::Error(err) => write!(f, "Error: {}", err),
        }
    }
}
