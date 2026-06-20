/**
 * Agent Lifecycle Management — explicit states, health checks, auto-restart.
 *
 * Lifecycle: init → planning → executing → waiting → completed → terminated
 * Features: health monitoring, graceful shutdown, crash recovery, restart.
 */

import { EventEmitter } from 'node:events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentState = 'init' | 'planning' | 'executing' | 'waiting' | 'completed' | 'terminated' | 'error';

export interface LifecycleEvent {
  agentId: string;
  fromState: AgentState;
  toState: AgentState;
  timestamp: string;
  reason?: string;
}

export interface HealthStatus {
  agentId: string;
  state: AgentState;
  uptime: number;
  memoryUsageMb: number;
  cpuUsagePct: number;
  lastActivity: string;
  restartCount: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

export interface AgentLifecycleConfig {
  agentId: string;
  maxRestartAttempts?: number;
  restartDelayMs?: number;
  healthCheckIntervalMs?: number;
  maxIdleMs?: number;
  onStateChange?: (event: LifecycleEvent) => void;
  onError?: (error: Error) => void;
}

// ─── Lifecycle Manager ───────────────────────────────────────────────────────

export class AgentLifecycleManager extends EventEmitter {
  private state: AgentState = 'init';
  private agentId: string;
  private startTime: number;
  private lastActivity: number;
  private restartCount: number = 0;
  private maxRestartAttempts: number;
  private restartDelayMs: number;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private maxIdleMs: number;
  private eventLog: LifecycleEvent[] = [];
  private onStateChange?: (event: LifecycleEvent) => void;
  private onError?: (error: Error) => void;

  constructor(config: AgentLifecycleConfig) {
    super();
    this.agentId = config.agentId;
    this.startTime = Date.now();
    this.lastActivity = Date.now();
    this.maxRestartAttempts = config.maxRestartAttempts ?? 3;
    this.restartDelayMs = config.restartDelayMs ?? 5000;
    this.maxIdleMs = config.maxIdleMs ?? 300_000; // 5 min
    this.onStateChange = config.onStateChange;
    this.onError = config.onError;

    if (config.healthCheckIntervalMs) {
      this.healthCheckInterval = setInterval(() => this.checkHealth(), config.healthCheckIntervalMs);
    }
  }

  /** Transition to a new state. */
  transition(to: AgentState, reason?: string): void {
    const from = this.state;
    if (!this.isValidTransition(from, to)) {
      throw new Error(`Invalid lifecycle transition: ${from} → ${to}`);
    }
    this.state = to;
    this.lastActivity = Date.now();
    const event: LifecycleEvent = {
      agentId: this.agentId,
      fromState: from,
      toState: to,
      timestamp: new Date().toISOString(),
      reason,
    };
    this.eventLog.push(event);
    this.emit('stateChange', event);
    this.onStateChange?.(event);
  }

  /** Get current state. */
  getState(): AgentState { return this.state; }

  /** Get health status. */
  getHealth(): HealthStatus {
    const uptime = Date.now() - this.startTime;
    const idle = Date.now() - this.lastActivity;
    let health: HealthStatus['health'] = 'healthy';
    if (this.state === 'error') health = 'unhealthy';
    else if (idle > this.maxIdleMs * 0.8) health = 'degraded';
    else if (this.restartCount > this.maxRestartAttempts) health = 'unhealthy';

    return {
      agentId: this.agentId,
      state: this.state,
      uptime,
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
      cpuUsagePct: 0, // TODO: use os.cpus() if needed
      lastActivity: new Date(this.lastActivity).toISOString(),
      restartCount: this.restartCount,
      health,
    };
  }

  /** Attempt to restart the agent. */
  async restart(reason?: string): Promise<boolean> {
    if (this.restartCount >= this.maxRestartAttempts) {
      this.transition('terminated', `Max restart attempts (${this.maxRestartAttempts}) exceeded`);
      return false;
    }
    this.restartCount++;
    this.transition('init', reason || 'restart');
    await new Promise(r => setTimeout(r, this.restartDelayMs));
    return true;
  }

  /** Graceful shutdown. */
  shutdown(reason?: string): void {
    this.transition('terminated', reason || 'graceful shutdown');
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /** Get event log. */
  getEvents(): LifecycleEvent[] { return [...this.eventLog]; }

  /** Mark as active (resets idle timer). */
  touch(): void { this.lastActivity = Date.now(); }

  // ── Internals ────────────────────────────────────────────────────────────

  private isValidTransition(from: AgentState, to: AgentState): boolean {
    const valid: Record<AgentState, AgentState[]> = {
      init: ['planning', 'terminated', 'error'],
      planning: ['executing', 'waiting', 'terminated', 'error'],
      executing: ['waiting', 'completed', 'terminated', 'error'],
      waiting: ['executing', 'completed', 'terminated', 'error'],
      completed: ['init', 'terminated'],
      terminated: [],
      error: ['init', 'terminated'],
    };
    return valid[from]?.includes(to) ?? false;
  }

  private checkHealth(): void {
    const health = this.getHealth();
    if (health.health === 'unhealthy') {
      this.emit('unhealthy', health);
      this.onError?.(new Error(`Agent ${this.agentId} is unhealthy`));
    }
  }

  dispose(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}
