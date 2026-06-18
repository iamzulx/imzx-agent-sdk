/**
 * AgentEvaluator — 3-level evaluation system for agent task performance.
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
 * Generates improvement suggestions and tracks trends over time.
 */

import { PersistentMemory } from './persistent-memory.js';
import { KnowledgeGraph } from './knowledge-graph.js';

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

export class AgentEvaluator {
  private memory: PersistentMemory;
  private graph: KnowledgeGraph;

  constructor(memory: PersistentMemory, graph: KnowledgeGraph) {
    this.memory = memory;
    this.graph = graph;
  }

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
}
