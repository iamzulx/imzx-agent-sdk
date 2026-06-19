
/**
 * Plugin System — load tools from external files and npm packages.
 * Based on: Claude Code plugin architecture, MCP tool registration pattern.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  tools: PluginTool[];
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler?: (args: Record<string, unknown>) => Promise<string>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  path: string;
  loadedAt: string;
  status: 'active' | 'error';
  error?: string;
}

export class PluginSystem {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginDir: string;

  constructor(baseDir?: string) {
    this.pluginDir = baseDir || path.join(process.cwd(), '.imzx', 'plugins');
    try { fs.mkdirSync(this.pluginDir, { recursive: true }); } catch {}
  }

  async loadPlugin(pluginPath: string): Promise<LoadedPlugin> {
    try {
      const manifestPath = path.join(pluginPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
      if (!manifest.name || !manifest.tools || manifest.tools.length === 0) {
        throw new Error('Invalid plugin manifest: missing name or tools');
      }
      const handlerPath = path.join(pluginPath, 'handler.js');
      let handler: any;
      try { handler = await import(handlerPath); } catch {
        handler = await import(path.join(pluginPath, 'handler.ts'));
      }
      for (const tool of manifest.tools) {
        if (handler[tool.name]) tool.handler = handler[tool.name];
        else if (handler.default?.[tool.name]) tool.handler = handler.default[tool.name];
      }
      const loaded: LoadedPlugin = { manifest, path: pluginPath, loadedAt: new Date().toISOString(), status: 'active' };
      this.plugins.set(manifest.name, loaded);
      return loaded;
    } catch (err: any) {
      const loaded: LoadedPlugin = {
        manifest: { name: path.basename(pluginPath), version: '0', description: '', tools: [] },
        path: pluginPath, loadedAt: new Date().toISOString(), status: 'error', error: err.message,
      };
      this.plugins.set(loaded.manifest.name, loaded);
      return loaded;
    }
  }

  async loadAll(): Promise<LoadedPlugin[]> {
    const results: LoadedPlugin[] = [];
    try {
      const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) results.push(await this.loadPlugin(path.join(this.pluginDir, entry.name)));
      }
    } catch {}
    return results;
  }

  getTools(): PluginTool[] {
    const tools: PluginTool[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.status === 'active') tools.push(...plugin.manifest.tools);
    }
    return tools;
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.getTools().find(t => t.name === name);
    if (!tool?.handler) throw new Error(`Plugin tool '${name}' not found or has no handler`);
    return tool.handler(args);
  }

  list(): LoadedPlugin[] { return Array.from(this.plugins.values()); }
  unload(name: string): boolean { return this.plugins.delete(name); }
}
