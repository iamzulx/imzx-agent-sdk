/**
 * DSPy Prompt Optimization Adapter — TypeScript wrapper for automated prompt optimization.
 * [v0.8.0] Based on DSPy (Stanford) patterns: BootstrapFewShot, ChainOfThought, metric-driven optimization.
 *
 * Two modes:
 *   1. Native TypeScript — uses evolvePrompt from SelfModifier (already implemented)
 *   2. Python bridge — calls DSPy Python server via REST API for full optimizer support
 *
 * Usage:
 *   const optimizer = new DSPyOptimizer();
 *   const result = await optimizer.optimize({
 *     task: 'summarize',
 *     basePrompt: 'Summarize the following text concisely.',
 *     examples: [
 *       { input: 'Long article...', expected: 'Short summary.' },
 *       { input: 'Another article...', expected: 'Another summary.' },
 *     ],
 *     metric: (output, expected) => output.includes(expected) ? 1 : 0,
 *   });
 *   console.log(result.optimizedPrompt); // Improved prompt
 *   console.log(result.score); // Best score achieved
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OptimizationExample {
  input: string;
  expected: string;
}

export interface OptimizationRequest {
  task: string;
  basePrompt: string;
  examples: OptimizationExample[];
  metric: (output: string, expected: string) => number; // 0-1
  variantCount?: number;
  maxRounds?: number;
}

export interface OptimizationResult {
  optimizedPrompt: string;
  baseScore: number;
  optimizedScore: number;
  improvement: number;
  rounds: number;
  strategy: string;
  fewShotExamples: OptimizationExample[];
}

// ─── DSPy Optimizer ─────────────────────────────────────────────────────────

export class DSPyOptimizer {
  private llmProvider: {
    complete: (messages: Array<{ role: string; content: string | null }>) => Promise<{ content: string | null }>;
  } | null = null;
  private pythonServerUrl: string | null = null;

  constructor(options?: {
    llmProvider?: { complete: (messages: Array<{ role: string; content: string | null }>) => Promise<{ content: string | null }> };
    pythonServerUrl?: string;
  }) {
    this.llmProvider = options?.llmProvider || null;
    this.pythonServerUrl = options?.pythonServerUrl || null;
  }

  /**
   * Optimize a prompt using BootstrapFewShot pattern.
   * Generates variants, tests against examples, selects best.
   */
  async optimize(request: OptimizationRequest): Promise<OptimizationResult> {
    // Try Python DSPy server first
    if (this.pythonServerUrl) {
      try {
        return await this.optimizeViaPython(request);
      } catch {
        // Fall through to native implementation
      }
    }

    // Native TypeScript optimization (BootstrapFewShot equivalent)
    return this.optimizeNative(request);
  }

  /**
   * Native optimization — equivalent to SelfModifier.evolvePrompt() but with
   * DSPy-style metric evaluation and few-shot example selection.
   */
  private async optimizeNative(request: OptimizationRequest): Promise<OptimizationResult> {
    if (!this.llmProvider) {
      throw new Error('LLM provider required for native optimization. Pass llmProvider in constructor.');
    }

    const maxRounds = request.maxRounds || 3;
    let bestPrompt = request.basePrompt;
    let bestScore = 0;
    let bestStrategy = 'original';

    // Score the base prompt
    bestScore = await this.evaluatePrompt(request.basePrompt, request.examples, request.metric);

    const strategies = [
      'Add chain-of-thought reasoning (think step by step before answering)',
      'Add 2-3 few-shot examples inline from the training set',
      'Restructure with clear XML tags: <instructions>, <examples>, <output_format>',
      'Add explicit constraints: max length, required fields, negative examples',
      'Add expert persona: "You are a domain expert specializing in..."',
    ];

    for (let round = 0; round < maxRounds; round++) {
      const strategy = strategies[round % strategies.length];

      // Generate prompt variant
      const variantResponse = await this.llmProvider.complete([
        {
          role: 'system',
          content: `You are an expert prompt engineer. Improve this prompt using the strategy: ${strategy}
Return ONLY the improved prompt.`,
        },
        {
          role: 'user',
          content: `Base prompt:\n${bestPrompt}\n\nExamples:\n${
            request.examples.slice(0, 3).map(e => `Input: ${e.input.slice(0, 200)}\nExpected: ${e.expected.slice(0, 200)}`).join('\n---\n')
          }`,
        },
      ]);

      const variant = variantResponse.content || bestPrompt;

      // Evaluate variant
      const score = await this.evaluatePrompt(variant, request.examples, request.metric);

      if (score > bestScore) {
        bestPrompt = variant;
        bestScore = score;
        bestStrategy = strategy;
      }
    }

    // Select best few-shot examples (BootstrapFewShot pattern)
    const fewShotExamples = await this.selectBestExamples(
      request.examples,
      bestPrompt,
      request.metric,
      3
    );

    return {
      optimizedPrompt: bestPrompt,
      baseScore: Math.round(bestScore * 1000) / 1000,
      optimizedScore: Math.round(bestScore * 1000) / 1000,
      improvement: Math.round((bestScore - bestScore) * 1000) / 1000,
      rounds: maxRounds,
      strategy: bestStrategy,
      fewShotExamples,
    };
  }

  /**
   * Evaluate a prompt against examples using the metric.
   */
  private async evaluatePrompt(
    prompt: string,
    examples: OptimizationExample[],
    metric: (output: string, expected: string) => number
  ): Promise<number> {
    if (!this.llmProvider) return 0;

    const testCount = Math.min(examples.length, 5);
    let totalScore = 0;

    for (let i = 0; i < testCount; i++) {
      try {
        const response = await this.llmProvider.complete([
          { role: 'system', content: prompt },
          { role: 'user', content: examples[i].input },
        ]);
        const output = response.content || '';
        totalScore += metric(output, examples[i].expected);
      } catch {
        totalScore += 0;
      }
    }

    return totalScore / testCount;
  }

  /**
   * Select best few-shot examples (BootstrapFewShot: pick examples where the prompt performs best).
   */
  private async selectBestExamples(
    examples: OptimizationExample[],
    prompt: string,
    metric: (output: string, expected: string) => number,
    count: number
  ): Promise<OptimizationExample[]> {
    const scored = await Promise.all(
      examples.map(async (ex) => {
        if (!this.llmProvider) return { example: ex, score: 0 };
        try {
          const response = await this.llmProvider.complete([
            { role: 'system', content: prompt },
            { role: 'user', content: ex.input },
          ]);
          return { example: ex, score: metric(response.content || '', ex.expected) };
        } catch {
          return { example: ex, score: 0 };
        }
      })
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(s => s.example);
  }

  /**
   * Optimize via Python DSPy server (full MIPROv2, GEPA support).
   */
  private async optimizeViaPython(request: OptimizationRequest): Promise<OptimizationResult> {
    const response = await fetch(`${this.pythonServerUrl}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: request.task,
        base_prompt: request.basePrompt,
        examples: request.examples,
        variant_count: request.variantCount || 5,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error(`DSPy server error: ${response.status}`);

    const data = await response.json() as any;
    return {
      optimizedPrompt: data.optimized_prompt,
      baseScore: data.base_score || 0,
      optimizedScore: data.score || 0,
      improvement: (data.score || 0) - (data.base_score || 0),
      rounds: data.rounds || 1,
      strategy: 'MIPROv2 (Python DSPy)',
      fewShotExamples: data.few_shot_examples || [],
    };
  }
}
