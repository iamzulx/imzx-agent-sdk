use thiserror::Error;

/// Router-level errors for LLM provider orchestration.
/// Available for use by custom provider implementations and orchestration logic.
#[derive(Error, Debug)]
#[allow(dead_code)]
pub enum RouterError {
    #[error("Network error occurred: {0}")]
    Network(String),

    #[error("Request timed out after {0}ms")]
    Timeout(u64),

    #[error("Provider failure: {0}")]
    ProviderFailure(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

pub type RouterResult<T> = Result<T, RouterError>;
