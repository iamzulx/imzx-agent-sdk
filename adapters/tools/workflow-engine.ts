/**
 * Workflow Engine — DAG-based task orchestration for complex multi-step workflows.
 * Based on: Anthropic Building Effective Agents (orchestrator-workers pattern),
 * LangGraph directed graphs (2026), Microsoft Agent Framework 1.0.
 */

export interface WorkflowStep {
  id: string;
  name: string;
  tool?: string;
  args?: Record<string, unknown>;
  depends_on: string[];
  condition?: 'always' | 'on_success' | 'on_failure';
  max_retries: number;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  created_at: string;
}

export interface StepResult {
  step_id: string;
  status: 'success' | 'failure' | 'skipped';
  output: string;
  duration_ms: number;
  retries_used: number;
}

export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();

  createWorkflow(name: string, steps: WorkflowStep[]): Workflow {
    const id = `wf_${Date.now()}`;
    const workflow: Workflow = {
      id,
      name,
      steps: steps.map(s => ({ id: s.id, name: s.name, tool: s.tool, args: s.args, depends_on: s.depends_on || [], condition: s.condition, max_retries: s.max_retries ?? 3 })),
      created_at: new Date().toISOString(),
    };
    this.workflows.set(id, workflow);
    return workflow;
  }

  getExecutableSteps(workflow: Workflow, completed: Set<string>, failed: Set<string>): WorkflowStep[] {
    return workflow.steps.filter(step => {
      if (completed.has(step.id) || failed.has(step.id)) return false;
      return step.depends_on.every(dep => {
        if (step.condition === 'on_failure') return failed.has(dep);
        return completed.has(dep);
      });
    });
  }

  getExecutionOrder(workflow: Workflow): string[][] {
    const completed = new Set<string>();
    const levels: string[][] = [];
    let remaining = [...workflow.steps];
    while (remaining.length > 0) {
      const executable = remaining.filter(s => s.depends_on.every(d => completed.has(d)));
      if (executable.length === 0) break;
      const level = executable.map(s => s.id);
      levels.push(level);
      executable.forEach(s => completed.add(s.id));
      remaining = remaining.filter(s => !completed.has(s.id));
    }
    return levels;
  }

  getWorkflow(id: string): Workflow | undefined { return this.workflows.get(id); }
  listWorkflows(): Workflow[] { return Array.from(this.workflows.values()); }
  deleteWorkflow(id: string): boolean { return this.workflows.delete(id); }

  formatForPrompt(workflow: Workflow): string {
    const order = this.getExecutionOrder(workflow);
    const parts = order.map((level, i) => {
      const names = level.map(id => workflow.steps.find(s => s.id === id)?.name || id);
      return `  Step ${i + 1}: ${names.join(' + ')}`;
    });
    return `## Workflow: ${workflow.name}\n${parts.join('\n')}`;
  }

  /**
   * [v0.8.0] Execute a workflow — runs steps in dependency order with retry + error handling.
   * The `executor` callback runs each step's tool with its args and returns output.
   */
  async execute(
    workflow: Workflow,
    executor: (tool: string, args: Record<string, unknown>, stepName: string) => Promise<string>
  ): Promise<{ results: StepResult[]; success: boolean }> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const results: StepResult[] = [];
    const outputs = new Map<string, string>();

    const maxIterations = workflow.steps.length * 3; // safety limit
    let iterations = 0;

    while ((completed.size + failed.size) < workflow.steps.length && iterations < maxIterations) {
      iterations++;
      const executable = this.getExecutableSteps(workflow, completed, failed);

      if (executable.length === 0) {
        // No more executable steps — check for cycles or unresolvable deps
        const remaining = workflow.steps.filter(s => !completed.has(s.id) && !failed.has(s.id));
        for (const step of remaining) {
          results.push({
            step_id: step.id,
            status: 'skipped',
            output: 'Skipped: dependencies not met',
            duration_ms: 0,
            retries_used: 0,
          });
          failed.add(step.id);
        }
        break;
      }

      // Execute steps (sequentially within each level for determinism)
      for (const step of executable) {
        const start = performance.now();
        let stepSuccess = false;
        let output = '';
        let retriesUsed = 0;

        for (let attempt = 0; attempt <= step.max_retries; attempt++) {
          retriesUsed = attempt;
          try {
            output = await executor(step.tool || 'run_command', step.args || {}, step.name);
            stepSuccess = true;
            break;
          } catch (err) {
            output = `Error (attempt ${attempt + 1}/${step.max_retries + 1}): ${(err as Error).message}`;
            if (attempt < step.max_retries) {
              // Exponential backoff
              await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
            }
          }
        }

        const duration = performance.now() - start;
        results.push({
          step_id: step.id,
          status: stepSuccess ? 'success' : 'failure',
          output,
          duration_ms: Math.round(duration),
          retries_used: retriesUsed,
        });

        if (stepSuccess) {
          completed.add(step.id);
          outputs.set(step.id, output);
        } else {
          failed.add(step.id);
        }
      }
    }

    return {
      results,
      success: failed.size === 0,
    };
  }
}
