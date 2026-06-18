// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Orchestration module — agent coordination patterns.
// v2.0 — Added routing, parallelization, evaluator-optimizer, prompt chaining.
// Based on Anthropic's "Building Effective Agents" patterns.

use crate::llm::{LlmProvider, ModelRegistry};
use crate::strategy::WeightedScorer;
use crate::types::{Latency, Price};
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub enum OrchestrationStrategy {
    /// Heuristic-based model selection (default).
    Router,
    /// Manager-Worker pattern: Head plans, Workers execute.
    Hierarchical,
    /// Parallel execution → Judge synthesis.
    Consensus,
    /// Prompt chaining: sequential steps with gates between them.
    Chaining,
    /// Evaluator-optimizer: generate → evaluate → refine loop.
    EvaluatorOptimizer,
    /// Parallelization: multiple models work simultaneously, results aggregated.
    Parallelization,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentRole {
    Head,
    Worker,
    Judge,
    Evaluator,
    Optimizer,
}

#[derive(Default)]
pub struct RoleMap {
    pub assignments: HashMap<AgentRole, String>,
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
    pub priority_list: Vec<String>,
}

pub enum ExecutionPlan {
    Single,
    Sequence(Vec<String>),
    Consensus {
        workers: Vec<String>,
        judge: String,
    },
    Chaining {
        steps: Vec<ChainStep>,
    },
    EvaluatorOptimizer {
        generator: String,
        evaluator: String,
        max_rounds: u32,
    },
    Parallelization {
        models: Vec<String>,
        aggregator: String,
    },
}

/// A step in a prompt chain.
#[derive(Debug, Clone)]
pub struct ChainStep {
    pub name: String,
    pub model: String,
    pub prompt_template: String,
    pub gate: Option<String>, // Validation criteria
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

    /// Get execution plan — simplified API (uses default model for single execution).
    pub fn get_execution_plan(&self) -> ExecutionPlan {
        match self.strategy {
            OrchestrationStrategy::Router => ExecutionPlan::Single,
            OrchestrationStrategy::Hierarchical => {
                let head = self
                    .role_map
                    .get_model(AgentRole::Head)
                    .unwrap_or(&"default".to_string())
                    .clone();
                let worker = self
                    .role_map
                    .get_model(AgentRole::Worker)
                    .unwrap_or(&"default".to_string())
                    .clone();
                ExecutionPlan::Sequence(vec![head, worker])
            }
            OrchestrationStrategy::Consensus => {
                let judge = self
                    .role_map
                    .get_model(AgentRole::Judge)
                    .unwrap_or(&"default".to_string())
                    .clone();
                ExecutionPlan::Consensus {
                    workers: vec!["default".to_string()],
                    judge,
                }
            }
            OrchestrationStrategy::Chaining => ExecutionPlan::Chaining { steps: vec![] },
            OrchestrationStrategy::EvaluatorOptimizer => {
                let generator = self
                    .role_map
                    .get_model(AgentRole::Worker)
                    .unwrap_or(&"default".to_string())
                    .clone();
                let evaluator = self
                    .role_map
                    .get_model(AgentRole::Evaluator)
                    .unwrap_or(&"default".to_string())
                    .clone();
                ExecutionPlan::EvaluatorOptimizer {
                    generator,
                    evaluator,
                    max_rounds: 3,
                }
            }
            OrchestrationStrategy::Parallelization => ExecutionPlan::Parallelization {
                models: vec!["default".to_string()],
                aggregator: "default".to_string(),
            },
        }
    }

    /// Route to the best model based on weighted scoring.
    pub fn route_selection(&self, registry: &ModelRegistry) -> Option<String> {
        let providers: Vec<String> = registry.list();

        if providers.is_empty() {
            return None;
        }

        // Use weighted scorer (50% price, 50% latency)
        let scorer = WeightedScorer::new(0.5, 0.5);
        let best_price = Price(1.0);
        let best_latency = Latency(1000.0);

        let mut scored: Vec<(String, f32)> = providers
            .iter()
            .map(|name| {
                let latency = registry.get_latency(name);
                let score = if let Some(provider) = registry.get(name) {
                    scorer
                        .calculate_score(&*provider, best_price, best_latency)
                        .0
                } else {
                    f32::MAX
                };
                (name.clone(), score)
            })
            .collect();

        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.first().map(|(name, _)| name.clone())
    }

    /// Classify input complexity for routing (simple → cheap model, complex → expensive model).
    pub fn classify_complexity(&self, input: &str) -> ComplexityLevel {
        // Heuristic classification
        let word_count = input.split_whitespace().count();
        let has_code =
            input.contains("```") || input.contains("fn ") || input.contains("function ");
        let has_multi_step =
            input.contains("step") || input.contains("first") || input.contains("then");
        let has_analysis =
            input.contains("analyze") || input.contains("explain") || input.contains("compare");

        if word_count > 200 || (has_code && has_multi_step) {
            ComplexityLevel::Complex
        } else if word_count > 50 || has_analysis || has_code {
            ComplexityLevel::Medium
        } else {
            ComplexityLevel::Simple
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ComplexityLevel {
    Simple,
    Medium,
    Complex,
}
