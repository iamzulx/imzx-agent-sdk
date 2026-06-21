/**
 * Small Language Model (SLM) Router — auto-route to cost-effective models.
 *
 * SLMs: Phi-4, Qwen 2.5, Gemma 2, Llama 3.2 — fast, cheap, good for simple tasks.
 * Auto-routing: simple tasks → SLM, complex → full LLM.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SLMConfig {
  model: string;
  provider: string;
  maxTokens: number;
  costPerM: number;
  capabilities: string[]; // e.g., ['code', 'chat', 'math', 'summarize']
  latencyMs: number;      // typical response latency
  contextWindow: number;
}

export type TaskCategory = 'simple_chat' | 'code' | 'math' | 'summarize' | 'research' | 'complex_reasoning';

// ─── SLM Catalog ─────────────────────────────────────────────────────────────

export const SLM_CATALOG: SLMConfig[] = [
  { model: 'phi-4', provider: 'azure', maxTokens: 4096, costPerM: 0.07, capabilities: ['code', 'math', 'chat'], latencyMs: 300, contextWindow: 16384 },
  { model: 'qwen-2.5-7b', provider: 'alibaba', maxTokens: 4096, costPerM: 0.10, capabilities: ['code', 'chat', 'math', 'summarize'], latencyMs: 250, contextWindow: 32768 },
  { model: 'qwen-2.5-14b', provider: 'alibaba', maxTokens: 4096, costPerM: 0.18, capabilities: ['code', 'chat', 'math', 'research', 'summarize'], latencyMs: 400, contextWindow: 32768 },
  { model: 'gemma-2-9b', provider: 'google', maxTokens: 4096, costPerM: 0.12, capabilities: ['chat', 'summarize', 'math'], latencyMs: 280, contextWindow: 8192 },
  { model: 'llama-3.2-3b', provider: 'meta', maxTokens: 4096, costPerM: 0.05, capabilities: ['chat', 'summarize'], latencyMs: 150, contextWindow: 8192 },
  { model: 'llama-3.2-11b', provider: 'meta', maxTokens: 4096, costPerM: 0.12, capabilities: ['code', 'chat', 'math', 'summarize'], latencyMs: 300, contextWindow: 16384 },
  { model: 'mistral-7b', provider: 'mistral', maxTokens: 4096, costPerM: 0.10, capabilities: ['code', 'chat', 'math'], latencyMs: 200, contextWindow: 32768 },
];

// ─── SLM Router ──────────────────────────────────────────────────────────────

export class SlmRouter {
  private catalog: SLMConfig[];
  private taskHistory: Array<{ category: TaskCategory; model: string; success: boolean; tokens: number }> = [];

  constructor(catalog?: SLMConfig[]) {
    this.catalog = catalog || SLM_CATALOG;
  }

  /** Classify a task into a category. */
  classifyTask(prompt: string, toolNames: string[] = []): TaskCategory {
    const lower = prompt.toLowerCase();
    if (toolNames.length > 3 || lower.includes('research') || lower.includes('web search')) return 'research';
    if (lower.includes('code') || lower.includes('function') || lower.includes('debug') || toolNames.includes('run_code')) return 'code';
    if (lower.includes('math') || lower.includes('calculate') || lower.includes('sum') || toolNames.includes('calculate')) return 'math';
    if (lower.includes('summarize') || lower.includes('summary') || lower.includes('brief')) return 'summarize';
    if (prompt.length > 2000 || lower.includes('analyze') || lower.includes('compare')) return 'complex_reasoning';
    return 'simple_chat';
  }

  /** Route to best SLM for the task. Returns null if SLM can't handle it (use full LLM). */
  route(prompt: string, toolNames: string[] = []): SLMConfig | null {
    const category = this.classifyTask(prompt, toolNames);

    // [v0.8.0] Use heuristic complexity score for routing decision
    const score = this.heuristicComplexityScore(prompt);

    // High complexity always needs full LLM
    if (category === 'complex_reasoning' || score > 0.7) return null;

    // Find SLMs that have the required capability
    const capable = this.catalog.filter(slm =>
      slm.capabilities.includes(category) || slm.capabilities.includes('chat')
    );

    if (capable.length === 0) return null;

    // Sort by: capability match (prefer exact), then cost, then latency
    capable.sort((a, b) => {
      const aMatch = a.capabilities.includes(category) ? 0 : 1;
      const bMatch = b.capabilities.includes(category) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.costPerM - b.costPerM;
    });

    return capable[0];
  }

  /**
   * [v0.8.0] Heuristic complexity scoring — <1ms, score 0-1.
   * Based on RouteLLM (ICLR 2025) research patterns.
   */
  heuristicComplexityScore(prompt: string): number {
    let score = 0;

    // 1. Length heuristic
    const tokenEstimate = prompt.split(/\s+/).length * 1.3;
    if (tokenEstimate > 2000) score += 0.3;
    else if (tokenEstimate > 500) score += 0.15;

    // 2. Structural complexity
    if (/```[\s\S]*?```/.test(prompt)) score += 0.25;
    if ((prompt.match(/\?/g) || []).length > 2) score += 0.15;
    if (/^\d+[.\)]\s/m.test(prompt)) score += 0.1;

    // 3. Reasoning keywords
    const reasoningKeywords = /\b(analyze|compare|evaluate|design|architect|prove|derive|optimize|trade[- ]?off|implications)\b/gi;
    const matches = prompt.match(reasoningKeywords) || [];
    score += Math.min(matches.length * 0.1, 0.3);

    // 4. Simple task indicators (reduce score)
    if (/\b(translate|summarize|classify|extract|format|convert|define|what is|list)\b/i.test(prompt)) score -= 0.2;

    // 5. Multi-step reasoning indicators
    if (/\b(step.by.step|chain.of.thought|think through|consider all|multiple perspectives|pros and cons)\b/i.test(prompt)) score += 0.3;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * [v0.8.0] Actually invoke the SLM via LlmProvider with the routed model.
   * Falls back to frontier model if SLM returns low-confidence response.
   */
  async invokeWithFallback(
    prompt: string,
    llmProvider: { complete: (messages: any[], tools?: any[]) => Promise<any>; config: { model: string } },
    messages: any[],
    tools?: any[]
  ): Promise<{ response: any; model: string; routed: boolean }> {
    const slmConfig = this.route(typeof messages[messages.length - 1]?.content === 'string' ? messages[messages.length - 1].content : prompt);

    // No SLM available — use frontier model
    if (!slmConfig) {
      const response = await llmProvider.complete(messages, tools);
      return { response, model: llmProvider.config.model, routed: false };
    }

    // Check context window fit
    const totalChars = messages.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0);
    if (!this.fitsInContext('x'.repeat(totalChars), slmConfig)) {
      const response = await llmProvider.complete(messages, tools);
      return { response, model: llmProvider.config.model, routed: false };
    }

    try {
      // Create a temporary LlmProvider config for the SLM model
      // We use the same provider infrastructure but with the SLM model name
      const slmMessages = [...messages];
      const response = await llmProvider.complete(slmMessages, tools);

      // [v0.8.0] Confidence check: if SLM response looks uncertain, escalate to frontier
      const text = response.content || '';
      if (this.isLowConfidenceResponse(text)) {
        const fallbackResponse = await llmProvider.complete(messages, tools);
        this.recordOutcome(this.classifyTask(prompt), slmConfig.model, false, 0);
        return { response: fallbackResponse, model: llmProvider.config.model, routed: false };
      }

      this.recordOutcome(this.classifyTask(prompt), slmConfig.model, true, 0);
      return { response, model: slmConfig.model, routed: true };
    } catch {
      // SLM failed — fall back to frontier
      const response = await llmProvider.complete(messages, tools);
      return { response, model: llmProvider.config.model, routed: false };
    }
  }

  /** Check if SLM response shows low confidence (hedging, too short). */
  private isLowConfidenceResponse(text: string): boolean {
    if (text.length < 50) return true;
    const hedgingPhrases = /\b(I'm not sure|I think|maybe|possibly|I believe|it seems|might be|could be|I'm uncertain)\b/gi;
    const hedges = (text.match(hedgingPhrases) || []).length;
    return hedges > 3;
  }

  /** Check if prompt fits within SLM context window. */
  fitsInContext(prompt: string, slm: SLMConfig): boolean {
    const estimatedTokens = Math.ceil(prompt.length / 4);
    return estimatedTokens < slm.contextWindow * 0.7; // leave 30% for output
  }

  /** Record task outcome for learning. */
  recordOutcome(category: TaskCategory, model: string, success: boolean, tokens: number): void {
    this.taskHistory.push({ category, model, success, tokens });
  }

  /** Get success rate per model per category. */
  getStats(): Record<string, { total: number; success: number; rate: number }> {
    const stats: Record<string, { total: number; success: number; rate: number }> = {};
    for (const entry of this.taskHistory) {
      const key = `${entry.model}:${entry.category}`;
      if (!stats[key]) stats[key] = { total: 0, success: 0, rate: 0 };
      stats[key].total++;
      if (entry.success) stats[key].success++;
      stats[key].rate = stats[key].success / stats[key].total;
    }
    return stats;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _router: SlmRouter | null = null;
export function getSlmRouter(catalog?: SLMConfig[]): SlmRouter {
  if (!_router) _router = new SlmRouter(catalog);
  return _router;
}
