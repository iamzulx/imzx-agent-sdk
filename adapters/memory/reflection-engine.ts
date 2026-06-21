/**
 * Self-Reflection — agent evaluates its own performance after tasks.
 * 
 * Based on:
 * - Reflexion (Princeton/MIT 2023): verbal self-reflection in persistent memory
 * - Stanford CS329A: metacognitive knowledge, planning, evaluation
 * - HyperAgents (Meta/Oxford 2026): self-modifying code with evaluate + iterate
 * 
 * Pattern:
 * 1. Task completes (success or failure)
 * 2. Agent reflects: what worked, what failed, what to do differently
 * 3. Reflection stored in memory
 * 4. Relevant reflections injected into future prompts
 * 5. Over time, agent accumulates "wisdom" from experience
 */

import { PersistentMemory, type MemoryEntry } from '../memory/persistent-memory.js';

export interface Reflection {
  id: string;
  task_summary: string;
  outcome: 'success' | 'partial' | 'failure';
  what_worked: string[];
  what_failed: string[];
  lessons: string[];
  next_time: string; // What to do differently
  created_at: string;
  tokens_used: number;
  tools_used: string[];
}

export class ReflectionEngine {
  private memory: PersistentMemory;
  private llmProvider: { complete: (messages: any[]) => Promise<{ content: string | null }> } | null = null;
  private currentTask: {
    startTime: number;
    toolsUsed: string[];
    tokenCount: number;
    messages: string[];
  } | null = null;

  constructor(memory: PersistentMemory, llmProvider?: { complete: (messages: any[]) => Promise<{ content: string | null }> }) {
    this.memory = memory;
    this.llmProvider = llmProvider || null;
  }

  /** [v0.8.0] Set or update the LLM provider for LLM-based reflections. */
  setLlmProvider(provider: { complete: (messages: any[]) => Promise<{ content: string | null }> }): void {
    this.llmProvider = provider;
  }

  // --- Task Tracking ---

  /** Start tracking a new task. */
  startTask(): void {
    this.currentTask = {
      startTime: Date.now(),
      toolsUsed: [],
      tokenCount: 0,
      messages: [],
    };
  }

  /** Record a tool call during the task. */
  recordToolUse(toolName: string): void {
    this.currentTask?.toolsUsed.push(toolName);
  }

  /** Record tokens used. */
  recordTokens(count: number): void {
    if (this.currentTask) this.currentTask.tokenCount += count;
  }

