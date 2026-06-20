/**
 * Policy-as-Code Engine — declarative governance rules for agent actions.
 *
 * Features:
 * - Rule-based policy evaluation with priority ordering
 * - Built-in policies: no system files, max web searches, require approval for writes
 * - Policy violation logging
 * - Governance agent that monitors and escalates
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PolicyAction = 'allow' | 'deny' | 'require_approval';

export interface PolicyCondition {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'gt' | 'lt' | 'in' | 'not_in';
  value: unknown;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  conditions: PolicyCondition[];
  action: PolicyAction;
  priority: number; // higher = evaluated first
  enabled: boolean;
}

export interface PolicyContext {
  agentId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  taskType?: string;
  prompt?: string;
  userId?: string;
  environment?: string;
  [key: string]: unknown;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  appliedPolicy: string;
}

// ─── Built-in Policies ───────────────────────────────────────────────────────

const BUILTIN_POLICIES: Policy[] = [
  {
    id: 'no-system-files',
    name: 'No System Files',
    description: 'Deny access to /etc, /proc, /sys, /dev',
    conditions: [
      { field: 'toolArgs.path', operator: 'regex', value: '^/(etc|proc|sys|dev)/' },
    ],
    action: 'deny',
    priority: 100,
    enabled: true,
  },
  {
    id: 'max-web-search',
    name: 'Max Web Searches Per Task',
    description: 'Limit web_search to 5 per task',
    conditions: [
      { field: 'toolName', operator: 'equals', value: 'web_search' },
      { field: '_toolCallCount', operator: 'gt', value: 5 },
    ],
    action: 'deny',
    priority: 90,
    enabled: true,
  },
  {
    id: 'no-network-commands',
    name: 'No Network Commands',
    description: 'Block curl, wget, nc in run_command',
    conditions: [
      { field: 'toolName', operator: 'equals', value: 'run_command' },
      { field: 'toolArgs.command', operator: 'regex', value: '^(curl|wget|nc|ncat|socat)\\b' },
    ],
    action: 'deny',
    priority: 95,
    enabled: true,
  },
  {
    id: 'require-approval-writes',
    name: 'Require Approval for Writes',
    description: 'write_file and edit_file require human approval',
    conditions: [
      { field: 'toolName', operator: 'in', value: ['write_file', 'edit_file'] },
    ],
    action: 'require_approval',
    priority: 80,
    enabled: true,
  },
  {
    id: 'require-approval-exec',
    name: 'Require Approval for Execution',
    description: 'run_command and run_code require human approval',
    conditions: [
      { field: 'toolName', operator: 'in', value: ['run_command', 'run_code'] },
    ],
    action: 'require_approval',
    priority: 85,
    enabled: true,
  },
  {
    id: 'max-token-budget',
    name: 'Token Budget Limit',
    description: 'Deny tasks estimated over 100K tokens',
    conditions: [
      { field: '_estimatedTokens', operator: 'gt', value: 100000 },
    ],
    action: 'deny',
    priority: 70,
    enabled: true,
  },
];

// ─── Policy Engine ───────────────────────────────────────────────────────────

export class PolicyEngine {
  private policies: Policy[] = [];
  private violationsPath: string;

  constructor(baseDir?: string) {
    const dir = baseDir || join(process.cwd(), '.imzx');
    this.violationsPath = join(dir, 'logs', 'policy-violations.jsonl');
    this.policies = [...BUILTIN_POLICIES];
  }

  loadPolicies(policies: Policy[]): void {
    this.policies = [...policies, ...BUILTIN_POLICIES];
    this.policies.sort((a, b) => b.priority - a.priority);
  }

  loadFromFile(path: string): void {
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, 'utf-8')) as Policy[];
    this.loadPolicies(data);
  }

  addPolicy(policy: Policy): void {
    this.policies.push(policy);
    this.policies.sort((a, b) => b.priority - a.priority);
  }

  removePolicy(id: string): boolean {
    const idx = this.policies.findIndex(p => p.id === id);
    if (idx < 0) return false;
    this.policies.splice(idx, 1);
    return true;
  }

  listPolicies(): Policy[] {
    return [...this.policies];
  }

  /** Evaluate context against all policies. Returns decision from first matching policy. */
  evaluate(context: PolicyContext): PolicyDecision {
    for (const policy of this.policies) {
      if (!policy.enabled) continue;
      if (this.matchesConditions(policy.conditions, context)) {
        const decision: PolicyDecision = {
          allowed: policy.action === 'allow',
          requiresApproval: policy.action === 'require_approval',
          reason: policy.description,
          appliedPolicy: policy.id,
        };

        if (policy.action === 'deny') {
          this.logViolation(context, policy);
        }

        return decision;
      }
    }

    // Default: allow if no policy matches
    return { allowed: true, requiresApproval: false, reason: 'No policy matched', appliedPolicy: 'default' };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private matchesConditions(conditions: PolicyCondition[], context: PolicyContext): boolean {
    return conditions.every(c => {
      const value = this.resolveField(c.field, context);
      switch (c.operator) {
        case 'equals': return value === c.value;
        case 'contains': return typeof value === 'string' && typeof c.value === 'string' && value.includes(c.value);
        case 'regex': return typeof value === 'string' && typeof c.value === 'string' && new RegExp(c.value).test(value);
        case 'gt': return typeof value === 'number' && typeof c.value === 'number' && value > c.value;
        case 'lt': return typeof value === 'number' && typeof c.value === 'number' && value < c.value;
        case 'in': return Array.isArray(c.value) && c.value.includes(value);
        case 'not_in': return Array.isArray(c.value) && !c.value.includes(value);
        default: return false;
      }
    });
  }

  private resolveField(field: string, context: PolicyContext): unknown {
    const parts = field.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (part.startsWith('_')) return (context as Record<string, unknown>)[part]; // meta-fields
      if (current && typeof current === 'object') current = (current as Record<string, unknown>)[part];
      else return undefined;
    }
    return current;
  }

  private logViolation(context: PolicyContext, policy: Policy): void {
    const event = {
      timestamp: new Date().toISOString(),
      eventType: 'policy_violation',
      policyId: policy.id,
      policyName: policy.name,
      toolName: context.toolName,
      agentId: context.agentId,
      reason: policy.description,
    };
    try {
      mkdirSync(dirname(this.violationsPath), { recursive: true });
      appendFileSync(this.violationsPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch { /* ignore */ }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _engine: PolicyEngine | null = null;
export function getPolicyEngine(baseDir?: string): PolicyEngine {
  if (!_engine) _engine = new PolicyEngine(baseDir);
  return _engine;
}
