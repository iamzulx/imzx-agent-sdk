use pyo3::prelude::*;
use once_cell::sync::Lazy;
use tokio::runtime::Runtime;
use std::sync::Arc;
use napi_derive::napi;

pub mod types;
pub mod error;
pub mod llm;
pub mod provider;
pub mod strategy;
pub mod agent;
pub mod tools;
pub mod memory;
pub mod embedding;
pub mod orchestration;

pub use types::*;
pub use error::*;
pub use provider::*;
pub use strategy::*;
pub use agent::Agent;
pub use tools::ToolRegistry;
pub use memory::MemoryManager;
pub use embedding::LocalEmbedder;

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
        let result = RUNTIME.block_on(async {
            self.inner.run(&input).await
        }).map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;

        Ok(result)
    }
}

// --- TypeScript Bindings (NAPI-RS) ---

#[napi]
pub struct TsAgent {
    pub inner: Arc<Agent>,
}

#[napi]
impl TsAgent {
    #[napi(constructor)]
    pub fn new(name: String, description: String, prompt: String) -> Self {
        TsAgent {
            inner: Arc::new(Agent::new(name, description, prompt)),
        }
    }

    #[napi]
    pub async fn run(&self, prompt: String) -> String {
        self.inner.run(&prompt).await
    }
}
