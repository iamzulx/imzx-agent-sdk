use std::collections::HashMap;
use std::sync::Arc;
use crate::llm::{LlmProvider, ModelRegistry};
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, PartialEq)]
pub enum OrchestrationStrategy {
    Router,       // Heuristic-based model selection
    Hierarchical, // Manager -> Workers pattern
    Consensus,    // Parallel execution -> Judge synthesis
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentRole {
    Head,
    Worker,
    Judge,
}

pub struct RoleMap {
    pub assignments: HashMap<AgentRole, String>, // Role -> ModelName
}

impl RoleMap {
    pub fn new() -> Self {
        Self {
            assignments: HashMap::new(),
        }
    }

    pub fn assign(&mut self, role: AgentRole, model_name: String) {
        self.assignments.insert(role, model_name);
    }

    pub fn get_model(&self, role: AgentRole) -> Option<&String> {
        self.assignments.get(&role)
    }
}

pub struct FallbackConfig {
    pub priority_list: Vec<String>, // Ordered list of models to try
}

pub struct Orchestrator {
    pub strategy: OrchestrationStrategy,
    pub role_map: RoleMap,
    pub fallback: Option<FallbackConfig>,
}

impl Orchestrator {
    pub fn new(strategy: OrchestrationStrategy) -> Self {
        Self {
            strategy,
            role_map: RoleMap::new(),
            fallback: None,
        }
    }

    /// Selects the appropriate model based on the current strategy and role
    pub fn select_model(&self, registry: &ModelRegistry, role: AgentRole, context: Option<&str>) -> Result<Arc<dyn LlmProvider>> {
        match self.strategy {
            OrchestrationStrategy::Router => self.route_selection(registry, role, context),
            _ => self.role_based_selection(registry, role),
        }
    }

    fn role_based_selection(&self, registry: &ModelRegistry, role: AgentRole) -> Result<Arc<dyn LlmProvider>> {
        let model_name = self.role_map.get_model(role)
            .ok_or_else(|| anyhow!("No model assigned to role {:?}", role))?;

        registry.get(model_name)
            .ok_or_else(|| anyhow!("Model '{}' not found in registry", model_name))
    }

    fn route_selection(&self, registry: &ModelRegistry, role: AgentRole, context: Option<&str>) -> Result<Arc<dyn LlmProvider>> {
        // If a specific role is assigned, prioritize it
        if let Some(model_name) = self.role_map.get_model(role) {
             if let Some(provider) = registry.get(model_name) {
                 return Ok(provider);
             }
        }

        // Otherwise, use a simple heuristic for "Router" mode
        // If context is present and long, assume high complexity -> use a "strong" model
        let is_complex = context.map_or(false, |c| c.len() > 500);

        if is_complex {
            let strong_models = ["claude-3-5-sonnet", "gpt-4", "gpt-4o"];
            for &m in &strong_models {
                if let Some(p) = registry.get(m) {
                    return Ok(p);
                }
            }
        }

        // Fallback to any available model if router fails
        registry.list().first()
            .and_then(|name| registry.get(name))
            .ok_or_else(|| anyhow!("No models available in registry for routing"))
    }

    /// Handles model selection with fallback logic if a primary model fails (e.g., rate limit)
    pub async fn execute_with_fallback<F, Fut, T>(
        &self,
        registry: &ModelRegistry,
        role: AgentRole,
        context: Option<&str>,
        action: F
    ) -> Result<T>
    where
        F: Fn(Arc<dyn LlmProvider>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let primary = self.select_model(registry, role, context)?;

        match action(primary).await {
            Ok(res) => Ok(res),
            Err(e) if self.fallback.is_some() => {
                if let Some(ref config) = self.fallback {
                    for model_name in &config.priority_list {
                        if let Some(provider) = registry.get(model_name) {
                            match action(provider).await {
                                Ok(res) => return Ok(res),
                                Err(_) => continue,
                            }
                        }
                    }
                }
                Err(e)
            }
            Err(e) => Err(e),
        }
    }
}
