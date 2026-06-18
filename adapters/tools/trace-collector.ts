/**
 * Agent Tracer — structured trace collection for observability.
 * Based on: Braintrust (2026), Langfuse, Arize Phoenix, OpenTelemetry GenAI.
 * Captures every step: tool calls, reasoning, memory ops, cost attribution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TraceSpan {
  id: string;
  parent_id?: string;
  name: string;
  type: 'agent_start' | 'llm_call' | 'tool_call' | 'memory_op' | 'hook_call' | 'agent_end' | 'error';
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error' | 'timeout';
  error_message?: string;
}

export interface Trace {
  trace_id: string;
  agent_id: string;
  user_prompt: string;
  spans: TraceSpan[];
  start_time: string;
  end_time?: string;
  total_duration_ms?: number;
  total_tokens: number;
  total_cost_usd: number;
  outcome: 'success' | 'partial' | 'failure';
}

export class AgentTracer {
  private currentTrace: Trace | null = null;
  private spanStack: TraceSpan[] = [];
  private logPath: string;

  constructor(logDir?: string) {
    const dir = logDir || path.join(process.cwd(), '.imzx', 'traces');
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, `trace-${new Date().toISOString().slice(0, 10)}.jsonl`);
  }

  startTrace(agentId: string, userPrompt: string): string {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.currentTrace = { trace_id: traceId, agent_id: agentId, user_prompt: userPrompt, spans: [], start_time: new Date().toISOString(), total_tokens: 0, total_cost_usd: 0, outcome: 'success' };
    return traceId;
  }

  startSpan(name: string, type: TraceSpan['type'], attributes: Record<string, unknown> = {}): string {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parent_id = this.spanStack.length > 0 ? this.spanStack[this.spanStack.length - 1].id : undefined;
    const span: TraceSpan = { id: spanId, parent_id, name, type, start_time: new Date().toISOString(), attributes, status: 'ok' };
    this.spanStack.push(span);
    this.currentTrace?.spans.push(span);
    return spanId;
  }

  endSpan(spanId: string, attributes?: Record<string, unknown>): void {
    const idx = this.spanStack.findIndex(s => s.id === spanId);
    if (idx < 0) return;
    const span = this.spanStack.splice(idx, 1)[0];
    span.end_time = new Date().toISOString();
    span.duration_ms = new Date(span.end_time).getTime() - new Date(span.start_time).getTime();
    if (attributes) Object.assign(span.attributes, attributes);
  }

  endSpanError(spanId: string, error: string): void {
    const idx = this.spanStack.findIndex(s => s.id === spanId);
    if (idx < 0) return;
    const span = this.spanStack.splice(idx, 1)[0];
    span.end_time = new Date().toISOString();
    span.duration_ms = new Date(span.end_time).getTime() - new Date(span.start_time).getTime();
    span.status = 'error';
    span.error_message = error;
  }

  addTokens(input: number, output: number): void {
    if (!this.currentTrace) return;
    this.currentTrace.total_tokens += input + output;
    this.currentTrace.total_cost_usd += (input * 3 + output * 15) / 1_000_000;
  }

  endTrace(outcome: 'success' | 'partial' | 'failure'): Trace | null {
    if (!this.currentTrace) return null;
    this.currentTrace.end_time = new Date().toISOString();
    this.currentTrace.total_duration_ms = new Date(this.currentTrace.end_time).getTime() - new Date(this.currentTrace.start_time).getTime();
    this.currentTrace.outcome = outcome;
    try { fs.appendFileSync(this.logPath, JSON.stringify(this.currentTrace) + '\n'); } catch {}
    const trace = this.currentTrace;
    this.currentTrace = null;
    this.spanStack = [];
    return trace;
  }

  getCurrentTrace(): Trace | null { return this.currentTrace; }

  getTraces(limit: number = 10): Trace[] {
    try {
      const lines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(l => l.trim());
      return lines.slice(-limit).map(l => JSON.parse(l) as Trace);
    } catch { return []; }
  }

  formatTrace(trace: Trace): string {
    const parts = [`Trace: ${trace.trace_id} (${trace.outcome})`];
    parts.push(`Duration: ${trace.total_duration_ms}ms | Tokens: ${trace.total_tokens} | Cost: $${trace.total_cost_usd.toFixed(4)}`);
    for (const span of trace.spans) {
      const dur = span.duration_ms ? ` (${span.duration_ms}ms)` : '';
      const err = span.error_message ? ` ERROR: ${span.error_message}` : '';
      parts.push(`  ${span.type}: ${span.name}${dur}${err}`);
    }
    return parts.join('\n');
  }
}
