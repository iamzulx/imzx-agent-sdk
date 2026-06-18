/**
 * Event Logger — structured event bus for agent lifecycle observability.
 * Based on: OpenTelemetry GenAI semantic conventions (2026), Braintrust.
 * Publishes events that hooks, tracers, and UIs can subscribe to.
 */

export type EventType =
  | 'agent_start' | 'agent_end' | 'agent_error'
  | 'llm_call_start' | 'llm_call_end'
  | 'tool_call_start' | 'tool_call_end' | 'tool_call_error'
  | 'memory_write' | 'memory_read'
  | 'reflection_saved' | 'skill_saved' | 'evaluation_saved'
  | 'checkpoint_saved' | 'checkpoint_restored'
  | 'guardrail_triggered' | 'budget_warning' | 'budget_exceeded'
  | 'workflow_start' | 'workflow_step' | 'workflow_end';

export interface AgentEvent {
  id: string;
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
}

type EventHandler = (event: AgentEvent) => void;

export class EventLogger {
  private handlers: Map<EventType, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private history: AgentEvent[] = [];
  private maxHistory: number = 1000;

  emit(type: EventType, data: Record<string, unknown> = {}, durationMs?: number, error?: string): AgentEvent {
    const event: AgentEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      timestamp: new Date().toISOString(),
      data,
      duration_ms: durationMs,
      error,
    };
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
    const specific = this.handlers.get(type);
    if (specific) specific.forEach(h => { try { h(event); } catch {} });
    this.globalHandlers.forEach(h => { try { h(event); } catch {} });
    return event;
  }

  on(type: EventType, handler: EventHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  onAll(handler: EventHandler): void { this.globalHandlers.add(handler); }

  off(type: EventType, handler: EventHandler): void { this.handlers.get(type)?.delete(handler); }
  offAll(handler: EventHandler): void { this.globalHandlers.delete(handler); }

  getHistory(type?: EventType, limit: number = 50): AgentEvent[] {
    const filtered = type ? this.history.filter(e => e.type === type) : this.history;
    return filtered.slice(-limit);
  }

  getStats(): { total: number; byType: Record<string, number>; errors: number } {
    const byType: Record<string, number> = {};
    let errors = 0;
    for (const e of this.history) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.error) errors++;
    }
    return { total: this.history.length, byType, errors };
  }

  formatForPrompt(): string {
    const stats = this.getStats();
    if (stats.total === 0) return '';
    const recent = this.history.slice(-5).map(e => `  - ${e.type}: ${JSON.stringify(e.data).substring(0, 80)}`);
    return `\n\n## Recent Events (${stats.total} total, ${stats.errors} errors):\n${recent.join('\n')}`;
  }
}
