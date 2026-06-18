use crate::error::RouterResult;
use crate::types::{Latency, Price};
use async_trait::async_trait;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Unique identifier for the provider (e.g., "anthropic", "openai")
    fn name(&self) -> &str;

    /// Current price per 1M tokens
    fn current_price(&self) -> Price;

    /// Measured average latency in milliseconds
    fn current_latency(&self) -> Latency;

    /// Executes the request to the LLM
    async fn execute(&self, prompt: &str) -> RouterResult<String>;
}
