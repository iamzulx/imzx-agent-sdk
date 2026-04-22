use async_trait::async_trait;
use anyhow::Result;
use rig::providers::anthropic;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn generate(&self, system_prompt: &str, user_prompt: &str, context: &str) -> Result<String>;
}

pub struct AnthropicProvider {
    pub api_key: String,
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    async fn generate(&self, system_prompt: &str, user_prompt: &str, context: &str) -> Result<String> {
        // Integration with rig-core
        let client = anthropic::Client::new(&self.api_key);
        let agent = client.agent("claude-3-5-sonnet-20240620")
            .preamble(system_prompt)
            .build();

        let full_prompt = format!("Context:\n{}\n\nUser: {}", context, user_prompt);
        let response = agent.prompt(&full_prompt).await?;
        
        Ok(response)
    }
}
