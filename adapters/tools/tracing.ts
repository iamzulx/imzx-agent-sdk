/**
 * OpenTelemetry Tracing — real OTLP export for production observability.
 * [v0.8.0] Based on OTel Semantic Conventions v1.41 (gen_ai.* attributes).
 *
 * Usage:
 *   import './tracing.js';  // Must be imported BEFORE other modules
 *   // OR: node --require ./dist/tracing.js app.js
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP HTTP endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME — Service name (default: imzx-agent-sdk)
 *   IMZX_OTEL_ENABLED — Set to 'true' to enable (default: false)
 */

import { trace, SpanStatusCode, SpanKind, type Tracer } from '@opentelemetry/api';

let _tracer: Tracer | null = null;
let _enabled = false;

/**
 * Initialize OpenTelemetry tracing.
 * Call this once at application startup.
 */
export async function initTracing(): Promise<void> {
  if (process.env.IMZX_OTEL_ENABLED !== 'true') {
    return; // OTel disabled by default — opt-in
  }

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = (await import('@opentelemetry/resources')) as any;

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
    const serviceName = process.env.OTEL_SERVICE_NAME || 'imzx-agent-sdk';

    const sdk = new NodeSDK({
      resource: new Resource({
        'service.name': serviceName,
        'service.version': '0.8.0',
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
      }),
    });

    sdk.start();

    process.on('SIGTERM', () => {
      sdk.shutdown().then(() => process.exit(0));
    });

    _tracer = trace.getTracer('imzx-agent-sdk', '0.8.0');
    _enabled = true;
  } catch (err) {
    console.warn(`[tracing] OpenTelemetry init failed: ${(err as Error).message}`);
  }
}

/** Get the tracer instance (or null if disabled). */
export function getTracer(): Tracer | null {
  return _tracer;
}

/** Check if tracing is enabled. */
export function isTracingEnabled(): boolean {
  return _enabled;
}

/**
 * Wrap an LLM call with an OTel span using gen_ai.* semantic conventions.
 */
export async function traceLlmCall<T>(
  options: {
    provider: string;
    model: string;
    operation?: string;
  },
  fn: () => Promise<{ result: T; inputTokens?: number; outputTokens?: number; finishReason?: string }>
): Promise<T> {
  if (!_tracer || !_enabled) {
    const r = await fn();
    return r.result;
  }

  return _tracer.startActiveSpan(
    `${options.operation || 'chat'} ${options.model}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'gen_ai.operation.name': options.operation || 'chat',
        'gen_ai.provider.name': options.provider,
        'gen_ai.request.model': options.model,
      },
    },
    async (span) => {
      try {
        const { result, inputTokens, outputTokens, finishReason } = await fn();

        span.setAttributes({
          'gen_ai.usage.input_tokens': inputTokens ?? 0,
          'gen_ai.usage.output_tokens': outputTokens ?? 0,
          ...(finishReason && { 'gen_ai.response.finish_reasons': [finishReason] }),
        });

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        span.recordException(error as Error);
        span.end();
        throw error;
      }
    }
  );
}

/**
 * Wrap a tool execution with an OTel span.
 */
export async function traceToolCall<T>(
  toolName: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!_tracer || !_enabled) return fn();

  return _tracer.startActiveSpan(
    `execute_tool ${toolName}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'tool.name': toolName,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        span.recordException(error as Error);
        span.end();
        throw error;
      }
    }
  );
}

/**
 * Wrap an agent pipeline with a root span.
 */
export async function traceAgentPipeline<T>(
  query: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!_tracer || !_enabled) return fn();

  return _tracer.startActiveSpan(
    'agent.invoke',
    {
      kind: SpanKind.SERVER,
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'agent.query.length': query.length,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        span.recordException(error as Error);
        span.end();
        throw error;
      }
    }
  );
}
