/**
 * Skill System — save, load, and search reusable agent skills.
 * 
 * Based on:
 * - Hermes Agent skill_manage system
 * - HyperAgents (Meta/Oxford 2026): reusable patterns from successful tasks
 * - Anthropic Agent Skills: equipping agents for the real world
 * 
 * A "skill" is a proven workflow that the agent can reuse:
 * - Template code for common tasks
 * - Step-by-step procedures
 * - Known gotchas and pitfalls
 * - Tool usage patterns
 * 
 * Skills are stored as JSON files in .imzx/skills/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Skill {
  name: string;
  description: string;
  category: string;
  steps: string[];
  code_template?: string;
  tools_used: string[];
  gotchas: string[];
  success_count: number;
  failure_count: number;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export class SkillManager {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();

  constructor(baseDir?: string) {
    this.skillsDir = baseDir || path.join(process.cwd(), '.imzx', 'skills');
    this.loadAll();
  }

  // --- CRUD ---

  /** Save a new skill or update existing. */
  save(skill: Omit<Skill, 'created_at' | 'updated_at' | 'success_count' | 'failure_count'>): Skill {
    const existing = this.skills.get(skill.name);
    const now = new Date().toISOString();

    const fullSkill: Skill = {
      ...skill,
      created_at: existing?.created_at || now,
      updated_at: now,
      success_count: existing?.success_count || 0,
      failure_count: existing?.failure_count || 0,
    };

    this.skills.set(skill.name, fullSkill);
    this.persistSkill(fullSkill);
    return fullSkill;
  }

  /** Load a skill by name. */
  load(name: string): Skill | null {
    return this.skills.get(name) || null;
  }

  /** Search skills by query. */
  search(query: string, limit: number = 5): Skill[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = Array.from(this.skills.values()).map(skill => {
      let score = 0;
      const nameLower = skill.name.toLowerCase();
      const descLower = skill.description.toLowerCase();
      const tagsLower = skill.tags.map(t => t.toLowerCase());

      if (nameLower.includes(queryLower)) score += 50;
      if (descLower.includes(queryLower)) score += 30;
      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 15;
        if (descLower.includes(word)) score += 10;
        if (tagsLower.some(t => t.includes(word))) score += 20;
      }

      // Success rate bonus
      const total = skill.success_count + skill.failure_count;
      if (total > 0) {
        score += (skill.success_count / total) * 20;
      }

      return { skill, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.skill);
  }

  /** List all skills. */
  list(): Skill[] {
    return Array.from(this.skills.values())
      .sort((a, b) => b.success_count - a.success_count);
  }

  /** Record a successful use of a skill. */
  recordSuccess(name: string): void {
    const skill = this.skills.get(name);
    if (skill) {
      skill.success_count++;
      skill.updated_at = new Date().toISOString();
      this.persistSkill(skill);
    }
  }

  /** Record a failed use of a skill. */
  recordFailure(name: string): void {
    const skill = this.skills.get(name);
    if (skill) {
      skill.failure_count++;
      skill.updated_at = new Date().toISOString();
      this.persistSkill(skill);
    }
  }

  /** Delete a skill. */
  delete(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    this.skills.delete(name);
    const filePath = path.join(this.skillsDir, `${name}.json`);
    try { fs.unlinkSync(filePath); } catch {}
    return true;
  }

  // --- Auto-Extraction ---

  /** Extract a skill from a successful task. */
  extractFromTask(
    taskDescription: string,
    toolsUsed: string[],
    steps: string[],
    codeSnippet?: string
  ): Skill {
    // Generate a name from the task description
    const name = taskDescription
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('-');

    return this.save({
      name: `auto-${name}-${Date.now().toString(36)}`,
      description: taskDescription.substring(0, 200),
      category: 'auto-extracted',
      steps,
      code_template: codeSnippet,
      tools_used: toolsUsed,
      gotchas: [],
      tags: ['auto-extracted', ...toolsUsed],
    });
  }

  // --- Context Injection ---

  /** Format relevant skills for system prompt. */
  formatForPrompt(query: string): string {
    const skills = this.search(query, 3);
    if (skills.length === 0) return '';

    const formatted = skills.map(s => {
      const parts = [`### ${s.name}`, s.description];
      if (s.steps.length > 0) {
        parts.push(`Steps:\n${s.steps.map((st, i) => `${i + 1}. ${st}`).join('\n')}`);
      }
      if (s.gotchas.length > 0) {
        parts.push(`Gotchas:\n${s.gotchas.map(g => `- ⚠️ ${g}`).join('\n')}`);
      }
      if (s.code_template) {
        parts.push(`Template:\n\`\`\`\n${s.code_template}\n\`\`\``);
      }
      return parts.join('\n');
    });

    return `\n\n## Relevant Skills (from past experience):\n\n${formatted.join('\n\n---\n\n')}`;
  }

  // --- Persistence ---

  private loadAll(): void {
    try {
      fs.mkdirSync(this.skillsDir, { recursive: true });
      const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = fs.readFileSync(path.join(this.skillsDir, file), 'utf-8');
          const skill = JSON.parse(data) as Skill;
          this.skills.set(skill.name, skill);
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private persistSkill(skill: Skill): void {
    try {
      fs.mkdirSync(this.skillsDir, { recursive: true });
      const filePath = path.join(this.skillsDir, `${skill.name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(skill, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[Skill] Failed to persist ${skill.name}: ${err}`);
    }
  }
}
