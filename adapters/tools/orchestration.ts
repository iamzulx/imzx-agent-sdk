/**
 * Multi-Agent Orchestration — 6 strategies for coordinating multiple agents.
 * Phase 5.4: Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallelization.
 */

export interface Agent {
  id: string;
  name: string;
  capabilities: string[];
  execute: (task: string, context?: Record<string, unknown>) => Promise<string>;
}

export interface OrchestrationResult {
  output: string;
  agentsUsed: string[];
  strategy: string;
  durationMs: number;
  iterations?: number;
}

export interface TaskAnalysis {
  type: 'simple' | 'complex' | 'ambiguous' | 'multi-step' | 'critical' | 'parallelizable';
  suggestedStrategy: OrchestrationStrategy['name'];
  reasoning: string;
}

// --- Strategy Interface ---

export interface OrchestrationStrategy {
  name: string;
  description: string;
  execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult>;
}

// --- 1. Router Strategy ---
// Routes task to the single best-matching agent based on capabilities.

export class RouterStrategy implements OrchestrationStrategy {
  name = 'router';
  description = 'Routes task to the best-matching single agent';

  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const start = Date.now();
    const taskLower = task.toLowerCase();

    // Score agents by capability match
    const scored = agents.map(agent => {
      let score = 0;
      for (const cap of agent.capabilities) {
        if (taskLower.includes(cap.toLowerCase())) score += 10;
      }
      // Simple keyword matching
      const taskWords = taskLower.split(/\s+/);
      for (const word of taskWords) {
        if (agent.name.toLowerCase().includes(word)) score += 5;
        for (const cap of agent.capabilities) {
          if (cap.toLowerCase().includes(word)) score += 3;
        }
      }
      return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0]?.agent ?? agents[0]!;
    const output = await selected.execute(task, context);

    return {
      output,
      agentsUsed: [selected.id],
      strategy: this.name,
      durationMs: Date.now() - start,
    };
  }
}

// --- 2. Hierarchical Strategy ---
// Breaks task into subtasks, delegates to specialized agents, aggregates.

export class HierarchicalStrategy implements OrchestrationStrategy {
  name = 'hierarchical';
  description = 'Breaks task into subtasks and delegates to specialized agents';

  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const start = Date.now();
    const agentsUsed: string[] = [];

    // Decompose task into parts (simple sentence-based splitting)
    const subtasks = this.decomposeTask(task, agents.length);
    const results: string[] = [];

    for (let i = 0; i < subtasks.length; i++) {
      const agent = agents[i % agents.length]!;
      agentsUsed.push(agent.id);
      const result = await agent.execute(subtasks[i]!, context);
      results.push(`[${agent.name}] ${result}`);
    }

    // Aggregate results
    const output = results.length === 1
      ? results[0]!
      : `Combined results:\n${results.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;

    return { output, agentsUsed: [...new Set(agentsUsed)], strategy: this.name, durationMs: Date.now() - start };
  }

  private decomposeTask(task: string, maxParts: number): string[] {
    // Split by sentences or semicolons
    const parts = task.split(/[.;]\s+/).filter(p => p.trim().length > 0);
    if (parts.length <= 1) return [task]; // Can't decompose further
    return parts.slice(0, maxParts);
  }
}

// --- 3. Consensus Strategy ---
// Multiple agents solve same task, pick best result by agreement.

export class ConsensusStrategy implements OrchestrationStrategy {
  name = 'consensus';
  description = 'Multiple agents solve the same task, selects best by agreement';

  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const start = Date.now();
    const agentsUsed: string[] = [];

    // Run all agents in parallel
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        agentsUsed.push(agent.id);
        return { agent, output: await agent.execute(task, context) };
      })
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<{ agent: Agent; output: string }> => r.status === 'fulfilled')
      .map(r => r.value);

    if (successful.length === 0) {
      return { output: 'All agents failed', agentsUsed, strategy: this.name, durationMs: Date.now() - start };
    }

    // Select longest/most detailed response as "best" (simple heuristic)
    // In production, use an evaluator agent
    const best = successful.reduce((a, b) => a.output.length > b.output.length ? a : b);

    return {
      output: best.output,
      agentsUsed: [...new Set(agentsUsed)],
      strategy: this.name,
      durationMs: Date.now() - start,
    };
  }
}

// --- 4. Chaining Strategy ---
// Pipeline: output of one agent feeds into the next.

export class ChainingStrategy implements OrchestrationStrategy {
  name = 'chaining';
  description = 'Pipeline: output of one agent feeds into the next';

  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const start = Date.now();
    const agentsUsed: string[] = [];
    let currentInput = task;

    for (const agent of agents) {
      agentsUsed.push(agent.id);
      currentInput = await agent.execute(currentInput, context);
    }

    return {
      output: currentInput,
      agentsUsed: [...new Set(agentsUsed)],
      strategy: this.name,
      durationMs: Date.now() - start,
      iterations: agents.length,
    };
  }
}

// --- 5. Evaluator-Optimizer Strategy ---
// Agent generates, evaluator checks, optimizer refines in a loop.

export class EvaluatorOptimizerStrategy implements OrchestrationStrategy {
  name = 'evaluator-optimizer';
  description = 'Generate → evaluate → optimize loop until quality threshold met';

  private maxIterations: number;

  constructor(maxIterations: number = 3) {
    this.maxIterations = maxIterations;
  }

  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const start = Date.now();
    const agentsUsed: string[] = [];
    const generator = agents[0]!;
    const evaluator = agents.length > 1 ? agents[1]! : agents[0]!;

    let bestOutput = '';
    let iteration = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      iteration = i + 1;
      agentsUsed.push(generator.id);

      // Generate or improve
      const prompt = i === 0 ? task : `Previous attempt:\n${bestOutput}\n\nImprove based on feedback and try again:\n${task}`;
      bestOutput = await generator.execute(prompt, context);

      // Evaluate
      agentsUsed.push(evaluator.id);
      const evalResult = await evaluator.execute(
        `Evaluate this response for quality (reply with exactly "PASS" if good enough, or "FAIL: <reason>" if needs improvement):\n${bestOutput}`,
        context
      );

      if (evalResult.trim().startsWith('PASS')) break;
    }

    return {
      output: bestOutput,
      agentsUsed: [...new Set(agentsUsed)],
      strategy: this.name,
      durationMs: Date.now() - start,
      iterations: iteration,
    };
  }
}

// --- 6. Parallelization Strategy ---
// Split task into independent parts, run in parallel, merge.

export class ParallelizationStrategy implements OrchestrationStrategy {
  name = 'parallelization';
  description = 'Split task into independent parts, run in parallel, merge results';

  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const start = Date.now();

    // Run each agent on the full task in parallel
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const output = await agent.execute(task, context);
        return { agentId: agent.id, agentName: agent.name, output };
      })
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<{ agentId: string; agentName: string; output: string }> => r.status === 'fulfilled')
      .map(r => r.value);

    const agentsUsed = successful.map(r => r.agentId);

    // Merge results
    const output = successful.length === 1
      ? successful[0]!.output
      : successful.map(r => `### ${r.agentName}:\n${r.output}`).join('\n\n---\n\n');