  /** End tracking and generate reflection. Uses LLM if available, otherwise templates. */
  async endTask(userPrompt: string, agentResponse: string, outcome: 'success' | 'partial' | 'failure'): Promise<Reflection | null> {
    if (!this.currentTask) return null;

    const duration = Date.now() - this.currentTask.startTime;
    const uniqueTools = [...new Set(this.currentTask.toolsUsed)];

    let reflection: Reflection;

    // [v0.8.0] Use LLM-based reflection when available
    if (this.llmProvider) {
      reflection = await this.generateLLMReflection(userPrompt, agentResponse, outcome, uniqueTools, duration);
    } else {
      // Fallback to template-based reflection
      reflection = {
        id: `ref_${Date.now()}`,
        task_summary: userPrompt.substring(0, 200),
        outcome,
        what_worked: this.extractWhatWorked(outcome, uniqueTools, duration),
        what_failed: this.extractWhatFailed(outcome, agentResponse),
        lessons: this.extractLessons(outcome, uniqueTools),
        next_time: this.generateNextTime(outcome, uniqueTools),
        created_at: new Date().toISOString(),
        tokens_used: this.currentTask.tokenCount,
        tools_used: uniqueTools,
      };
    }

    // Store reflection in memory
    this.memory.save('session', `reflection_${reflection.id}`, this.formatReflection(reflection), {
      tags: ['reflection', outcome, ...uniqueTools],
      importance: outcome === 'failure' ? 9 : outcome === 'partial' ? 7 : 5,
    });

    // Store lessons separately for easy retrieval
    for (const lesson of reflection.lessons) {
      this.memory.save('knowledge', `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, lesson, {
        tags: ['lesson', 'from-reflection'],
        importance: 8,
      });
    }

    this.currentTask = null;
    return reflection;
  }

  /**
   * [v0.8.0] LLM-based reflection generation — Reflexion pattern.
   * Asks the LLM to analyze what happened and produce structured insights.
   */
  private async generateLLMReflection(
    userPrompt: string,
    agentResponse: string,
    outcome: 'success' | 'partial' | 'failure',
    tools: string[],
    durationMs: number
  ): Promise<Reflection> {
    const reflectionPrompt = `You are a learning agent analyzing a completed task. Produce a structured reflection.

TASK: ${userPrompt.substring(0, 500)}
OUTCOME: ${outcome}
TOOLS USED: ${tools.join(', ') || 'none'}
DURATION: ${durationMs}ms
RESPONSE (first 500 chars): ${agentResponse.substring(0, 500)}

Respond in this exact JSON format:
{
  "what_worked": ["specific thing 1 that worked well", "specific thing 2"],
  "what_failed": ["specific issue 1", "specific issue 2"],
  "lessons": ["actionable lesson 1 for future tasks", "actionable lesson 2"],
  "next_time": "One concrete strategy for handling similar tasks better"
}`;

    try {
      const llmResponse = await this.llmProvider!.complete([
        { role: 'system', content: 'You are a reflection engine. Analyze task outcomes and produce structured, actionable insights. Always respond with valid JSON.' },
        { role: 'user', content: reflectionPrompt },
      ]);

      const parsed = JSON.parse(llmResponse.content || '{}');
      return {
        id: `ref_${Date.now()}`,
        task_summary: userPrompt.substring(0, 200),
        outcome,
        what_worked: Array.isArray(parsed.what_worked) ? parsed.what_worked : [],
        what_failed: Array.isArray(parsed.what_failed) ? parsed.what_failed : [],
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
        next_time: typeof parsed.next_time === 'string' ? parsed.next_time : this.generateNextTime(outcome, tools),
        created_at: new Date().toISOString(),
        tokens_used: this.currentTask?.tokenCount || 0,
        tools_used: tools,
      };
    } catch {
      // LLM reflection failed — fall back to templates
      return {
        id: `ref_${Date.now()}`,
        task_summary: userPrompt.substring(0, 200),
        outcome,
        what_worked: this.extractWhatWorked(outcome, tools, durationMs),
        what_failed: this.extractWhatFailed(outcome, agentResponse),
        lessons: this.extractLessons(outcome, tools),
        next_time: this.generateNextTime(outcome, tools),
        created_at: new Date().toISOString(),
        tokens_used: this.currentTask?.tokenCount || 0,
        tools_used: tools,
      };
    }
  }

  /**
   * [v0.8.0] Self-Refine pattern — FEEDBACK → REFINE loop on an output.
   * Iteratively critiques and improves an output until convergence or max iterations.
   */
  async selfRefine(
    task: string,
    initialOutput: string,
    maxIterations: number = 2
  ): Promise<{ output: string; iterations: number; approved: boolean }> {
    if (!this.llmProvider) return { output: initialOutput, iterations: 0, approved: true };

    let output = initialOutput;
    let iterations = 0;

    for (let i = 0; i < maxIterations; i++) {
      iterations++;

      // FEEDBACK step: critique the current output
      const feedback = await this.llmProvider.complete([
        { role: 'system', content: `Critique the following output for the task.
Identify specific issues. Be constructive and actionable.
If the output is excellent, respond with exactly: APPROVED` },
        { role: 'user', content: `Task: ${task}\n\nOutput:\n${output}` },
      ]);

      const feedbackText = feedback.content || '';

      // Check for convergence
      if (feedbackText.includes('APPROVED')) {
        return { output, iterations, approved: true };
      }

      // REFINE step: improve based on feedback
      const refined = await this.llmProvider.complete([
        { role: 'system', content: 'Improve the output based on the feedback. Address every issue. Produce the complete improved output.' },
        { role: 'user', content: `Task: ${task}\nCurrent output:\n${output}\n\nFeedback:\n${feedbackText}` },
      ]);

      output = refined.content || output;
    }

    return { output, iterations, approved: false };
  }

  // --- Reflection Generation ---

  private extractWhatWorked(outcome: string, tools: string[], duration: number): string[] {
    const worked: string[] = [];
    if (outcome === 'success') {
      worked.push('Task completed successfully');
      if (duration < 30000) worked.push('Fast execution (< 30s)');
      if (tools.length > 0) worked.push(`Effective tool use: ${tools.join(', ')}`);
    }
    if (outcome === 'partial') {
      worked.push('Partial progress made');
      if (tools.length > 0) worked.push(`Tools used: ${tools.join(', ')}`);
    }
    return worked;
  }

  private extractWhatFailed(outcome: string, response: string): string[] {
    const failed: string[] = [];
    if (outcome === 'failure') {
      failed.push('Task did not complete successfully');
      if (response.includes('error') || response.includes('Error')) {
        failed.push('Encountered errors during execution');
      }
      if (response.includes('Maximum iterations')) {
        failed.push('Reached maximum iterations without resolution');
      }
      if (response.includes('Budget exceeded')) {
        failed.push('Budget limit reached');
      }
    }
    if (outcome === 'partial') {
      failed.push('Only partial completion achieved');
    }
    return failed;
  }

  private extractLessons(outcome: string, tools: string[]): string[] {
    const lessons: string[] = [];
    if (outcome === 'failure') {
      lessons.push('When a tool fails, try a different approach before giving up');
      if (tools.includes('run_command')) {
        lessons.push('Shell commands may fail — check error output and try alternatives');
      }
      if (tools.includes('web_search')) {
        lessons.push('Web search may not return relevant results — try different queries');
      }
    }
    if (outcome === 'success' && tools.length > 2) {
      lessons.push(`Multi-tool workflow succeeded: ${tools.join(' → ')}`);
    }
    return lessons;
  }

  private generateNextTime(outcome: string, tools: string[]): string {
    if (outcome === 'failure') {
      return 'Next time: break the task into smaller steps, verify each step before proceeding';
    }
    if (outcome === 'partial') {
      return 'Next time: continue from where we left off, use the tools that worked';
    }
    return 'Continue using this approach for similar tasks';
  }

  private formatReflection(r: Reflection): string {
    const parts = [
      `Task: ${r.task_summary}`,
      `Outcome: ${r.outcome}`,
      `Tools: ${r.tools_used.join(', ') || 'none'}`,
      `Tokens: ${r.tokens_used}`,
    ];
    if (r.what_worked.length) parts.push(`Worked: ${r.what_worked.join('; ')}`);
    if (r.what_failed.length) parts.push(`Failed: ${r.what_failed.join('; ')}`);
    if (r.lessons.length) parts.push(`Lessons: ${r.lessons.join('; ')}`);
    parts.push(`Next time: ${r.next_time}`);
    return parts.join(' | ');
  }

  // --- Retrieval ---

  /** Get recent reflections for prompt injection. */
  getRecentReflections(limit: number = 3): string[] {
    return this.memory.getByCategory('session')
      .filter(e => e.key.startsWith('reflection_'))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map(r => r.content);
  }

  /** Get lessons learned. */
  getLessons(limit: number = 5): string[] {
    const lessons = this.memory.recall('lesson', {
      category: 'knowledge',
      limit,
    });
    return lessons.map(l => l.content);
  }

  /** Format reflections for system prompt injection. */
  formatForPrompt(): string {
    const reflections = this.getRecentReflections(3);
    const lessons = this.getLessons(5);

    if (reflections.length === 0 && lessons.length === 0) return '';

    const parts: string[] = [];
    if (lessons.length > 0) {
      parts.push(`## Lessons Learned:\n${lessons.map(l => `- ${l}`).join('\n')}`);
    }
    if (reflections.length > 0) {
      parts.push(`## Recent Task Reflections:\n${reflections.map(r => `- ${r}`).join('\n')}`);
    }

    return `\n\n${parts.join('\n\n')}`;
  }
}
