/**
 * Agent Evaluation Framework — CI/CD-ready eval runner.
 * [v0.8.0] Based on Mastra eval patterns: scorer pipeline + threshold gates.
 *
 * Usage:
 *   npx tsx evals/run-evals.ts
 *   # Exits with code 1 if any threshold is breached
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvalTestCase {
  id: string;
  input: string;
  expected: string;
  metadata?: Record<string, unknown>;
}

export interface EvalScore {
  name: string;
  score: number; // 0-1
  reason: string;
}

export interface EvalResult {
  testCase: EvalTestCase;
  scores: EvalScore[];
  latencyMs: number;
  passed: boolean;
}

export interface EvalReport {
  timestamp: string;
  results: EvalResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    avgScore: number;
    avgLatencyMs: number;
  };
  thresholds: Record<string, number>;
  thresholdBreaches: string[];
}

// ─── Scorers ─────────────────────────────────────────────────────────────────

type ScorerFn = (input: string, output: string, expected: string) => Promise<EvalScore>;

/** Keyword coverage scorer — checks how many expected keywords appear in output. */
export function keywordCoverageScorer(): ScorerFn {
  return async (input, output, expected) => {
    const keywords = expected.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const outputLower = output.toLowerCase();
    const matched = keywords.filter(kw => outputLower.includes(kw));
    const score = keywords.length > 0 ? matched.length / keywords.length : 1;
    return {
      name: 'keyword_coverage',
      score,
      reason: `Matched ${matched.length}/${keywords.length} keywords`,
    };
  };
}

/** Length reasonableness scorer — penalizes very short or very long outputs. */
export function lengthScorer(optimalMin = 50, optimalMax = 500): ScorerFn {
  return async (_input, output) => {
    const len = output.length;
    let score = 1;
    if (len < optimalMin) score = len / optimalMin;
    else if (len > optimalMax) score = Math.max(0, 1 - (len - optimalMax) / optimalMax);
    return {
      name: 'length',
      score: Math.max(0, Math.min(1, score)),
      reason: `Output length: ${len} chars (optimal: ${optimalMin}-${optimalMax})`,
    };
  };
}

/** LLM-as-judge scorer — uses an LLM to rate output quality. */
export function llmJudgeScorer(
  llmProvider: { complete: (messages: Array<{ role: string; content: string | null }>) => Promise<{ content: string | null }> }
): ScorerFn {
  return async (input, output, expected) => {
    try {
      const response = await llmProvider.complete([
        {
          role: 'system',
          content: `Rate the quality of an AI response on a scale of 0-100.
Criteria: accuracy, completeness, relevance, clarity.
Respond with ONLY a JSON: {"score": <number>, "reason": "<brief explanation>"}",`,
        },
        {
          role: 'user',
          content: `Question: ${input}\n\nExpected: ${expected}\n\nActual output: ${output}`,
        },
      ]);
      const parsed = JSON.parse(response.content || '{"score": 50, "reason": "parse error"}');
      return {
        name: 'llm_judge',
        score: Math.min(1, Math.max(0, (parsed.score || 50) / 100)),
        reason: parsed.reason || 'LLM judge evaluation',
      };
    } catch {
      return { name: 'llm_judge', score: 0.5, reason: 'LLM judge failed' };
    }
  };
}

/** Latency budget scorer — pass/fail if response exceeds budget. */
export function latencyScorer(budgetMs: number): ScorerFn {
  return async (_input, _output, _expected) => {
    // This scorer uses metadata — the latency is passed via the eval runner
    return { name: 'latency', score: 1, reason: `Budget: ${budgetMs}ms` };
  };
}

// ─── Eval Runner ─────────────────────────────────────────────────────────────

export class EvalRunner {
  private scorers: ScorerFn[] = [];
  private thresholds: Record<string, number> = {};

  addScorer(scorer: ScorerFn): this {
    this.scorers.push(scorer);
    return this;
  }

  setThreshold(scorerName: string, minScore: number): this {
    this.thresholds[scorerName] = minScore;
    return this;
  }

  async run(
    testCases: EvalTestCase[],
    agentFn: (input: string) => Promise<string>
  ): Promise<EvalReport> {
    const results: EvalResult[] = [];

    for (const tc of testCases) {
      const start = performance.now();
      let output: string;
      try {
        output = await agentFn(tc.input);
      } catch (err) {
        output = `ERROR: ${(err as Error).message}`;
      }
      const latencyMs = Math.round(performance.now() - start);

      const scores: EvalScore[] = [];
      for (const scorer of this.scorers) {
        scores.push(await scorer(tc.input, output, tc.expected));
      }

      // Override latency score with actual measurement
      const latencyThreshold = this.thresholds['latency'];
      if (latencyThreshold !== undefined) {
        const latencyScore = latencyMs <= latencyThreshold ? 1 : 0;
        scores.push({
          name: 'latency',
          score: latencyScore,
          reason: `${latencyMs}ms (budget: ${latencyThreshold}ms)`,
        });
      }

      const passed = scores.every(s => {
        const threshold = this.thresholds[s.name];
        return threshold === undefined || s.score >= threshold;
      });

      results.push({ testCase: tc, scores, latencyMs, passed });
    }

    // Build report
    const totalTests = results.length;
    const passedCount = results.filter(r => r.passed).length;
    const allScores = results.flatMap(r => r.scores.map(s => s.score));
    const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / totalTests;

    const thresholdBreaches: string[] = [];
    for (const [scorerName, minScore] of Object.entries(this.thresholds)) {
      const avgForScorer = results
        .flatMap(r => r.scores.filter(s => s.name === scorerName))
        .reduce((sum, s) => sum + s.score, 0) / totalTests;
      if (avgForScorer < minScore) {
        thresholdBreaches.push(
          `${scorerName}: avg ${(avgForScorer * 100).toFixed(1)}% < threshold ${(minScore * 100).toFixed(0)}%`
        );
      }
    }

    return {
      timestamp: new Date().toISOString(),
      results,
      summary: {
        totalTests,
        passed: passedCount,
        failed: totalTests - passedCount,
        avgScore: Math.round(avgScore * 1000) / 1000,
        avgLatencyMs: Math.round(avgLatency),
      },
      thresholds: this.thresholds,
      thresholdBreaches,
    };
  }
}
