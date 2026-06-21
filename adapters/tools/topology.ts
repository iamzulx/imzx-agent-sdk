/**
 * Multi-Agent Topology Patterns — Chain, Star, Mesh communication topologies.
 *
 * Based on: AugmentCode 26-pattern catalog (2026),
 *           "Topology Patterns (Chain/Star/Mesh)" academic literature.
 */

import type { Agent } from './orchestration.js';

// Re-export for consumers
export type { Agent };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TopologyResult {
  output: string;
  agentPath: string[];
  durationMs: number;
  strategy: string;
}

// ─── Chain Topology ──────────────────────────────────────────────────────────

/**
 * Chain: A → B → C (sequential pipeline)
 * Each agent processes the output of the previous one.
 */
export class ChainTopology {
  async execute(agents: Agent[], task: string, context?: Record<string, unknown>): Promise<TopologyResult> {
    const start = Date.now();
    const path: string[] = [];
    let current = task;

    for (const agent of agents) {
      path.push(agent.id);
      current = await agent.execute(current, context);
    }

    return { output: current, agentPath: path, durationMs: Date.now() - start, strategy: 'chain' };
  }
}

// ─── Star Topology ───────────────────────────────────────────────────────────

/**
 * Star: Central orchestrator → parallel workers → aggregator
 * Best for tasks that can be split into independent subtasks.
 */
export class StarTopology {
  async execute(orchestrator: Agent, workers: Agent[], task: string, context?: Record<string, unknown>): Promise<TopologyResult> {
    const start = Date.now();
    const path: string[] = [orchestrator.id];

    // Orchestrator decomposes task
    const decomposition = await orchestrator.execute(
      `Decompose this task into ${workers.length} independent subtasks:\n${task}\n\nReturn JSON array: ["subtask1", "subtask2", ...]`,
      context
    );

    let subtasks: string[];
    try {
      const parsed = decomposition.match(/\[[\s\S]*\]/);
      subtasks = parsed ? JSON.parse(parsed[0]) : [task];
    } catch {
      subtasks = [task];
    }

    // Workers execute in parallel
    const workerPromises = workers.slice(0, subtasks.length).map(async (worker, i) => {
      path.push(worker.id);
      return worker.execute(subtasks[i] || task, context);
    });

    const results = await Promise.all(workerPromises);

    // Orchestrator aggregates
    path.push(orchestrator.id + ':aggregate');
    const aggregated = await orchestrator.execute(
      `Aggregate these results:\n${results.map((r, i) => `[${i+1}]: ${r}`).join('\n\n')}\n\nProvide a unified response.`,
      context
    );

    return { output: aggregated, agentPath: path, durationMs: Date.now() - start, strategy: 'star' };
  }
}

// ─── Mesh Topology ───────────────────────────────────────────────────────────

/**
 * Mesh: Peer-to-peer, all agents communicate with all.
 * Best for consensus-building or debate scenarios.
 */
export class MeshTopology {
  async execute(agents: Agent[], task: string, context?: Record<string, unknown>, rounds: number = 2): Promise<TopologyResult> {
    const start = Date.now();
    const path: string[] = [];
    const opinions: string[] = [];

    // Each agent provides initial opinion
    const initialPromises = agents.map(async agent => {
      path.push(agent.id);
      const opinion = await agent.execute(task, context);
      return { agent: agent.id, opinion };
    });

    let currentOpinions = await Promise.all(initialPromises);

    // Debate rounds: each agent sees others' opinions
    for (let round = 1; round < rounds; round++) {
      const roundPromises = agents.map(async (agent, i) => {
        const othersOpinions = currentOpinions
          .filter(o => o.agent !== agent.id)
          .map(o => `[${o.agent}]: ${o.opinion}`)
          .join('\n');

        const refined = await agent.execute(
          `Original task: ${task}\n\nOther agents' opinions:\n${othersOpinions}\n\nRefine your answer considering others' perspectives.`,
          context
        );
        return { agent: agent.id, opinion: refined };
      });

      currentOpinions = await Promise.all(roundPromises);
    }

    // Consensus: take the last agent's opinion (or first, or average)
    const consensus = currentOpinions[currentOpinions.length - 1].opinion;

    return { output: consensus, agentPath: path, durationMs: Date.now() - start, strategy: 'mesh' };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export type TopologyType = 'chain' | 'star' | 'mesh';

export function createTopology(type: TopologyType): ChainTopology | StarTopology | MeshTopology {
  switch (type) {
    case 'chain': return new ChainTopology();
    case 'star': return new StarTopology();
    case 'mesh': return new MeshTopology();
    default: throw new Error(`Unknown topology: ${type}`);
  }
}
