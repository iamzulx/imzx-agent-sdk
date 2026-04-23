use std::collections::HashMap;
use std::sync::Arc;
use crate::llm::{LlmProvider, ModelRegistry};
use crate::strategy::WeightedScorer;
use crate::types::{Price, Latency};
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

    fn route_selection(&self, registry: &ModelRegistry, _role: AgentRole, _context: Option<&str>) -> Result<Arc<dyn LlmProvider>> {
        let providers: Vec<Arc<dyn LlmProvider>> = registry.list()
            .into_iter()
            .filter_map(|name| registry.get(&name))
            .collect();

        if providers.is_empty() {
            return Err(anyhow!("No models available in registry for routing"));
        }

        // Dynamic Routing using WeightedScorer
        // Note: In a real-world scenario, we would get the actual price/latency from providers.
        // For this implementation, we use the metrics stored in ModelRegistry.

        // We'll assume a default price of 1.0 (normalized) for all models since we don't have real price data yet.
        let best_price = Price(1.0);
        let best_latency = Latency(1000.0); // Assume 1s as baseline

        let scorer = WeightedScorer::new(0.5, 0.5); // Equal weight for demo

        let mut scored_providers: Vec<(Arc<dyn LlmProvider>, f32)> = providers.into_iter().map(|p| {
            let latency = registry.get_latency(p.name());
            let price = Price(1.0); // Placeholder
            let score = scorer.calculate_score(&*p, best_price, best_latency);
            (p, score.0)
        }).collect();

        // Sort by lowest score (best)
        scored_providers.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        Ok(scored_providers.first().unwrap().0.clone())
    }
}
