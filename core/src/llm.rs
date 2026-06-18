// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// LLM provider module — unified trait + OpenRouter implementation.
// Security fixes applied:
//   [H5]  API key stored in SecretBox (zeroized on drop), error bodies redacted
//   [L4]  Consolidated LlmProvider trait (merged provider/mod.rs duplicate)

use crate::types::{Latency, Price};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::Client;
use secrecy::{ExposeSecret, SecretBox};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// [L4 FIX] Unified LLM provider trait — merges llm.rs and provider/mod.rs.
/// All LLM providers implement this single trait.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Unique identifier for the provider (e.g., "claude-3-5-sonnet")
    fn name(&self) -> &str;

    /// Executes a generation request.
    async fn generate(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        context: &str,
    ) -> Result<String>;

    /// Current price per 1M tokens (default: normalized 1.0).
    fn current_price(&self) -> Price {
        Price(1.0)
    }

    /// Measured average latency in milliseconds (default: 2000ms).
    fn current_latency(&self) -> Latency {
        Latency(2000.0)
    }
}

#[derive(Default)]
pub struct ModelRegistry {
    providers: HashMap<String, Arc<dyn LlmProvider>>,
    pub metrics: Arc<RwLock<HashMap<String, f32>>>,
}

impl ModelRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
            metrics: Arc::new(RwLock::new(HashMap::new())),
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

    pub fn update_latency(&self, name: &str, latency_ms: f32) {
        if let Ok(mut metrics) = self.metrics.write() {
            let entry = metrics.entry(name.to_string()).or_insert(latency_ms);
            *entry = (*entry * 0.9) + (latency_ms * 0.1);
        }
    }

    pub fn get_latency(&self, name: &str) -> f32 {
        self.metrics
            .read()
            .ok()
            .and_then(|m| m.get(name).cloned())
            .unwrap_or(2000.0)
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

/// [H5 FIX] API key is wrapped in SecretBox — zeroized on drop.
/// The key is never exposed as plaintext String in the struct field.
pub struct OpenRouterProvider {
    pub api_key: SecretBox<String>,
    pub model_name: String,
    pub client: Client,
}

impl OpenRouterProvider {
    pub fn new(api_key: String, model_name: String) -> Self {
        Self {
            api_key: SecretBox::new(Box::new(api_key)),
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

    async fn generate(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        context: &str,
    ) -> Result<String> {
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

        // [H5 FIX] Access key via ExposeSecret — never stored as plain String
        let response = self
            .client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .bearer_auth(self.api_key.expose_secret())
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            // [H5 FIX] Redact error body — only return status code, not response text
            // (response text could contain echoed API key or sensitive headers)
            let status = response.status();
            return Err(anyhow!("OpenRouter API error: HTTP {}", status));
        }

        let parsed: ChatCompletionResponse = response.json().await?;

        if let Some(choice) = parsed.choices.first() {
            Ok(choice.message.content.clone())
        } else {
            Err(anyhow!("No choices returned from OpenRouter"))
        }
    }
}
