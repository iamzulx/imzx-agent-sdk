/**
 * Cost-Aware Planning — estimate costs before execution, route to optimal model.
 *
 * Features:
 * - Per-token cost estimation for 8+ models
 * - Task cost estimation (prompt + tool calls)
 * - Model comparison (cheapest that fits budget)
 * - Auto-routing: simple tasks → cheap model, complex → capable
 * - Integration with telemetry for cost tracking
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelPricing {
  model: string;
  inputPerM: number;   // cost per 1M input tokens (USD)
  outputPerM: number;  // cost per 1M output tokens (USD)
  cachedInputPerM?: number;
}

export interface TaskCostEstimate {
  promptTokens: number;
  toolCallTokens: number;
  estimatedTotalTokens: number;
  costUsd: number;
  breakdown: Array<{ step: string; tokens: number; cost: number }>;
  recommendedModel?: string;
}

export interface ModelComparison {
  model: string;
  costUsd: number;
  tokens: number;
  tier: 'cheap' | 'mid' | 'capable';
}

// ─── Pricing Database ────────────────────────────────────────────────────────

const DEFAULT_PRICING: ModelPricing[] = [
  { model: 'anthropic/claude-sonnet-4', inputPerM: 3, outputPerM: 15 },
  { model: 'anthropic/claude-opus-4', inputPerM: 15, outputPerM: 75 },
  { model: 'openai/gpt-4o', inputPerM: 2.5, outputPerM: 10 },
  { model: 'openai/gpt-4o-mini', inputPerM: 0.15, outputPerM: 0.6 },
  { model: 'meta-llama/Llama-3.3-70B', inputPerM: 0.88, outputPerM: 0.88 },
  { model: 'google/gemini-2.5-pro', inputPerM: 1.25, outputPerM: 10 },
  { model: 'mistralai/mistral-large', inputPerM: 2, outputPerM: 6 },
  { model: 'llama-3.3-70b-versatile', inputPerM: 0.59, outputPerM: 0.79 }, // Groq
  { model: 'phi-4', inputPerM: 0.07, outputPerM: 0.28 },  // Azure SLM
  { model: 'qwen-2.5-72b', inputPerM: 0.35, outputPerM: 1.05 },
  { model: 'default', inputPerM: 3, outputPerM: 15 },
];

// ─── Cost Estimator ──────────────────────────────────────────────────────────

export class CostEstimator {
  private pricing: ModelPricing[];

  constructor(pricing?: ModelPricing[]) {
    this.pricing = pricing || DEFAULT_PRICING;
  }

  /** Estimate cost for a prompt. */
  estimatePrompt(prompt: string, model?: string): { inputTokens: number; estimatedOutputTokens: number; costUsd: number } {
    const inputTokens = Math.ceil(prompt.length / 4);
    const estimatedOutputTokens = Math.max(500, Math.ceil(inputTokens * 0.5)); // conservative: 50% of input
    const p = this.getPricing(model);
    const costUsd = (inputTokens * p.inputPerM + estimatedOutputTokens * p.outputPerM) / 1_000_000;
    return { inputTokens, estimatedOutputTokens, costUsd };
  }

  /** Estimate cost for a single tool call. */
  estimateToolCall(toolName: string, args: Record<string, unknown>): { estimatedTokens: number; estimatedCostUsd: number } {
    const argSize = JSON.stringify(args).length;
    const toolOverhead = 500; // tool result formatting overhead
    const estimatedTokens = Math.ceil(argSize / 4) + toolOverhead;
    const p = this.getPricing(); // default model
    const estimatedCostUsd = (estimatedTokens * 2 * p.inputPerM) / 1_000_000; // 2x for input + output
    return { estimatedTokens, estimatedCostUsd };
  }

  /** Estimate total task cost (prompt + expected tool calls). */
  estimateTask(prompt: string, expectedToolCalls: Array<{ name: string; args: Record<string, unknown> }>, model?: string): TaskCostEstimate {
    const promptEst = this.estimatePrompt(prompt, model);
    const toolEstimates = expectedToolCalls.map(tc => ({
      step: `tool:${tc.name}`,
      ...this.estimateToolCall(tc.name, tc.args),
    }));

    const toolCallTokens = toolEstimates.reduce((s, t) => s + t.estimatedTokens, 0);
    const toolCallCost = toolEstimates.reduce((s, t) => s + t.estimatedCostUsd, 0);

    const breakdown = [
      { step: 'prompt', tokens: promptEst.inputTokens, cost: (promptEst.inputTokens * this.getPricing(model).inputPerM) / 1_000_000 },
      { step: 'llm_output', tokens: promptEst.estimatedOutputTokens, cost: (promptEst.estimatedOutputTokens * this.getPricing(model).outputPerM) / 1_000_000 },
      ...toolEstimates.map(t => ({ step: t.step, tokens: t.estimatedTokens, cost: t.estimatedCostUsd })),
    ];

    return {
      promptTokens: promptEst.inputTokens,
      toolCallTokens,
      estimatedTotalTokens: promptEst.inputTokens + promptEst.estimatedOutputTokens + toolCallTokens,
      costUsd: breakdown.reduce((s, b) => s + b.cost, 0),
      breakdown,
    };
  }

  /** Compare costs across models for the same prompt. */
  compareModels(prompt: string): ModelComparison[] {
    const results: ModelComparison[] = [];
    const seen = new Set<string>();

    for (const p of this.pricing) {
      if (p.model === 'default' || seen.has(p.model)) continue;
      seen.add(p.model);
      const est = this.estimatePrompt(prompt, p.model);
      const tier = p.inputPerM < 1 ? 'cheap' : p.inputPerM < 5 ? 'mid' : 'capable';
      results.push({
        model: p.model,
        costUsd: est.costUsd,
        tokens: est.inputTokens + est.estimatedOutputTokens,
        tier,
      });
    }

    return results.sort((a, b) => a.costUsd - b.costUsd);
  }

  /** Recommend cheapest model that fits within budget. */
  recommendModel(prompt: string, budgetUsd: number): string {
    const comparisons = this.compareModels(prompt);
    const fits = comparisons.filter(c => c.costUsd <= budgetUsd);
    return fits[0]?.model || comparisons[0]?.model || 'default';
  }

  /** Score task complexity for auto-routing. */
  scoreComplexity(prompt: string, toolCount: number, hasCode: boolean): number {
    let score = 0;
    score += Math.min(prompt.length / 10, 500); // prompt length, capped at 500
    score += toolCount * 100;
    if (hasCode) score += 200;
    if (prompt.length > 2000) score += 300; // long context
    return score;
  }

  /** Auto-route to model based on complexity. */
  autoRouteModel(prompt: string, toolCount: number = 0, hasCode: boolean = false): string {
    const score = this.scoreComplexity(prompt, toolCount, hasCode);
    if (score < 500) return 'openai/gpt-4o-mini';      // cheap: simple tasks
    if (score < 2000) return 'anthropic/claude-sonnet-4'; // mid: standard tasks
    return 'anthropic/claude-opus-4';                      // capable: complex tasks
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private getPricing(model?: string): ModelPricing {
    if (!model) return this.pricing.find(p => p.model === 'default')!;
    const found = this.pricing.find(p => model.includes(p.model) || p.model.includes(model));
    return found || this.pricing.find(p => p.model === 'default')!;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _estimator: CostEstimator | null = null;
export function getCostEstimator(pricing?: ModelPricing[]): CostEstimator {
  if (!_estimator) _estimator = new CostEstimator(pricing);
  return _estimator;
}
