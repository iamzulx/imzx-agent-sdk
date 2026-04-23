use std::collections::HashMap;
use std::sync::Arc;
use crate::llm::{LlmProvider, ModelRegistry};
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, PartialEq)]
pub enum OrchestrationStrategy {
    Router,       // Heuristic-based model selection
    Hierarchical, // Manager-Worker pattern
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

pub enum ExecutionPlan {
    Single(Arc<dyn LlmProvider>),
    Sequence(Vec<Arc<dyn LlmProvider>>), // For Hierarchical (Head -> Workers)
    Consensus {
        workers: Vec<Arc<dyn LlmProvider>>,
        judge: Arc<dyn LlmProvider>,
    },
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

    pub fn get_execution_plan(&self, registry: &ModelRegistry, role: AgentRole, context: Option<&str>) -> Result<ExecutionPlan> {
        match self.strategy {
            OrchestrationStrategy::Router => {
                let provider = self.route_selection(registry, role, context)?;
                Ok(ExecutionPlan::Single(provider))
            }
            OrchestrationStrategy::Hierarchical => {
                let head = self.role_based_selection(registry, AgentRole::Head)
                    .ok_or_else(|| anyhow!("Hierarchical strategy requires a Head model"))?;

                let workers = vec![self.role_based_selection(registry, AgentRole::Worker)
                    .ok_or_else(|| anyhow!("Hierarchical strategy requires a Worker model"))?];

                Ok(ExecutionPlan::Sequence(vec![head, workers[0].clone()]))
            }
            OrchestrationStrategy::Consensus => {
                let judge = self.role_based_selection(registry, AgentRole::Judge)
                    .ok_or_else(|| anyhow!("Consensus strategy requires a Judge model"))?;

                let mut workers = Vec::new();
                for role in [AgentRole::Worker] {
                    if let Some(model_name) = self.role_map.get_model(role) {
                        if let Some(provider) = registry.get(model_name) {
                            workers.push(provider);
                        }
                    }
                }

                if workers.is_empty() {
                    return Err(anyhow!("Consensus strategy requires at least one Worker model"));
                }

                Ok(ExecutionPlan::Consensus { workers, judge })
            }
        }
    }

    fn role_based_selection(&self, registry: &ModelRegistry, role: AgentRole) -> Result<Arc<dyn LlmProvider>> {
        let model_name = self.role_map.get_model(role)
            .ok_or_else(|| anyhow!("No model assigned to role {:?}", role))?;

        registry.get(model_name)
            .ok_or_else(|| anyhow!("Model '{}' not found in registry", model_name))
    }

    fn route_selection(&self, registry: &ModelRegistry, role: AgentRole, context: Option<&str>) -> Result<Arc<dyn LlmProvider>> {
        if let Some(model_name) = self.role_map.get_model(role) {
             if let Some(provider) = registry.get(model_name) {
                 return Ok(provider);
             }
        }

        let is_complex = context.map_or(false, |c| c.len() > 500);

        if is_complex {
            let strong_models = ["claude-3-5-sonnet", "gpt-4", "gpt-4o"];
            for &m in &strong_models {
                if let Some(p) = registry.get(m) {
                    return Ok(p);
                }
            }
        }

        registry.list().first()
            .and_then(|name| registry.get(name))
            .ok_or_else(|| anyhow!("No models available in registry for routing"))
    }
}
