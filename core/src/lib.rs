use pyo3::prelude::*;
use once_cell::sync::Lazy;
use tokio::runtime::Runtime;
use std::collections::HashMap;
use std::sync::Arc;

pub mod agent;
pub mod tools;
pub mod memory;
pub mod embedding;
pub mod llm;
pub mod orchestration;

pub use agent::Agent;
pub use tools::ToolRegistry;
pub use memory::MemoryManager;
pub use embedding::LocalEmbedder;
pub use llm::{LlmProvider, AnthropicProvider, ModelRegistry};

// Global Tokio Runtime for all FFI calls
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

    fn register_model(&mut self, model_name: String, api_key: String) -> PyResult<()> {
        let provider = Arc::new(AnthropicProvider {
            api_key,
            model_name: model_name.clone(),
        });
        self.inner.llm_registry.register(provider);
        Ok(())
    }

    fn set_model(&mut self, model_name: String) -> PyResult<()> {
        self.inner.set_model(&model_name);
        Ok(())
    }

    fn run(&mut self, input: String) -> PyResult<String> {
        let result = RUNTIME.block_on(async {
            self.inner.run(&input).await
        }).map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;

        Ok(result)
    }
}
