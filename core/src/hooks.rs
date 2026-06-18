// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Hooks module — middleware lifecycle system for agent execution.
// Inspired by Claude Agent SDK hooks (PreToolUse, PostToolUse, AgentStart, AgentEnd).
// Allows intercepting, logging, validating, and transforming agent behavior at key points.

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Lifecycle events that can trigger hooks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HookEvent {
    /// Fired before agent starts processing input.
    AgentStart { input: String },
    /// Fired before a tool is executed.
    PreToolUse { tool_name: String, args: String },
    /// Fired after a tool returns a result.
    PostToolUse {
        tool_name: String,
        result: String,
        duration_ms: u64,
    },
    /// Fired after agent produces final response.
    AgentEnd {
        response: String,
        total_iterations: u32,
    },
    /// Fired on each thinking/reasoning iteration.
    OnIteration { iteration: u32, thinking: String },
    /// Fired when an error occurs.
    OnError { error: String, context: String },
    /// Fired when budget threshold is reached (80%, 90%, 100%).
    OnBudgetWarning {
        tokens_used: u64,
        budget_limit: u64,
        cost_usd: f64,
    },
}

/// Result returned by hooks — can allow, reject, or transform.
#[derive(Debug, Clone)]
pub enum HookResult {
    /// Continue execution normally.
    Continue,
    /// Block execution with a reason message.
    Block(String),
    /// Replace the output/value with a transformed version.
    Transform(String),
}

/// Hook trait — implement this to create custom hooks.
#[async_trait]
pub trait Hook: Send + Sync {
    /// Human-readable name for this hook.
    fn name(&self) -> &str;

    /// Called for each lifecycle event. Return HookResult to control flow.
    async fn handle(&self, event: &HookEvent) -> Result<HookResult>;
}

/// Hook registry — manages and executes hooks in order.
#[derive(Default)]
pub struct HookRegistry {
    hooks: Vec<Arc<dyn Hook>>,
}

impl HookRegistry {
    pub fn new() -> Self {
        Self { hooks: Vec::new() }
    }

    /// Register a hook. Order matters — hooks execute in registration order.
    pub fn register(&mut self, hook: Arc<dyn Hook>) {
        self.hooks.push(hook);
    }

    /// Execute all hooks for a given event. Returns Ok(Continue) if all pass,
    /// or the first Block/Transform result.
    pub async fn execute(&self, event: &HookEvent) -> Result<HookResult> {
        for hook in &self.hooks {
            match hook.handle(event).await? {
                HookResult::Continue => continue,
                blocked @ HookResult::Block(_) => return Ok(blocked),
                transformed @ HookResult::Transform(_) => return Ok(transformed),
            }
        }
        Ok(HookResult::Continue)
    }

    /// Number of registered hooks.
    pub fn len(&self) -> usize {
        self.hooks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.hooks.is_empty()
    }
}

// --- Built-in Hooks ---

/// Audit hook — logs all tool calls for security auditing.
pub struct AuditHook {
    log: std::sync::Mutex<Vec<AuditEntry>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub event_type: String,
    pub details: String,
}

impl AuditHook {
    pub fn new() -> Self {
        Self {
            log: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn get_log(&self) -> Vec<AuditEntry> {
        self.log.lock().unwrap().clone()
    }
}

#[async_trait]
impl Hook for AuditHook {
    fn name(&self) -> &str {
        "audit"
    }

    async fn handle(&self, event: &HookEvent) -> Result<HookResult> {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: format!("{:?}", std::mem::discriminant(event)),
            details: format!("{:?}", event),
        };
        if let Ok(mut log) = self.log.lock() {
            log.push(entry);
        }
        Ok(HookResult::Continue)
    }
}

/// Rate limiter hook — limits tool calls per minute.
pub struct RateLimiterHook {
    max_calls_per_minute: u32,
    calls: std::sync::Mutex<Vec<std::time::Instant>>,
}

impl RateLimiterHook {
    pub fn new(max_calls_per_minute: u32) -> Self {
        Self {
            max_calls_per_minute,
            calls: std::sync::Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl Hook for RateLimiterHook {
    fn name(&self) -> &str {
        "rate_limiter"
    }

    async fn handle(&self, event: &HookEvent) -> Result<HookResult> {
        if let HookEvent::PreToolUse { .. } = event {
            let now = std::time::Instant::now();
            let mut calls = self.calls.lock().unwrap();
            // Remove calls older than 1 minute
            calls.retain(|t| now.duration_since(*t).as_secs() < 60);
            if calls.len() >= self.max_calls_per_minute as usize {
                return Ok(HookResult::Block(format!(
                    "Rate limit exceeded: {} calls in last minute (max: {})",
                    calls.len(),
                    self.max_calls_per_minute
                )));
            }
            calls.push(now);
        }
        Ok(HookResult::Continue)
    }
}

/// Cost guard hook — blocks execution when budget is nearly exhausted.
pub struct CostGuardHook {
    warning_threshold_pct: f64,
    block_threshold_pct: f64,
}

impl CostGuardHook {
    pub fn new(warning_pct: f64, block_pct: f64) -> Self {
        Self {
            warning_threshold_pct: warning_pct,
            block_threshold_pct: block_pct,
        }
    }
}

#[async_trait]
impl Hook for CostGuardHook {
    fn name(&self) -> &str {
        "cost_guard"
    }

    async fn handle(&self, event: &HookEvent) -> Result<HookResult> {
        if let HookEvent::OnBudgetWarning {
            tokens_used,
            budget_limit,
            ..
        } = event
        {
            let pct = *tokens_used as f64 / *budget_limit as f64;
            if pct >= self.block_threshold_pct {
                return Ok(HookResult::Block(format!(
                    "Budget exhausted: {:.0}% of limit used ({}/{})",
                    pct * 100.0,
                    tokens_used,
                    budget_limit
                )));
            }
        }
        Ok(HookResult::Continue)
    }
}
