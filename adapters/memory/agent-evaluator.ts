/**
 * AgentEvaluator — Comprehensive evaluation framework for agent task performance.
 *
 * Based on:
 * - Confident AI (2026): 3-level evaluation (end-to-end, trajectory, component)
 * - Opik self-optimizing agents: automatic improvement generation
 * - Evidently AI: prompt optimization with feedback loops
 *
 * Evaluates agent performance on 3 levels:
 * 1. End-to-end: did the task succeed? (40% weight)
 * 2. Trajectory: was the path efficient? (30% weight)
 * 3. Component: which tools/patterns worked best? (30% weight)
 *
 * Additional systems:
 * - Deterministic Replay: record & replay LLM interactions for debugging
 * - Benchmark Suite: standardized task evaluation
 * - Metrics: task-level and aggregate performance tracking
 * - Reports: human-readable and JSON evaluation reports
 *
 * Generates improvement suggestions and tracks trends over time.
 */

import { PersistentMemory } from './persistent-memory.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

// ─────────────────────────────────────────────
// Types: Core Evaluation
// ─────────────────────────────────────────────

export interface EvaluationResult {
  timestamp: string;
  task_summary: string;
  outcome: 'success' | 'partial' | 'failure';
  scores: {
    task_completion: number;   // 0-1: did it succeed?
    step_efficiency: number;   // 0-1: few iterations = better
    tool_correctness: number;  // 0-1: tools executed without error
    reasoning_quality: number; // 0-1: multi-tool coordination
  };
  total_score: number;
  improvements: string[];
  duration_ms: number;
}

// ─────────────────────────────────────────────
// Types: Deterministic Replay
// ─────────────────────────────────────────────

export interface ReplayLLMCall {
  /** Monotonic sequence number */
  seq: number;
  /** Wall-clock ISO timestamp */
  timestamp: string;
  /** Messages sent to the LLM */
  input_messages: ReplayMessage[];
  /** Model identifier */
  model: string;
  /** Temperature used (null if default) */
  temperature: number | null;
  /** Raw LLM response text */
  response_text: string;
  /** Tool calls the LLM requested */
  tool_calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Tool results returned */
  tool_results: Array<{
    tool_call_id: string;
    result: string;
    error?: string;
  }>;
  /** Latency in ms */
  duration_ms: number;
  /** Token counts */
  tokens: { prompt: number; completion: number; total: number };
  /** Cost in USD (null if unknown) */
  cost_usd: number | null;
}

export interface ReplayMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface ReplayLog {
  /** Unique task / run identifier */
  task_id: string;
  /** ISO timestamp when recording started */
  started_at: string;
  /** ISO timestamp when recording ended */
  ended_at: string;
  /** Total wall-clock duration */
  total_duration_ms: number;
  /** Final outcome */
  outcome: 'success' | 'partial' | 'failure';
  /** Ordered list of all LLM interactions */
  calls: ReplayLLMCall[];
  /** Metadata (model, persona, tags, etc.) */
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Types: Benchmark Suite
// ─────────────────────────────────────────────

export interface BenchmarkTask {
  /** Unique task id */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category for grouping */
  category: string;
  /** The input / prompt given to the agent */
  input: string;
  /** Expected final output substring or regex pattern */
  expectedOutput?: string;
  /** Tool names that should be called (order-independent) */
  expectedTools?: string[];
  /** Max agent iterations before forced stop */
  maxIterations?: number;
  /** Tags for filtering */
  tags?: string[];
}

export interface BenchmarkResult {
  task: BenchmarkTask;
  metrics: TaskMetrics;
  evaluation: EvaluationResult;
  /** Whether expectedOutput matched (null if not specified) */
  output_match: boolean | null;
  /** Whether all expectedTools were called (null if not specified) */
  tools_match: boolean | null;
  /** Specific failure reasons */
  failure_reasons: string[];
}

// ─────────────────────────────────────────────
// Types: Metrics
// ─────────────────────────────────────────────

export interface TaskMetrics {
  taskId: string;
  success: boolean;
  duration_ms: number;
  tokens_used: number;
  cost_usd: number;
  tools_called: string[];
  iterations: number;
  /** 0-1 accuracy if expectedOutput was provided */
  accuracy?: number;
}

export interface AggregateMetrics {
  totalTasks: number;
  successRate: number;
  avgDuration: number;
  avgTokens: number;
  avgCost: number;
  p95Duration: number;
  /** Breakdown by category */
  byCategory: Record<string, {
    count: number;
    successRate: number;
    avgDuration: number;
  }>;
}

// ─────────────────────────────────────────────
// Types: Agent runner interface (for benchmarks)
// ─────────────────────────────────────────────

export interface AgentRunner {
  /**
   * Run the agent on an input prompt.
   * Returns the output text, a list of tool names called,
   * iteration count, token usage, cost, and duration.
   */
  run(input: string, opts?: { maxIterations?: number }): Promise<AgentRunResult>;
}

export interface AgentRunResult {
  output: string;
  tools_called: string[];
  iterations: number;
  tokens_used: number;
  cost_usd: number;
  duration_ms: number;
  replay?: ReplayLog;
}

// ═════════════════════════════════════════════
// AgentEvaluator
// ═════════════════════════════════════════════

export class AgentEvaluator {
  private memory: PersistentMemory;
  private graph: KnowledgeGraph;
  private replayDir: string;

