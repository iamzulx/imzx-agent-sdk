use thiserror::Error;

#[derive(Error, Debug)]
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