    return { output, agentsUsed, strategy: this.name, durationMs: Date.now() - start };
  }
}

// --- Auto Strategy Selector ---

export class Orchestrator {
  private strategies: Map<string, OrchestrationStrategy> = new Map();

  constructor() {
    this.strategies.set('router', new RouterStrategy());
    this.strategies.set('hierarchical', new HierarchicalStrategy());
    this.strategies.set('consensus', new ConsensusStrategy());
    this.strategies.set('chaining', new ChainingStrategy());
    this.strategies.set('evaluator-optimizer', new EvaluatorOptimizerStrategy());
    this.strategies.set('parallelization', new ParallelizationStrategy());
  }

  /** Analyze task and select the best strategy. */
  analyzeTask(task: string): TaskAnalysis {
    const lower = task.toLowerCase();

    // Multi-step tasks with sequence words
    if (/then|after that|next|finally|step \d/i.test(lower)) {
      return { type: 'multi-step', suggestedStrategy: 'chaining', reasoning: 'Task has sequential steps' };
    }

    // Critical/quality tasks
    if (/important|critical|careful|precise|accurate|review/i.test(lower)) {
      return { type: 'critical', suggestedStrategy: 'evaluator-optimizer', reasoning: 'Task requires high quality output' };
    }

    // Tasks that can be parallelized
    if (/and also|additionally|as well as|both|compare/i.test(lower)) {
      return { type: 'parallelizable', suggestedStrategy: 'parallelization', reasoning: 'Task has independent parts' };
    }

    // Complex tasks
    if (task.length > 500 || /complex|comprehensive|detailed|analyze|research/i.test(lower)) {
      return { type: 'complex', suggestedStrategy: 'hierarchical', reasoning: 'Complex task that benefits from decomposition' };
    }

    // Ambiguous tasks
    if (/maybe|might|alternatively|or should|what if/i.test(lower)) {
      return { type: 'ambiguous', suggestedStrategy: 'consensus', reasoning: 'Ambiguous task benefits from multiple perspectives' };
    }

    // Default: router for simple tasks
    return { type: 'simple', suggestedStrategy: 'router', reasoning: 'Simple task, route to best agent' };
  }

  /** Execute a task with auto-selected strategy. */
  async execute(agents: Agent[], task: string, strategyName?: string, context?: Record<string, unknown>): Promise<OrchestrationResult> {
    const analysis = this.analyzeTask(task);
    const strategy = this.strategies.get(strategyName || analysis.suggestedStrategy) ?? new RouterStrategy();
    return strategy.execute(agents, task, context);
  }

  getStrategy(name: string): OrchestrationStrategy | undefined {
    return this.strategies.get(name);
  }

  listStrategies(): Array<{ name: string; description: string }> {
    return [...this.strategies.values()].map(s => ({ name: s.name, description: s.description }));
  }
}