  constructor(
    memory: PersistentMemory,
    graph: KnowledgeGraph,
    opts?: { replayDir?: string }
  ) {
    this.memory = memory;
    this.graph = graph;
    this.replayDir = opts?.replayDir ?? '.imzx/replays';
  }

  // ───────────────────────────────────────────
  // 3-Level Evaluation (original + enhanced)
  // ───────────────────────────────────────────

  evaluate(
    taskSummary: string,
    outcome: 'success' | 'partial' | 'failure',
    toolsUsed: string[],
    iterations: number,
    tokensUsed: number,
    durationMs: number = 0
  ): EvaluationResult {
    // Level 1: End-to-end (task completion)
    const taskCompletion = outcome === 'success' ? 1.0 : outcome === 'partial' ? 0.5 : 0.0;

    // Level 2: Trajectory (efficiency)
    let stepEfficiency = 1.0;
    if (iterations > 5) stepEfficiency -= 0.2;
    if (iterations > 8) stepEfficiency -= 0.2;
    if (durationMs > 60000) stepEfficiency -= 0.1;
    stepEfficiency = Math.max(0, stepEfficiency);

    // Level 3a: Tool correctness
    const toolCorrectness = outcome === 'failure' ? 0.3 : 0.8;

    // Level 3b: Reasoning quality (multi-tool coordination)
    const uniqueTools = new Set(toolsUsed).size;
    const reasoningQuality = uniqueTools >= 2 && outcome === 'success'
      ? Math.min(1.0, 0.6 + uniqueTools * 0.1)
      : outcome === 'success' ? 0.7 : 0.3;

    const scores = {
      task_completion: taskCompletion,
      step_efficiency: Math.max(0, stepEfficiency),
      tool_correctness: toolCorrectness,
      reasoning_quality: reasoningQuality,
    };

    const totalScore =
      scores.task_completion * 0.4 +
      scores.step_efficiency * 0.3 +
      scores.tool_correctness * 0.15 +
      scores.reasoning_quality * 0.15;

    const improvements = this.generateImprovements(scores, outcome, toolsUsed, iterations);

    const result: EvaluationResult = {
      timestamp: new Date().toISOString(),
      task_summary: taskSummary.substring(0, 200),
      outcome,
      scores,
      total_score: Math.round(totalScore * 100) / 100,
      improvements,
      duration_ms: durationMs,
    };

    // Store evaluation in memory
    this.memory.save('session', `eval_${Date.now()}`, JSON.stringify(result), {
      tags: ['evaluation', outcome],
      importance: outcome === 'failure' ? 8 : 5,
    });

    // Store improvements as knowledge
    for (const imp of improvements) {
      this.memory.save('knowledge', `improvement_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, imp, {
        tags: ['improvement', 'auto-generated'],
        importance: 7,
      });
    }

    return result;
  }

  private generateImprovements(
    scores: EvaluationResult['scores'],
    outcome: string,
    toolsUsed: string[],
    iterations: number
  ): string[] {
    const improvements: string[] = [];

    if (scores.task_completion < 0.5) {
      improvements.push('Task failed — break into smaller steps next time');
    }
    if (scores.step_efficiency < 0.5) {
      improvements.push(`Too many iterations (${iterations}) — plan more before executing`);
    }
    if (scores.tool_correctness < 0.5) {
      improvements.push('Tool errors detected — verify tool arguments before calling');
    }
    if (scores.reasoning_quality < 0.5) {
      improvements.push('Single-tool approach — consider using multiple tools for complex tasks');
    }
    if (outcome === 'failure' && toolsUsed.includes('web_search')) {
      improvements.push('Web search was used in a failed task — try different query strategies');
    }
    if (iterations > 5) {
      improvements.push('High iteration count — use context engineering to reduce back-and-forth');
    }

    return improvements;
  }

  getTrend(): { direction: 'improving' | 'stable' | 'declining'; avgScore: number; evaluations: number } {
    const evaluations = this.memory.getByCategory('session')
      .filter(e => e.key.startsWith('eval_'))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);

    if (evaluations.length === 0) {
      return { direction: 'stable', avgScore: 0, evaluations: 0 };
    }

    const scores = evaluations.map(e => {
      try { return JSON.parse(e.content).total_score || 0; } catch { return 0; }
    });

    const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    const half = Math.floor(scores.length / 2);
    const recentAvg = scores.slice(0, half).reduce((s, v) => s + v, 0) / (half || 1);
    const olderAvg = scores.slice(half).reduce((s, v) => s + v, 0) / (scores.length - half || 1);

    let direction: 'improving' | 'stable' | 'declining' = 'stable';
    if (recentAvg > olderAvg + 0.1) direction = 'improving';
    if (recentAvg < olderAvg - 0.1) direction = 'declining';

    return { direction, avgScore: Math.round(avgScore * 100) / 100, evaluations: evaluations.length };
  }

  formatForPrompt(): string {
    const trend = this.getTrend();
    if (trend.evaluations === 0) return '';
    const icon = trend.direction === 'improving' ? '📈' : trend.direction === 'declining' ? '📉' : '➡️';
    return `\n\n## Self-Evaluation:\n- Score: ${trend.avgScore}/1.0 ${icon} ${trend.direction}\n- Based on: ${trend.evaluations} evaluations`;
  }

  // ───────────────────────────────────────────
  // 1. Deterministic Replay
  // ───────────────────────────────────────────

  /**
   * Save a replay log to disk for deterministic re-execution.
   */
  async saveReplay(taskId: string, log: ReplayLog): Promise<string> {
    const dir = this.replayDir;
    await ensureDir(dir);
    const filePath = join(dir, `${sanitizeFilename(taskId)}.json`);
    await writeFile(filePath, JSON.stringify(log, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Load a previously saved replay log.
   */
  async loadReplay(taskId: string): Promise<ReplayLog> {
    const filePath = join(this.replayDir, `${sanitizeFilename(taskId)}.json`);
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ReplayLog;
  }

  /**
   * List all available replay task IDs.
   */
  async listReplays(): Promise<string[]> {
    if (!existsSync(this.replayDir)) return [];
    const files = await readdir(this.replayDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  }

  /**
   * Replay a stored log deterministically.
   * The provided `replayFn` is called for each LLM call in order,
   * receiving the original call data. This allows injecting a mock LLM
   * or verifying deterministic behavior.
   *
   * Returns the collected results from each replay step.
   */
  async replayDeterministic<T>(
    taskId: string,
    replayFn: (call: ReplayLLMCall, index: number) => T | Promise<T>
  ): Promise<T[]> {
    const log = await this.loadReplay(taskId);
    const results: T[] = [];
    for (let i = 0; i < log.calls.length; i++) {
      results.push(await replayFn(log.calls[i], i));
    }
    return results;
  }

  /**
   * Build a ReplayLog from raw LLM call data (helper for instrumented agents).
   */
  buildReplayLog(
    taskId: string,
    calls: ReplayLLMCall[],
    outcome: 'success' | 'partial' | 'failure',
    metadata: Record<string, unknown> = {}
  ): ReplayLog {
    const started = calls.length > 0 ? calls[0].timestamp : new Date().toISOString();
    const ended = calls.length > 0 ? calls[calls.length - 1].timestamp : new Date().toISOString();
    const totalDuration = calls.reduce((sum, c) => sum + c.duration_ms, 0);

    return {
      task_id: taskId,
      started_at: started,
      ended_at: ended,
      total_duration_ms: totalDuration,
      outcome,
      calls,
      metadata,
    };
  }

  // ───────────────────────────────────────────
  // 2. Benchmark Suite
  // ───────────────────────────────────────────

  /**
   * Run a set of benchmark tasks against an agent runner.
   * Returns one BenchmarkResult per task.
   */
  async runBenchmark(
    tasks: BenchmarkTask[],
    runner: AgentRunner,
    opts?: { saveReplays?: boolean }
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      const runResult = await runner.run(task.input, {
        maxIterations: task.maxIterations,
      });

      // Evaluate output match
      let outputMatch: boolean | null = null;
      if (task.expectedOutput) {
        outputMatch = runResult.output.includes(task.expectedOutput);
      }

      // Evaluate tools match
      let toolsMatch: boolean | null = null;
      if (task.expectedTools) {
        const calledSet = new Set(runResult.tools_called);
        toolsMatch = task.expectedTools.every(t => calledSet.has(t));
      }

      // Determine success
      const success = (outputMatch !== false) && (toolsMatch !== false);

      // Failure reasons
      const failureReasons: string[] = [];
      if (outputMatch === false) {
        failureReasons.push(`Expected output containing "${task.expectedOutput}" not found`);
      }
      if (toolsMatch === false) {
        const missing = task.expectedTools!.filter(t => !runResult.tools_called.includes(t));
        failureReasons.push(`Missing expected tools: ${missing.join(', ')}`);
      }

      // Build task metrics
      const metrics: TaskMetrics = {
        taskId: task.id,
        success,
        duration_ms: runResult.duration_ms,
        tokens_used: runResult.tokens_used,
        cost_usd: runResult.cost_usd,
        tools_called: runResult.tools_called,
        iterations: runResult.iterations,
        accuracy: outputMatch !== null ? (outputMatch ? 1.0 : 0.0) : undefined,
      };

      // Run evaluation
      const evaluation = this.evaluate(
        `${task.name}: ${task.input.substring(0, 100)}`,
        success ? 'success' : 'failure',
        runResult.tools_called,
        runResult.iterations,
        runResult.tokens_used,
        runResult.duration_ms
      );

      // Optionally save replay
      if (opts?.saveReplays && runResult.replay) {
        await this.saveReplay(task.id, runResult.replay);
      }

      results.push({
        task,
        metrics,
        evaluation,
        output_match: outputMatch,
        tools_match: toolsMatch,
        failure_reasons: failureReasons,
      });
    }

    return results;
  }

  // ───────────────────────────────────────────
  // 2b. Built-in Benchmark Tasks
  // ───────────────────────────────────────────

  /**
   * Returns a default set of benchmark tasks covering common agent capabilities.
   */
  static getBuiltinTasks(): BenchmarkTask[] {
    return [
      {
        id: 'file_read_task',
        name: 'File Read',
        category: 'filesystem',
        input: 'Read the file package.json in the current directory and tell me the "name" field.',
        expectedOutput: '"name"',
        expectedTools: ['read_file'],
        maxIterations: 3,
        tags: ['basic', 'read'],
      },
      {
        id: 'code_edit_task',
        name: 'Code Edit',
        category: 'code',
        input: 'Create a file called /tmp/hello.ts with the content: console.log("hello world");',
        expectedTools: ['write_file'],
        maxIterations: 3,
        tags: ['basic', 'write'],
      },
      {
        id: 'web_search_task',
        name: 'Web Search',
        category: 'web',
        input: 'Search the web for "TypeScript 5.0 new features" and summarize the top result.',
        expectedTools: ['web_search'],
        maxIterations: 5,
        tags: ['basic', 'search'],
      },
      {
        id: 'multi_step_task',
        name: 'Multi-Step',
        category: 'reasoning',
        input: 'List all .ts files in the src/ directory, then count how many contain the word "export". Report the count.',
        expectedTools: ['list_directory', 'search_files'],
        maxIterations: 8,
        tags: ['advanced', 'multi-tool'],
      },
    ];
  }

  // ───────────────────────────────────────────
  // 3. Metrics
  // ───────────────────────────────────────────

  /**
   * Calculate aggregate metrics from a list of task metrics.
   */
  static calculateAggregate(metrics: TaskMetrics[]): AggregateMetrics {
    if (metrics.length === 0) {
      return {
        totalTasks: 0,
        successRate: 0,
        avgDuration: 0,
        avgTokens: 0,
        avgCost: 0,
        p95Duration: 0,
        byCategory: {},
      };
    }

    const totalTasks = metrics.length;
    const successCount = metrics.filter(m => m.success).length;
    const successRate = successCount / totalTasks;

    const avgDuration = metrics.reduce((s, m) => s + m.duration_ms, 0) / totalTasks;
    const avgTokens = metrics.reduce((s, m) => s + m.tokens_used, 0) / totalTasks;
    const avgCost = metrics.reduce((s, m) => s + m.cost_usd, 0) / totalTasks;

    // P95 duration
    const sorted = [...metrics].sort((a, b) => a.duration_ms - b.duration_ms);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95Duration = sorted[Math.max(0, p95Index)].duration_ms;

    return {
      totalTasks,
      successRate: round2(successRate),
      avgDuration: round2(avgDuration),
      avgTokens: round2(avgTokens),
      avgCost: round4(avgCost),
      p95Duration: round2(p95Duration),
      byCategory: {},
    };
  }

  /**
   * Calculate aggregate metrics broken down by category.
   * Categories come from the provided benchmark tasks (matched by taskId).
   */
  static calculateAggregateByCategory(
    metrics: TaskMetrics[],
    tasks: BenchmarkTask[]
  ): AggregateMetrics {
    const agg = AgentEvaluator.calculateAggregate(metrics);

    // Build taskId → category lookup
    const categoryMap = new Map<string, string>();
    for (const t of tasks) categoryMap.set(t.id, t.category);

    // Group by category
    const groups = new Map<string, TaskMetrics[]>();
    for (const m of metrics) {
      const cat = categoryMap.get(m.taskId) ?? 'unknown';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(m);
    }

    const byCategory: Record<string, { count: number; successRate: number; avgDuration: number }> = {};
    for (const [cat, group] of groups) {
      byCategory[cat] = {
        count: group.length,
        successRate: round2(group.filter(m => m.success).length / group.length),
        avgDuration: round2(group.reduce((s, m) => s + m.duration_ms, 0) / group.length),
      };
    }

    return { ...agg, byCategory };
  }

  // ───────────────────────────────────────────
  // 4. Evaluation Reports
  // ───────────────────────────────────────────

  /**
   * Generate a human-readable evaluation report.
   */
  static generateReport(metrics: AggregateMetrics): string {
    const lines: string[] = [];

    lines.push('╔══════════════════════════════════════════════╗');
    lines.push('║        Agent Evaluation Report               ║');
    lines.push('╚══════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`Total Tasks:      ${metrics.totalTasks}`);
    lines.push(`Success Rate:     ${(metrics.successRate * 100).toFixed(1)}% ${metrics.successRate >= 0.9 ? '✅' : metrics.successRate >= 0.7 ? '⚠️' : '❌'}`);
    lines.push(`Avg Duration:     ${formatDuration(metrics.avgDuration)}`);
    lines.push(`P95 Duration:     ${formatDuration(metrics.p95Duration)}`);
    lines.push(`Avg Tokens Used:  ${metrics.avgTokens.toFixed(0)}`);
    lines.push(`Avg Cost (USD):   $${metrics.avgCost.toFixed(4)}`);

    if (Object.keys(metrics.byCategory).length > 0) {
      lines.push('');
      lines.push('── By Category ──────────────────────────────');
      for (const [cat, data] of Object.entries(metrics.byCategory)) {
        const bar = makeProgressBar(data.successRate, 20);
        lines.push(`  ${cat.padEnd(16)} ${bar} ${(data.successRate * 100).toFixed(0)}%  (${data.count} tasks, avg ${formatDuration(data.avgDuration)})`);
      }
    }

    lines.push('');
    lines.push('── Recommendations ──────────────────────────');
    if (metrics.successRate < 0.5) {
      lines.push('  🔴 Critical: <50% success rate. Review agent tooling and prompt design.');
    } else if (metrics.successRate < 0.7) {
      lines.push('  🟡 Warning: <70% success rate. Consider improving error handling.');
    } else if (metrics.successRate < 0.9) {
      lines.push('  🟢 Good: >70% success rate. Fine-tune for remaining edge cases.');
    } else {
      lines.push('  ✅ Excellent: >90% success rate.');
    }

    if (metrics.p95Duration > 120000) {
      lines.push('  ⏱️  P95 duration > 2 min. Consider optimizing slow paths.');
    }

    return lines.join('\n');
  }

  /**
   * Generate a machine-readable JSON evaluation report.
   */
  static generateJSONReport(metrics: AggregateMetrics): object {
    return {
      generated_at: new Date().toISOString(),
      summary: {
        total_tasks: metrics.totalTasks,
        success_rate: metrics.successRate,
        avg_duration_ms: metrics.avgDuration,
        p95_duration_ms: metrics.p95Duration,
        avg_tokens: metrics.avgTokens,
        avg_cost_usd: metrics.avgCost,
      },
      by_category: metrics.byCategory,
      rating: metrics.successRate >= 0.9
        ? 'excellent'
        : metrics.successRate >= 0.7
          ? 'good'
          : metrics.successRate >= 0.5
            ? 'needs_improvement'
            : 'critical',
    };
  }

  /**
   * Run a full benchmark, compute aggregate metrics, and return both
   * the detailed results and a formatted report.
   */
  async runFullBenchmark(
    runner: AgentRunner,
    opts?: {
      tasks?: BenchmarkTask[];
      saveReplays?: boolean;
    }
  ): Promise<{
    results: BenchmarkResult[];
    metrics: AggregateMetrics;
    report: string;
    jsonReport: object;
  }> {
    const tasks = opts?.tasks ?? AgentEvaluator.getBuiltinTasks();
    const results = await this.runBenchmark(tasks, runner, { saveReplays: opts?.saveReplays });
    const metrics = AgentEvaluator.calculateAggregateByCategory(
      results.map(r => r.metrics),
      tasks
    );
    const report = AgentEvaluator.generateReport(metrics);
    const jsonReport = AgentEvaluator.generateJSONReport(metrics);

    // Persist benchmark run in memory
    this.memory.save('session', `benchmark_${Date.now()}`, JSON.stringify(jsonReport), {
      tags: ['benchmark', 'aggregate'],
      importance: 6,
    });

    return { results, metrics, report, jsonReport };
  }
}

// ═════════════════════════════════════════════
// Utility functions
// ═════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function makeProgressBar(ratio: number, width: number): string {
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-]/g, '_');
}
