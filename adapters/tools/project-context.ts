/**
 * Project Context — auto-load project configuration and context files.
 * Based on: Claude Code CLAUDE.md auto-loading, Aider .aider.conf.yml, Cursor .cursorrules.
 * Reads project-specific configuration from well-known files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProjectConfig {
  projectRoot: string;
  projectName: string;
  contextFiles: Array<{ name: string; content: string }>;
  ignorePatterns: string[];
  defaultPersona: string;
  customInstructions: string;
}

export class ProjectContext {
  private cwd: string;
  private config: ProjectConfig | null = null;

  private static CONTEXT_FILES = [
    'CLAUDE.md',
    'AGENTS.md',
    '.cursorrules',
    'INSTRUCTIONS.md',
    '.imzx/instructions.md',
  ];

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  load(): ProjectConfig {
    const projectRoot = this.findProjectRoot();
    const projectName = path.basename(projectRoot);
    const contextFiles: Array<{ name: string; content: string }> = [];

    for (const fileName of ProjectContext.CONTEXT_FILES) {
      const filePath = path.join(projectRoot, fileName);
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content.length > 0) contextFiles.push({ name: fileName, content });
      } catch {}
    }

    const ignorePatterns: string[] = ['.git/', 'node_modules/', 'target/', '__pycache__/'];
    try {
      const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
      for (const line of gitignore.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) ignorePatterns.push(trimmed);
      }
    } catch {}

    let defaultPersona = 'general-purpose';
    let customInstructions = '';
    try {
      const imzxConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, '.imzx', 'config.json'), 'utf-8'));
      if (imzxConfig.defaultPersona) defaultPersona = imzxConfig.defaultPersona;
      if (imzxConfig.customInstructions) customInstructions = imzxConfig.customInstructions;
    } catch {}

    this.config = { projectRoot, projectName, contextFiles, ignorePatterns, defaultPersona, customInstructions };
    return this.config;
  }

  private findProjectRoot(): string {
    let dir = this.cwd;
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(path.join(dir, '.git')) ||
          fs.existsSync(path.join(dir, 'package.json')) ||
          fs.existsSync(path.join(dir, 'Cargo.toml')) ||
          fs.existsSync(path.join(dir, '.imzx'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return this.cwd;
  }

  formatForPrompt(): string {
    if (!this.config) this.load();
    const cfg = this.config!;
    const parts: string[] = [];
    parts.push(`## Project: ${cfg.projectName} (${cfg.projectRoot})`);
    for (const file of cfg.contextFiles) {
      const preview = file.content.length > 3000
        ? file.content.substring(0, 3000) + '\n... (truncated)'
        : file.content;
      parts.push(`\n### ${file.name}:\n${preview}`);
    }
    if (cfg.customInstructions) parts.push(`\n### Custom Instructions:\n${cfg.customInstructions}`);
    return parts.join('\n');
  }

  shouldIgnore(filePath: string): boolean {
    if (!this.config) this.load();
    for (const pattern of this.config!.ignorePatterns) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\./g, '\.'));
      if (regex.test(filePath)) return true;
    }
    return false;
  }

  getConfig(): ProjectConfig | null { return this.config; }
}
