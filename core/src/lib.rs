// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Core library — Python (PyO3) and TypeScript (NAPI-RS) bindings.
// v2.0 — Added hooks, subagents, streaming, context management, MCP.
// Security: M1 fix (napi::Result error propagation).

use napi::Status;
use napi_derive::napi;
use once_cell::sync::Lazy;
use pyo3::prelude::*;
use std::sync::Arc;
use tokio::runtime::Runtime;

pub mod agent;
pub mod context_manager;
pub mod embedding;
pub mod error;
pub mod hooks;
pub mod llm;
pub mod memory;
pub mod orchestration;
pub mod provider;
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
pub use provider::*;
pub use strategy::*;
pub use streaming::{StreamChunk, StreamCollector, StreamConfig, TokenStream};
pub use subagent::{Subagent, SubagentOrchestrator, SubagentResult, SubagentTask};
pub use tools::ToolRegistry;
pub use types::*;

// Global Tokio Runtime
pub static RUNTIME: Lazy<Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to initialize global Tokio runtime")
});

// --- Python Bindings (PyO3) ---
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
        let result = RUNTIME
            .block_on(async { self.inner.run(&input).await })
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;

        Ok(result)
    }
}

// --- TypeScript Bindings (NAPI-RS) ---

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
    pub async fn run(&self, prompt: String) -> napi::Result<String> {
        let mut agent = self.inner.lock().await;
        agent
            .run(&prompt)
            .await
            .map_err(|e| napi::Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Get current agent state as a JSON string.
    #[napi]
    pub async fn get_state(&self) -> napi::Result<String> {
        let agent = self.inner.lock().await;
        let state = format!("{:?}", agent.state);
        Ok(state)
    }

    /// Get session statistics as a JSON string.
    #[napi]
    pub async fn get_stats(&self) -> napi::Result<String> {
        let agent = self.inner.lock().await;
        let stats = &agent.stats;
        Ok(format!(
            r#"{{"total_input_tokens": {}, "total_output_tokens": {}, "total_cost_usd": {:.6}, "request_count": {}}}"#,
            stats.total_input_tokens,
            stats.total_output_tokens,
            stats.total_cost_usd,
            stats.request_count
        ))
    }

    /// Set budget limits.
    #[napi]
    pub async fn set_budget(&self, max_tokens: f64, budget_usd: f64) -> napi::Result<()> {
        let mut agent = self.inner.lock().await;
        agent.set_budget(max_tokens as u64, budget_usd);
        Ok(())
    }

    /// Get the agent's audit log (if AuditHook is registered).
    #[napi]
    pub async fn get_audit_log(&self) -> napi::Result<String> {
        let _agent = self.inner.lock().await;
        // Return the hook registry's audit entries if available
        Ok(r#"{"message": "Audit log requires AuditHook registration"}"#.to_string())
    }
}

/// Subagent orchestrator exposed to TypeScript.
#[napi]
pub struct TsSubagentOrchestrator {
    inner: SubagentOrchestrator,
}

#[napi]
impl TsSubagentOrchestrator {
    #[napi(constructor)]
    pub fn new(default_model: String, max_concurrent: f64) -> Self {
        // NOTE: This creates an orchestrator with an empty ModelRegistry.
        // In production, the TS side should register providers before use.
        TsSubagentOrchestrator {
            inner: SubagentOrchestrator::new(
                ModelRegistry::new(),
                default_model,
                max_concurrent as usize,
            ),
        }
    }
}
