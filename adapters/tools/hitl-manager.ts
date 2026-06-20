/**
 * HITL (Human-in-the-Loop) Manager — task-level approval gates.
 *
 * Features:
 * - ApprovalRequest: pending → approved/rejected/modified
 * - Risk-based auto-approve: low risk auto-pass, high risk require human
 * - Persistent storage (.imzx/hitl/)
 * - Timeout with configurable default action
 * - CLI integration: imzx hitl approve/reject/list
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'modified';
export type ApprovalAction = 'approve' | 'reject' | 'require_approval';

export interface ApprovalRequest {
  id: string;
  taskType: string;
  toolName?: string;
  description: string;
  risk: RiskLevel;
  args: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  respondedAt: string | null;
  response: string | null;
  timeoutMs: number;
}

export interface HitlRule {
  condition: { toolName?: string; taskType?: string; pattern?: string };
  action: ApprovalAction;
  riskLevel?: RiskLevel;
  description: string;
}

export interface HitlConfig {
  baseDir?: string;
  defaultTimeoutMs?: number;
  defaultAction?: 'approve' | 'reject';
  rules?: HitlRule[];
  interactiveMode?: boolean;
}

// ─── Default Rules ───────────────────────────────────────────────────────────

const DEFAULT_RULES: HitlRule[] = [
  // Low risk — auto-approve
  { condition: { toolName: 'read_file' }, action: 'approve', description: 'Reading files is safe' },
  { condition: { toolName: 'list_directory' }, action: 'approve', description: 'Listing dirs is safe' },
  { condition: { toolName: 'search_files' }, action: 'approve', description: 'Searching is safe' },
  { condition: { toolName: 'calculate' }, action: 'approve', description: 'Math is safe' },
  // Medium risk — require approval
  { condition: { toolName: 'edit_file' }, action: 'require_approval', riskLevel: 'medium', description: 'File modification' },
  { condition: { toolName: 'write_file' }, action: 'require_approval', riskLevel: 'medium', description: 'File creation' },
  // High risk — always require approval
  { condition: { toolName: 'run_command' }, action: 'require_approval', riskLevel: 'high', description: 'Shell command execution' },
  { condition: { toolName: 'run_code' }, action: 'require_approval', riskLevel: 'high', description: 'Code execution' },
  { condition: { toolName: 'web_fetch' }, action: 'require_approval', riskLevel: 'medium', description: 'Network access' },
];

// ─── HITL Manager ────────────────────────────────────────────────────────────

export class HitlManager {
  private requests: Map<string, ApprovalRequest> = new Map();
  private rules: HitlRule[];
  private basePath: string;
  private defaultTimeoutMs: number;
  private defaultAction: 'approve' | 'reject';
  private interactiveMode: boolean;
  private waitResolvers: Map<string, (req: ApprovalRequest) => void> = new Map();

  constructor(config: HitlConfig = {}) {
    this.basePath = config.baseDir || join(process.cwd(), '.imzx', 'hitl');
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 60_000;
    this.defaultAction = config.defaultAction ?? 'reject';
    this.interactiveMode = config.interactiveMode ?? false;
    this.rules = config.rules || DEFAULT_RULES;
    this.loadFromDisk();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private loadFromDisk(): void {
    try {
      const path = join(this.basePath, 'pending.json');
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf-8')) as ApprovalRequest[];
        for (const req of data) this.requests.set(req.id, req);
      }
    } catch { /* start fresh on corruption */ }
  }

  private saveToDisk(): void {
    try {
      mkdirSync(this.basePath, { recursive: true });
      const pending = [...this.requests.values()].filter(r => r.status === 'pending');
      writeFileSync(join(this.basePath, 'pending.json'), JSON.stringify(pending, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  // ── Core Operations ──────────────────────────────────────────────────────

  /** Create a new approval request. Returns the request with auto-approve if low-risk. */
  createApproval(taskType: string, toolName: string | undefined, args: Record<string, unknown>, description: string): ApprovalRequest {
    const risk = this.assessRisk(toolName, taskType);
    const rule = this.matchRule(toolName, taskType);
    const ruleAction = rule?.action || 'require_approval';

    // Auto-approve low-risk tasks
    if (ruleAction === 'approve' || (risk === 'low' && ruleAction !== 'require_approval')) {
      return this.autoApprove(taskType, toolName, args, description, risk);
    }

    const id = `hitl_${randomBytes(4).toString('hex')}`;
    const req: ApprovalRequest = {
      id, taskType, toolName, description, risk, args,
      status: 'pending',
      createdAt: new Date().toISOString(),
      respondedAt: null,
      response: null,
      timeoutMs: this.defaultTimeoutMs,
    };

    this.requests.set(id, req);
    this.saveToDisk();

    // Interactive mode: prompt stdin
    if (this.interactiveMode) {
      this.promptInteractive(req);
    }

    return req;
  }

  /** Approve a pending request. */
  approve(id: string, response?: string): boolean {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return false;
    req.status = 'approved';
    req.respondedAt = new Date().toISOString();
    req.response = response || 'Approved by human';
    this.saveToDisk();
    this.notifyWaiters(id, req);
    return true;
  }

  /** Reject a pending request. */
  reject(id: string, reason?: string): boolean {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return false;
    req.status = 'rejected';
    req.respondedAt = new Date().toISOString();
    req.response = reason || 'Rejected by human';
    this.saveToDisk();
    this.notifyWaiters(id, req);
    return true;
  }

  /** Modify and approve with modified args. */
  modify(id: string, modifications: Record<string, unknown>): boolean {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return false;
    req.args = { ...req.args, ...modifications };
    req.status = 'modified';
    req.respondedAt = new Date().toISOString();
    req.response = 'Approved with modifications';
    this.saveToDisk();
    this.notifyWaiters(id, req);
    return true;
  }

  /** Wait for a request to be resolved (with timeout). */
  async waitForApproval(id: string): Promise<ApprovalRequest> {
    const req = this.requests.get(id);
    if (!req) throw new Error(`HITL request ${id} not found`);
    if (req.status !== 'pending') return req;

    // Wait for external resolution or timeout
    return new Promise<ApprovalRequest>((resolve) => {
      // Store resolver for external notification
      this.waitResolvers.set(id, resolve);

      // Timeout handler
      const timer = setTimeout(() => {
        this.waitResolvers.delete(id);
        if (req.status === 'pending') {
          if (this.defaultAction === 'approve') {
            this.approve(id, 'Auto-approved (timeout)');
          } else {
            this.reject(id, 'Auto-rejected (timeout)');
          }
          resolve(req);
        }
      }, req.timeoutMs);

      // If the request gets resolved externally, clear the timeout
      const originalNotify = this.notifyWaiters.bind(this);
      const check = () => {
        if (req.status !== 'pending') {
          clearTimeout(timer);
          resolve(req);
        }
      };
      // Poll for resolution (simple, no event system needed)
      const interval = setInterval(check, 500);
      setTimeout(() => clearInterval(interval), req.timeoutMs + 1000);
    });
  }

  /** Check if a request can be auto-approved based on rules. */
  checkAutoApprove(taskType: string, toolName?: string): { approved: boolean; reason?: string; risk: RiskLevel } {
    const rule = this.matchRule(toolName, taskType);
    const risk = this.assessRisk(toolName, taskType);

    if (rule?.action === 'approve') {
      return { approved: true, reason: rule.description, risk };
    }
    if (rule?.action === 'require_approval') {
      return { approved: false, reason: rule.description, risk };
    }
    return { approved: false, reason: 'No matching rule', risk };
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  listPending(): ApprovalRequest[] {
    return [...this.requests.values()].filter(r => r.status === 'pending');
  }

  listAll(): ApprovalRequest[] {
    return [...this.requests.values()];
  }

  getStats(): { total: number; pending: number; approved: number; rejected: number; modified: number } {
    const all = [...this.requests.values()];
    return {
      total: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      approved: all.filter(r => r.status === 'approved').length,
      rejected: all.filter(r => r.status === 'rejected').length,
      modified: all.filter(r => r.status === 'modified').length,
    };
  }

  // ── Internal Helpers ─────────────────────────────────────────────────────

  private assessRisk(toolName?: string, taskType?: string): RiskLevel {
    if (!toolName) return 'medium';
    const highRisk = new Set(['run_command', 'run_code']);
    const mediumRisk = new Set(['write_file', 'edit_file', 'web_fetch', 'web_search']);
    if (highRisk.has(toolName)) return 'high';
    if (mediumRisk.has(toolName)) return 'medium';
    return 'low';
  }

  private matchRule(toolName?: string, taskType?: string): HitlRule | undefined {
    return this.rules.find(r => {
      if (r.condition.toolName && r.condition.toolName !== toolName) return false;
      if (r.condition.taskType && r.condition.taskType !== taskType) return false;
      if (r.condition.pattern) {
        const target = `${taskType || ''} ${toolName || ''}`;
        if (!new RegExp(r.condition.pattern, 'i').test(target)) return false;
      }
      return true;
    });
  }

  private autoApprove(taskType: string, toolName: string | undefined, args: Record<string, unknown>, description: string, risk: RiskLevel): ApprovalRequest {
    const id = `hitl_auto_${randomBytes(4).toString('hex')}`;
    const req: ApprovalRequest = {
      id, taskType, toolName, description, risk, args,
      status: 'approved',
      createdAt: new Date().toISOString(),
      respondedAt: new Date().toISOString(),
      response: 'Auto-approved (low risk)',
      timeoutMs: 0,
    };
    this.requests.set(id, req);
    return req;
  }

  private notifyWaiters(id: string, req: ApprovalRequest): void {
    const resolver = this.waitResolvers.get(id);
    if (resolver) {
      this.waitResolvers.delete(id);
      resolver(req);
    }
  }

  private promptInteractive(req: ApprovalRequest): void {
    // Non-blocking — in real usage, the CLI handler manages stdin
    console.log(`\n[HITL] Approval required: ${req.description}`);
    console.log(`  Risk: ${req.risk} | Tool: ${req.toolName || 'task'}`);
    console.log(`  ID: ${req.id}`);
    console.log(`  Run: imzx hitl approve ${req.id}  OR  imzx hitl reject ${req.id}`);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: HitlManager | null = null;
export function getHitlManager(config?: HitlConfig): HitlManager {
  if (!_instance) _instance = new HitlManager(config);
  return _instance;
}
