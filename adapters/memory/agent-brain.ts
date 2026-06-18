/**
 * AgentBrain — central coordinator for self-improving agent intelligence.
 *
 * Integrates:
 * - PersistentMemory (v0.5.0) — cross-session memory
 * - ReflectionEngine (v0.6.0) — self-reflection after tasks
 * - SkillManager (v0.7.0) — save/load/search skills
 * - SelfModifier (v0.8.0) — performance tracking, prompt evolution
 * - KnowledgeGraph (v0.5.0) — entity-relationship memory
 */

import { PersistentMemory } from './persistent-memory.js';
import { ReflectionEngine } from './reflection-engine.js';
import { SkillManager } from './skill-manager.js';
import { SelfModifier, type PerformanceMetric } from './self-modifier.js';
import { KnowledgeGraph } from './knowledge-graph.js';

export class AgentBrain {
  public memory: PersistentMemory;
  public reflection: ReflectionEngine;
  public skills: SkillManager;
  public modifier: SelfModifier;
  public graph: KnowledgeGraph;

  private taskStartTime: number = 0;
  private taskToolsUsed: string[] = [];

  constructor(baseDir?: string) {
    this.memory = new PersistentMemory(baseDir);
    this.reflection = new ReflectionEngine(this.memory);
    this.skills = new SkillManager(baseDir);
    this.modifier = new SelfModifier(this.memory, this.skills, baseDir);
    this.graph = new KnowledgeGraph();
  }

  // --- Task Lifecycle ---

  onTaskStart(): void {
    this.taskStartTime = Date.now();
    this.taskToolsUsed = [];
    this.reflection.startTask();
  }

  onToolUse(toolName: string): void {
    this.taskToolsUsed.push(toolName);
    this.reflection.recordToolUse(toolName);
  }

  onTokensUsed(count: number): void {
    this.reflection.recordTokens(count);
  }

  onTaskEnd(userPrompt: string, agentResponse: string, outcome: 'success' | 'partial' | 'failure'): void {
    const duration = Date.now() - this.taskStartTime;

    // 1. Generate reflection
    this.reflection.endTask(userPrompt, agentResponse, outcome);

    // 2. Record performance metric
    this.modifier.recordMetric({
      timestamp: new Date().toISOString(),
      task_type: this.classifyTask(userPrompt),
      outcome,
      duration_ms: duration,
      tokens_used: this.taskToolsUsed.length * 1000,
      tools_used: [...new Set(this.taskToolsUsed)],
      iterations: this.taskToolsUsed.length,
    });

    // 3. Auto-detect user preferences
    this.memory.detectPreferences(userPrompt);

    // 4. Record workflow for optimization
    const taskType = this.classifyTask(userPrompt);
    this.modifier.recordWorkflow(taskType, [...new Set(this.taskToolsUsed)], outcome === 'failure' ? 'failure' : 'success');

    // 5. Auto-extract skill from successful multi-tool tasks
    if (outcome === 'success' && this.taskToolsUsed.length >= 2) {
      this.skills.extractFromTask(
        userPrompt.substring(0, 200),
        [...new Set(this.taskToolsUsed)],
        [`Used tools: ${[...new Set(this.taskToolsUsed)].join(' -> ')}`],
      );
    }
  }

  // --- Context Building ---

  buildEnhancedPrompt(basePrompt: string, userQuery?: string): string {
    let prompt = basePrompt;

    // Layer 1: Persistent memory
    const memoryContext = this.memory.formatForPrompt(userQuery);
    if (memoryContext) prompt += memoryContext;

    // Layer 2: Self-reflection
    const reflectionContext = this.reflection.formatForPrompt();
    if (reflectionContext) prompt += reflectionContext;

    // Layer 3: Relevant skills
    if (userQuery) {
      const skillContext = this.skills.formatForPrompt(userQuery);
      if (skillContext) prompt += skillContext;
    }

    // Layer 4: Knowledge graph
    const graphContext = this.graph.formatForPrompt(userQuery);
    if (graphContext) prompt += graphContext;

    // Layer 5: Performance insights
    const summary = this.modifier.getPerformanceSummary();
    if (summary.totalTasks > 0) {
      const trend = summary.trend === 'improving' ? 'improving' :
                    summary.trend === 'declining' ? 'declining' : 'stable';
      prompt += `\n\n## Performance Context:\n- Success rate: ${Math.round(summary.successRate * 100)}% (${summary.totalTasks} tasks)\n- Trend: ${trend}\n- Top tools: ${summary.topTools.map(t => t.tool).join(', ')}`;
    }

    return prompt;
  }

  // --- User Interaction ---

  processUserMessage(message: string): {
    isCorrection: boolean;
    preferencesDetected: boolean;
  } {
    const isCorrection = this.memory.detectCorrection(message);
    const before = this.memory.stats().total;
    this.memory.detectPreferences(message);
    const after = this.memory.stats().total;

    // Process message for knowledge graph
    this.graph.processMessage(message);

    return {
      isCorrection,
      preferencesDetected: after > before,
    };
  }

  // --- Stats ---

  getStats(): {
    memory: ReturnType<PersistentMemory['stats']>;
    skills: number;
    performance: ReturnType<SelfModifier['getPerformanceSummary']>;
    reflections: number;
    graph: ReturnType<KnowledgeGraph['stats']>;
  } {
    return {
      memory: this.memory.stats(),
      skills: this.skills.list().length,
      performance: this.modifier.getPerformanceSummary(),
      reflections: this.memory.getByCategory('session').filter(e => e.key.startsWith('reflection_')).length,
      graph: this.graph.stats(),
    };
  }

  // --- Helpers ---

  private classifyTask(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes('code') || lower.includes('function') || lower.includes('debug')) return 'coding';
    if (lower.includes('search') || lower.includes('find') || lower.includes('research')) return 'research';
    if (lower.includes('file') || lower.includes('read') || lower.includes('write')) return 'file-ops';
    if (lower.includes('explain') || lower.includes('what is') || lower.includes('how')) return 'knowledge';
    if (lower.includes('create') || lower.includes('build') || lower.includes('make')) return 'creation';
    return 'general';
  }
}
