// imzx-core: Main entry point for FFI (Foreign Function Interface)
use pyo3::prelude::*;

pub mod agent;
pub mod tools;
pub mod memory;
pub mod embedding;

pub use agent::Agent;
pub use tools::ToolRegistry;
pub use memory::MemoryManager;
pub use embedding::LocalEmbedder;

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
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(async {
            self.inner.run(&input).await
        }).map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;

        Ok(result)
    }
}
