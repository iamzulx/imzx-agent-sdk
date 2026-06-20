/**
 * TelemetryCollector — OpenTelemetry-compatible instrumentation for imzx.
 * Phase 4.2: Track LLM calls, tool calls, task completion.
 * File-based JSONL export by default, OTLP-compatible span format.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SpanEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer';
  startTime: string;
  endTime: string;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, string | number | boolean>;
  events?: Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>;
}

export interface LlmCallRecord {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  success: boolean;
  error?: string;
}

export interface ToolCallRecord {
  name: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface TaskRecord {
  taskType: string;
  outcome: 'success' | 'partial' | 'failure';
  durationMs: number;
  toolCount: number;
  totalTokens: number;
}

export interface TelemetrySummary {
  period: string; // ISO date or hour
  llmCalls: { total: number; success: number; totalTokens: number; totalCostUsd: number; avgLatencyMs: number };
  toolCalls: { total: number; success: number; byTool: Record<string, { calls: number; errors: number; avgDurationMs: number }> };
  tasks: { total: number; success: number; failure: number; avgDurationMs: number };
}

export class TelemetryCollector {
  private baseDir: string;
  private spansFile: string;
  private buffer: SpanEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private traceCounter: number = 0;
  private spanCounter: number = 0;
  private currentTraceId: string = '';
  private activeSpanStack: string[] = [];

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), '.imzx', 'telemetry');
    this.spansFile = path.join(this.baseDir, 'spans.jsonl');
    this.ensureDir();
    // Auto-flush every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  /** Start a new trace context. */
  startTrace(): string {
    this.traceCounter++;
    this.currentTraceId = `trace_${Date.now()}_${this.traceCounter.toString(36)}`;
    this.activeSpanStack = [];
    return this.currentTraceId;
  }

  /** Record an LLM API call as a span. */
  recordLlmCall(record: LlmCallRecord): void {
    const span = this.createSpan('llm.call', 'client', {
      'llm.model': record.model,
      'llm.provider': record.provider,
      'llm.input_tokens': record.inputTokens,
      'llm.output_tokens': record.outputTokens,
      'llm.total_tokens': record.inputTokens + record.outputTokens,
      'llm.cost_usd': record.estimatedCostUsd,
      'llm.latency_ms': record.latencyMs,
    }, record.latencyMs, record.success);
    this.addSpan(span);
  }

  /** Record a tool call as a span. */
  recordToolCall(record: ToolCallRecord): void {
    const span = this.createSpan(`tool.${record.name}`, 'internal', {
      'tool.name': record.name,
      'tool.duration_ms': record.durationMs,
      'tool.success': record.success,
    }, record.durationMs, record.success);
    if (record.error) {
      span.attributes['error.message'] = record.error;
    }
    this.addSpan(span);
  }

  /** Record task completion as a span. */
  recordTaskCompletion(record: TaskRecord): void {
    const span = this.createSpan('task.complete', 'internal', {
      'task.type': record.taskType,
      'task.outcome': record.outcome,
      'task.duration_ms': record.durationMs,
      'task.tool_count': record.toolCount,
      'task.total_tokens': record.totalTokens,
    }, record.durationMs, record.outcome === 'success');
    this.addSpan(span);
  }

  /** Get aggregated summaries for dashboard. */
  getHourlySummaries(lastN: number = 24): TelemetrySummary[] {
    return this.loadAndAggregate('hour', lastN);
  }

  getDailySummaries(lastN: number = 7): TelemetrySummary[] {
    return this.loadAndAggregate('day', lastN);
  }

  /** Flush buffered spans to disk. */
  flush(): void {
    if (this.buffer.length === 0) return;
    try {
      this.ensureDir();
      const lines = this.buffer.map(s => JSON.stringify(s)).join('\n') + '\n';
      fs.appendFileSync(this.spansFile, lines, 'utf-8');
      this.buffer = [];
    } catch {}
  }

  /** Shutdown — flush remaining, clear interval. */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }

  // --- Private helpers ---

  private createSpan(name: string, kind: SpanEvent['kind'], attributes: Record<string, string | number | boolean>, durationMs: number, success: boolean): SpanEvent {
    this.spanCounter++;
    const now = new Date();
    const startTime = new Date(now.getTime() - durationMs).toISOString();
    const spanId = `span_${now.getTime()}_${this.spanCounter.toString(36)}`;
    const parentSpanId = this.activeSpanStack.length > 0 ? this.activeSpanStack[this.activeSpanStack.length - 1] : undefined;

    return {
      traceId: this.currentTraceId || `trace_${Date.now()}_0`,
      spanId,
      parentSpanId,
      name,
      kind,
      startTime,
      endTime: now.toISOString(),
      durationMs,
      status: success ? 'ok' : 'error',
      attributes,
    };
  }

  private addSpan(span: SpanEvent): void {
    this.buffer.push(span);
    if (this.buffer.length >= 50) this.flush();
  }

  private ensureDir(): void {
    try { fs.mkdirSync(this.baseDir, { recursive: true }); } catch {}
  }

  private loadAndAggregate(granularity: 'hour' | 'day', lastN: number): TelemetrySummary[] {
    const spans = this.loadAllSpans();
    if (spans.length === 0) return [];

    // Group by time bucket
    const buckets = new Map<string, SpanEvent[]>();
    for (const span of spans) {
      const date = new Date(span.endTime);
      const key = granularity === 'hour'
        ? `${date.toISOString().slice(0, 13)}:00`
        : date.toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(span);
    }

    // Take last N buckets
    const sortedKeys = [...buckets.keys()].sort().slice(-lastN);

    return sortedKeys.map(period => {
      const spans = buckets.get(period)!;
      const llmSpans = spans.filter(s => s.name === 'llm.call');
      const toolSpans = spans.filter(s => s.name.startsWith('tool.'));
      const taskSpans = spans.filter(s => s.name === 'task.complete');

      const toolBy: Record<string, { calls: number; errors: number; totalDuration: number }> = {};
      for (const s of toolSpans) {
        const name = (s.attributes['tool.name'] as string) || 'unknown';
        if (!toolBy[name]) toolBy[name] = { calls: 0, errors: 0, totalDuration: 0 };
        toolBy[name].calls++;
        if (s.status === 'error') toolBy[name].errors++;
        toolBy[name].totalDuration += s.durationMs;
      }

      return {
        period,
        llmCalls: {
          total: llmSpans.length,
          success: llmSpans.filter(s => s.status === 'ok').length,
          totalTokens: llmSpans.reduce((sum, s) => sum + ((s.attributes['llm.total_tokens'] as number) || 0), 0),
          totalCostUsd: llmSpans.reduce((sum, s) => sum + ((s.attributes['llm.cost_usd'] as number) || 0), 0),
          avgLatencyMs: llmSpans.length ? Math.round(llmSpans.reduce((sum, s) => sum + s.durationMs, 0) / llmSpans.length) : 0,
        },
        toolCalls: {
          total: toolSpans.length,
          success: toolSpans.filter(s => s.status === 'ok').length,
          byTool: Object.fromEntries(
            Object.entries(toolBy).map(([name, v]) => [name, { calls: v.calls, errors: v.errors, avgDurationMs: Math.round(v.totalDuration / v.calls) }])
          ),
        },
        tasks: {
          total: taskSpans.length,
          success: taskSpans.filter(s => s.status === 'ok').length,
          failure: taskSpans.filter(s => s.status === 'error').length,
          avgDurationMs: taskSpans.length ? Math.round(taskSpans.reduce((sum, s) => sum + s.durationMs, 0) / taskSpans.length) : 0,
        },
      };
    });
  }

  private loadAllSpans(): SpanEvent[] {
    try {
      if (!fs.existsSync(this.spansFile)) return [];
      const data = fs.readFileSync(this.spansFile, 'utf-8');
      return data.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line) as SpanEvent; } catch { return null; }
      }).filter((s): s is SpanEvent => s !== null);
    } catch {
      return [];
    }
  }
}
