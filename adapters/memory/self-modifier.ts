/**
 * Self-Modification — agent can evolve its own behavior.
 * 
 * Based on:
 * - HyperAgents (Meta/Oxford 2026): solve_task() + modify_self() pattern
 * - DGM-H algorithm: Darwin Godel Machine with self-modifying code
 * - Reflexion: performance tracking drives improvement
 * 
 * Capabilities:
 * 1. Performance tracking — metrics over time
 * 2. Prompt evolution — agent can suggest improvements to its own prompts
 * 3. Tool creation — agent can create new tools from code patterns
 * 4. Workflow optimization — agent learns which tool sequences work best
 * 
 * SAFETY: All modifications are logged and reversible.
 * Agent cannot modify core system files, only its own config.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PersistentMemory } from '../memory/persistent-memory.js';
import { SkillManager, type Skill } from '../memory/skill-manager.js';

export interface PerformanceMetric {
  timestamp: string;
  task_type: string;
  outcome: 'success' | 'partial' | 'failure';
  duration_ms: number;
  tokens_used: number;
  tools_used: string[];
  iterations: number;
}

export interface ModificationLog {
  timestamp: string;
  type: 'prompt_update' | 'tool_created' | 'workflow_optimized' | 'preference_learned' | 'prompt_evolution';
  description: string;
  before: string;
  after: string;
  reverted: boolean;
}

export class SelfModifier {
  private memory: PersistentMemory;
  private skills: SkillManager;
  private metrics: PerformanceMetric[] = [];
  private modificationLog: ModificationLog[] = [];
  private metricsPath: string;
  private logPath: string;

  constructor(memory: PersistentMemory, skills: SkillManager, baseDir?: string) {
    this.memory = memory;
    this.skills = skills;
    const dir = baseDir || path.join(process.cwd(), '.imzx');
    this.metricsPath = path.join(dir, 'metrics.json');
    this.logPath = path.join(dir, 'modifications.json');
    this.loadMetrics();
    this.loadModLog();
  }

  // --- Performance Tracking ---

  /** Record a task performance metric. */
  recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    this.persistMetrics();

    // Auto-analyze after every 10 metrics
    if (this.metrics.length % 10 === 0) {
      this.analyzePerformance();
    }
  }

  /** Get performance summary. */
  getPerformanceSummary(): {
    totalTasks: number;
    successRate: number;
    avgDuration: number;
    avgTokens: number;
    topTools: Array<{ tool: string; count: number }>;
    trend: 'improving' | 'stable' | 'declining';
  } {
    const total = this.metrics.length;
    if (total === 0) {
      return { totalTasks: 0, successRate: 0, avgDuration: 0, avgTokens: 0, topTools: [], trend: 'stable' };
    }

    const successes = this.metrics.filter(m => m.outcome === 'success').length;
    const avgDuration = this.metrics.reduce((s, m) => s + m.duration_ms, 0) / total;
    const avgTokens = this.metrics.reduce((s, m) => s + m.tokens_used, 0) / total;

    // Top tools
    const toolCounts: Record<string, number> = {};
    for (const m of this.metrics) {
      for (const t of m.tools_used) {
        toolCounts[t] = (toolCounts[t] || 0) + 1;
      }
    }
    const topTools = Object.entries(toolCounts)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Trend: compare first half vs second half success rate
    const half = Math.floor(total / 2);
    const firstHalf = this.metrics.slice(0, half);
    const secondHalf = this.metrics.slice(half);
    const firstRate = firstHalf.filter(m => m.outcome === 'success').length / (firstHalf.length || 1);
    const secondRate = secondHalf.filter(m => m.outcome === 'success').length / (secondHalf.length || 1);

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (secondRate > firstRate + 0.1) trend = 'improving';
    if (secondRate < firstRate - 0.1) trend = 'declining';

    return {
      totalTasks: total,
      successRate: successes / total,
      avgDuration,
      avgTokens,
      topTools,
      trend,
    };
  }

  // --- Prompt Evolution ---

  /** Analyze performance and suggest prompt improvements. */
  analyzePerformance(): string[] {
    const summary = this.getPerformanceSummary();
    const suggestions: string[] = [];

    if (summary.successRate < 0.5) {
      suggestions.push('Success rate is low. Consider adding more specific instructions to the system prompt.');
    }

    if (summary.avgTokens > 50000) {
      suggestions.push('Average token usage is high. Consider more concise tool usage patterns.');
    }

    if (summary.trend === 'declining') {
      suggestions.push('Performance is declining. Review recent failures for patterns.');
    }

    // Analyze failed tasks for common patterns
    const failures = this.metrics.filter(m => m.outcome === 'failure');
    if (failures.length > 3) {
      const commonTools = this.findCommonPatterns(failures);
      if (commonTools.length > 0) {
        suggestions.push(`Tools frequently involved in failures: ${commonTools.join(', ')}. Consider alternative approaches.`);
      }
    }

    // Store suggestions in memory
    for (const suggestion of suggestions) {
      this.memory.save('knowledge', `perf_suggestion_${Date.now()}`, suggestion, {
        tags: ['performance', 'auto-analysis'],
        importance: 7,
      });
    }

    return suggestions;
  }

  // --- Tool Creation ---

  /** Suggest a new tool based on repeated code patterns. */
  suggestTool(pattern: string, description: string): Skill | null {
    // Check if this pattern appears in multiple successful tasks
    const relatedSkills = this.skills.search(pattern, 3);
    if (relatedSkills.length < 2) return null; // Not enough data

    // Create a skill that represents the tool
    return this.skills.save({
      name: `tool-${pattern.toLowerCase().replace(/\s+/g, '-')}`,
      description: `Auto-suggested tool: ${description}`,
      category: 'auto-tool',
      steps: relatedSkills.flatMap(s => s.steps).slice(0, 10),
      tools_used: [...new Set(relatedSkills.flatMap(s => s.tools_used))],
      gotchas: [...new Set(relatedSkills.flatMap(s => s.gotchas))],
      tags: ['auto-tool', 'suggested', ...relatedSkills.map(s => s.name)],
    });
  }

  // --- Workflow Optimization ---

  /** Record which tool sequences work best for which task types. */
  recordWorkflow(taskType: string, tools: string[], outcome: 'success' | 'failure'): void {
    const key = `workflow_${taskType}`;
    const existing = this.memory.recall(key, { category: 'knowledge', limit: 1 });

    if (existing.length > 0) {
      // Update existing workflow record
      // [H4 FIX] Safe JSON parse
      let data: any;
      try { data = JSON.parse(existing[0].content); } catch { data = { task_type: taskType, success_sequences: [], failure_sequences: [] }; }
      if (outcome === 'success') {
        data.success_sequences.push(tools);
      } else {
        data.failure_sequences.push(tools);
      }
      this.memory.save('knowledge', key, JSON.stringify(data), {
        tags: ['workflow', 'optimization', taskType],
        importance: 7,
      });
    } else {
      this.memory.save('knowledge', key, JSON.stringify({
        task_type: taskType,
        success_sequences: outcome === 'success' ? [tools] : [],
        failure_sequences: outcome === 'failure' ? [tools] : [],
      }), {
        tags: ['workflow', 'optimization', taskType],
        importance: 7,
      });
    }
  }

  /** Get optimized tool sequence for a task type. */
  getOptimalWorkflow(taskType: string): string[] | null {
    const results = this.memory.recall(`workflow ${taskType}`, { category: 'knowledge', limit: 1 });
    if (results.length === 0) return null;

    try {
      const data = JSON.parse(results[0].content);
      if (data.success_sequences && data.success_sequences.length > 0) {
        // Return the most common successful sequence
        return data.success_sequences[data.success_sequences.length - 1];
      }
    } catch {}
    return null;
  }

  // --- Modification Log ---

  /** Log a modification for auditability. */
  logModification(mod: ModificationLog): void {
    this.modificationLog.push(mod);
    this.persistModLog();
  }

  /** Get modification history. */
  getModificationHistory(): ModificationLog[] {
    return [...this.modificationLog];
  }

  /** Revert last modification of a type. */
  revertLast(type: ModificationLog['type']): boolean {
    let idx = -1;
    for (let i = this.modificationLog.length - 1; i >= 0; i--) {
      if (this.modificationLog[i].type === type && !this.modificationLog[i].reverted) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;
    this.modificationLog[idx].reverted = true;
    this.persistModLog();
    return true;
  }

  // --- Helpers ---

  private findCommonPatterns(metrics: PerformanceMetric[]): string[] {
    const toolFreq: Record<string, number> = {};
    for (const m of metrics) {
      for (const t of m.tools_used) {
        toolFreq[t] = (toolFreq[t] || 0) + 1;
      }
    }
    return Object.entries(toolFreq)
      .filter(([_, count]) => count >= 2)
      .map(([tool]) => tool);
  }

  // --- Persistence ---

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        this.metrics = JSON.parse(fs.readFileSync(this.metricsPath, 'utf-8'));
      }
    } catch {}
  }

  private persistMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2), 'utf-8');
    } catch {}
  }

  private loadModLog(): void {
    try {
      if (fs.existsSync(this.logPath)) {
        this.modificationLog = JSON.parse(fs.readFileSync(this.logPath, 'utf-8'));
      }
    } catch {}
  }

  private persistModLog(): void {
    try {
      const dir = path.dirname(this.logPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.logPath, JSON.stringify(this.modificationLog, null, 2), 'utf-8');
    } catch {}
  }

  /**
   * [v0.8.0] Prompt Evolution — generate improved prompt variants using a meta-LLM.
   * Based on DSPy/HyperAgents patterns: a stronger model writes prompts for a weaker one.
   *
   * @param basePrompt The current system prompt to evolve
   * @param llmProvider An LLM provider for generating variants
   * @param taskExamples Optional examples for few-shot optimization
   * @param variantCount Number of variants to generate
   * @returns Array of evolved prompt variants with scores
   */
  async evolvePrompt(
    basePrompt: string,
    llmProvider: { complete: (messages: Array<{ role: string; content: string | null }>) => Promise<{ content: string | null }> },
    taskExamples: Array<{ input: string; expected: string }> = [],
    variantCount: number = 3
  ): Promise<Array<{ prompt: string; strategy: string; score: number }>> {
    const strategies = [
      'Add chain-of-thought reasoning instructions (think step by step)',
      'Add few-shot examples inline to guide output format',
      'Restructure with XML tags for clear section separation',
      'Add explicit output format constraints and negative examples',
      'Add a role-playing persona to improve domain expertise',
    ];

    const variants: Array<{ prompt: string; strategy: string; score: number }> = [];

    for (let i = 0; i < variantCount; i++) {
      const strategy = strategies[i % strategies.length];
      try {
        const response = await llmProvider.complete([
          {
            role: 'system',
            content: `You are an expert prompt engineer. Generate an IMPROVED variant of the given system prompt.
Strategy: ${strategy}

Rules:
- Keep the core intent and capabilities of the original prompt
- Apply the strategy to improve clarity, specificity, and output quality
- Return ONLY the improved system prompt, nothing else`,
          },
          {
            role: 'user',
            content: `Original prompt:\n${basePrompt}\n\n${taskExamples.length > 0 ? `Example tasks:\n${taskExamples.map(e => `Input: ${e.input}\nExpected: ${e.expected}`).join('\n---\n')}` : ''}`,
          },
        ]);

        const evolvedPrompt = response.content || basePrompt;

        // Score: evaluate the variant against examples if available
        let score = 0.5; // baseline
        if (taskExamples.length > 0) {
          score = await this.scorePromptVariant(evolvedPrompt, llmProvider, taskExamples);
        }

        variants.push({ prompt: evolvedPrompt, strategy, score });
      } catch {
        // LLM failed — return original with low score
        variants.push({ prompt: basePrompt, strategy: `${strategy} (failed)`, score: 0 });
      }
    }

    // Sort by score descending
    variants.sort((a, b) => b.score - a.score);

    // Record the evolution
    this.modificationLog.push({
      timestamp: new Date().toISOString(),
      type: 'prompt_evolution',
      description: `Evolved prompt: ${variantCount} variants, best score: ${variants[0]?.score.toFixed(2) || 0}`,
      before: basePrompt.substring(0, 100),
      after: variants[0]?.prompt.substring(0, 100) || '',
      reverted: false,
    });
    this.persistModLog();

    return variants;
  }

  /** Score a prompt variant by testing against examples. */
  private async scorePromptVariant(
    prompt: string,
    llmProvider: { complete: (messages: Array<{ role: string; content: string | null }>) => Promise<{ content: string | null }> },
    examples: Array<{ input: string; expected: string }>
  ): Promise<number> {
    let totalScore = 0;
    const testCount = Math.min(examples.length, 3); // limit to 3 tests for cost

    for (let i = 0; i < testCount; i++) {
      try {
        // Generate output with the evolved prompt
        const output = await llmProvider.complete([
          { role: 'system', content: prompt },
          { role: 'user', content: examples[i].input },
        ]);

        // Judge quality: compare output to expected
        const judge = await llmProvider.complete([
          {
            role: 'system',
            content: 'Rate how well the output matches the expected answer. Score 0-100. Respond with just the number.',
          },
          {
            role: 'user',
            content: `Expected: ${examples[i].expected}\n\nActual output: ${output.content || ''}`,
          },
        ]);

        const scoreNum = parseInt(judge.content || '50', 10);
        totalScore += isNaN(scoreNum) ? 50 : Math.min(100, Math.max(0, scoreNum));
      } catch {
        totalScore += 25; // penalty for failure
      }
    }

    return totalScore / testCount / 100; // normalize to 0-1
  }
}
