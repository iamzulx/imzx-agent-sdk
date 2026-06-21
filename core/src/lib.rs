// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Core library — TypeScript (NAPI-RS) and Python (PyO3) bindings.
// v0.6.0 — Feature-gated bindings, removed unused deps, added tests.
// Security: M1 fix (napi::Result error propagation).

#![deny(unsafe_code)]

pub mod agent;
pub mod context_manager;
pub mod embedding;
pub mod error;
pub mod hooks;
pub mod llm;
pub mod memory;
pub mod orchestration;
pub mod strategy;
pub mod streaming;
pub mod subagent;
pub mod tools;
pub mod types;

pub use agent::Agent;
pub use context_manager::{
    CompactionStrategy, ContextConfig, ContextEntry, ContextManager, ContextRole, Priority,
};
pub use embedding::LocalEmbedder;
pub use error::*;
pub use hooks::{
    AuditHook, CostGuardHook, Hook, HookEvent, HookRegistry, HookResult, RateLimiterHook,
};
pub use llm::ModelRegistry;
pub use memory::MemoryManager;
pub use strategy::*;
pub use streaming::{StreamChunk, StreamCollector, StreamConfig, TokenStream};
pub use subagent::{Subagent, SubagentOrchestrator, SubagentResult, SubagentTask};
pub use tools::ToolRegistry;
pub use types::*;

// --- Global Tokio Runtime (lazy, cleaned up on drop) ---
use std::sync::OnceLock;

pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to initialize global Tokio runtime")
    })
}

// --- Python Bindings (PyO3) — feature-gated ---
#[cfg(feature = "python-binding")]
mod python_bindings {
    use super::*;
    use pyo3::prelude::*;

    #[pymodule]
    fn imzx_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
        m.add_class::<PyAgent>()?;
        Ok(())
    }

    #[pyclass]
    pub struct PyAgent {
        pub inner: Agent,
    }

    #[pymethods]
    impl PyAgent {
        #[new]
        fn new(name: String, description: String, prompt: String) -> Self {
            PyAgent {
                inner: Agent::new(name, description, prompt),
            }
        }

        fn run(&mut self, input: String) -> PyResult<String> {
            let result = runtime()
                .block_on(async { self.inner.run(&input).await })
                .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;
            Ok(result)
        }
    }
}

// --- TypeScript Bindings (NAPI-RS) — feature-gated ---
#[cfg(feature = "napi-binding")]
mod napi_bindings {
    use super::*;
    use napi::Status;
    use napi_derive::napi;
    use std::sync::Arc;

    /// NAPI-exposed agent for TypeScript.
    #[napi]
    pub struct TsAgent {
        inner: Arc<tokio::sync::Mutex<Agent>>,
    }

    #[napi]
    impl TsAgent {
        #[napi(constructor)]
        pub fn new(name: String, description: String, prompt: String) -> Self {
            TsAgent {
                inner: Arc::new(tokio::sync::Mutex::new(Agent::new(
                    name,
                    description,
                    prompt,
                ))),
            }
        }

        /// Run the agent with a user prompt. Returns the final response.
        #[napi]
        pub async fn run(&self, input: String) -> napi::Result<String> {
            let mut agent = self
                .inner
                .lock()
                .await;
            agent
                .run(&input)
                .await
                .map_err(|e| napi::Error::new(Status::GenericFailure, e.to_string()))
        }

        /// Get current agent state as a string.
        #[napi]
        pub async fn state(&self) -> String {
            let agent = self.inner.lock().await;
            agent.state().to_string()
        }

        /// Get session statistics as JSON.
        #[napi]
        pub async fn stats_json(&self) -> String {
            let agent = self.inner.lock().await;
            serde_json::to_string(agent.stats()).unwrap_or_else(|_| "{}".to_string())
        }
    }
}
