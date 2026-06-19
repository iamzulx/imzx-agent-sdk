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
}
