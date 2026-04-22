use async_trait::async_trait;
use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::sync::Arc;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn generate(&self, system_prompt: &str, user_prompt: &str, context: &str) -> Result<String>;
    fn name(&self) -> &str;
}

pub struct ModelRegistry {
    providers: HashMap<String, Arc<dyn LlmProvider>>,
}

impl ModelRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    pub fn register(&mut self, provider: Arc<dyn LlmProvider>) {
        self.providers.insert(provider.name().to_string(), provider);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn LlmProvider>> {
        self.providers.get(name).cloned()
    }

    pub fn list(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChatMessage,
}

pub struct OpenRouterProvider {
    pub api_key: String,
    pub model_name: String,
    pub client: Client,
}

impl OpenRouterProvider {
    pub fn new(api_key: String, model_name: String) -> Self {
        Self {
            api_key,
            model_name,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for OpenRouterProvider {
    fn name(&self) -> &str {
        &self.model_name
    }

    async fn generate(&self, system_prompt: &str, user_prompt: &str, context: &str) -> Result<String> {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: format!("Context:\n{}\n\nUser: {}", context, user_prompt),
            },
        ];

        let request = ChatCompletionRequest {
            model: self.model_name.clone(),
            messages,
        };

        let response = self.client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_text = response.text().await?;
            return Err(anyhow!("OpenRouter error ({}): {}", response.status(), err_text));
        }

        let parsed: ChatCompletionResponse = response.json().await?;

        if let Some(choice) = parsed.choices.first() {
            Ok(choice.message.content.clone())
        } else {
            Err(anyhow!("No choices returned from OpenRouter"))
        }
    }
}
