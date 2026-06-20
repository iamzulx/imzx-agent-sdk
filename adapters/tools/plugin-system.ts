/**
 * Plugin System — load tools, hooks, and personas from external npm packages or local directories.
 *
 * Architecture:
 *   - PluginManifest validated with Zod (imzx-plugin.json or package.json "imzx" field)
 *   - PluginManager: load / unload / install / uninstall / hot-reload
 *   - Hook pipeline: pre_tool_use → tool → post_tool_use, pre_llm_call → llm → post_llm_call
 *   - Sandboxed tool execution via subprocess
 *   - Permission model: plugins declare required permissions
 *   - Hot-reload via fs.watch on the plugins directory
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { z } from 'zod';

// ─── Zod Schemas ────────────────────────────────────────────────────────────────

export const ToolDefSchema = z.object({
  type: z.literal('function').default('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.unknown()),
  }),
});

export type ToolDef = z.infer<typeof ToolDefSchema>;

export const PermissionSchema = z.enum([
  'fs:read',
  'fs:write',
  'net:http',
  'exec:shell',
  'exec:code',
  'env:read',
  'env:write',
]);

export type Permission = z.infer<typeof PermissionSchema>;

export const HookNameSchema = z.enum([
  'pre_tool_use',
  'post_tool_use',
  'pre_llm_call',
  'post_llm_call',
]);

export type HookName = z.infer<typeof HookNameSchema>;

export const HookDefSchema = z.object({
  name: HookNameSchema,
  handler: z.function()
    .args(z.record(z.unknown()))
    .returns(z.promise(z.record(z.unknown())).or(z.record(z.unknown()))),
  priority: z.number().int().min(0).max(100).default(50),
});

export type HookDef = z.infer<typeof HookDefSchema>;

export const PersonaDefSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type PersonaDef = z.infer<typeof PersonaDefSchema>;

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  author: z.string().default('unknown'),
  entry: z.string().optional(),
  permissions: z.array(PermissionSchema).default([]),
  tools: z.array(ToolDefSchema).default([]),
  hooks: z.array(HookDefSchema.omit({ handler: true }).extend({
    handler: z.string(),
  })).optional(),
  personas: z.array(PersonaDefSchema).optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ─── Plugin Runtime Types ───────────────────────────────────────────────────────

export interface PluginHookDef {
  name: HookName;
  handler: HookHandler;
  priority: number;
}

export type HookHandler = (
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface Plugin {
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: Permission[];
  tools: ToolDef[];
  hooks: PluginHookDef[];
  personas: PersonaDef[];
  pluginPath: string;
  loadedAt: string;
  status: 'active' | 'error';
  error?: string;
  dispose?: () => void;
}

export interface HookContext {
  /** The hook name being fired. */
  hook: HookName;
  /** The tool name (for tool hooks). */
  toolName?: string;
  /** Tool arguments (pre_tool_use: mutable; post_tool_use: result). */
  args?: Record<string, unknown>;
  /** Tool result (post_tool_use only). */
  result?: unknown;
  /** LLM messages (pre/post_llm_call only). */
  messages?: unknown[];
  /** LLM response (post_llm_call only). */
  response?: unknown;
  /** Arbitrary extra data passed through the pipeline. */
  [key: string]: unknown;
}

// ─── Sandbox Runner ─────────────────────────────────────────────────────────────

/**
 * Execute a plugin tool handler in an isolated subprocess.
 * Serialises args to JSON on stdin; reads JSON result from stdout.
 */
export function runSandboxed(
  entryFile: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = fork(entryFile, [toolName], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        __IMZX_PLUGIN_TOOL: toolName,
        __IMZX_SANDBOX: '1',
      },
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

    child.on('message', (msg: { type: string; data?: unknown; error?: string }) => {
      if (msg.type === 'result') {
        resolve(typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data));
      } else if (msg.type === 'error') {
        reject(new Error(msg.error ?? 'Unknown sandbox error'));
      }
    });

    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(
          new Error(
            `Sandbox exited ${code}. stderr: ${stderr.slice(0, 500)}${stdout ? ` stdout: ${stdout.slice(0, 200)}` : ''}`,
          ),
        );
      }
    });

    // Send args to sandbox process
    child.send({ type: 'execute', tool: toolName, args });

    // Fallback timeout (subprocess may ignore the timeout option)
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Sandbox timeout after ${timeoutMs}ms`));
    }, timeoutMs + 1_000);

    child.on('exit', () => clearTimeout(timer));
  });
}

// ─── Plugin Manager ─────────────────────────────────────────────────────────────

export class PluginManager extends EventEmitter {
  private plugins = new Map<string, Plugin>();
  private pluginDir: string;
  private watcher: fs.FSWatcher | null = null;
  private grantedPermissions = new Set<string>();

  constructor(baseDir?: string) {
    super();
    this.pluginDir = baseDir ?? path.join(process.cwd(), '.imzx', 'plugins');
    try {
      fs.mkdirSync(this.pluginDir, { recursive: true });
    } catch {
      /* already exists */
    }
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  /**
   * Resolve the manifest from a plugin directory.
   * Priority: imzx-plugin.json > package.json "imzx" field.
   */
  private resolveManifest(pluginPath: string): PluginManifest {
    const standalone = path.join(pluginPath, 'imzx-plugin.json');
    if (fs.existsSync(standalone)) {
      const raw = JSON.parse(fs.readFileSync(standalone, 'utf-8'));
      return PluginManifestSchema.parse(raw);
    }

    const pkgJson = path.join(pluginPath, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
      if (pkg.imzx) {
        return PluginManifestSchema.parse({ ...pkg.imzx, name: pkg.imzx.name ?? pkg.name });
      }
    }

    throw new Error(
      `No manifest found in ${pluginPath}. Expected imzx-plugin.json or package.json "imzx" field.`,
    );
  }

  /**
   * Resolve the entry point for a plugin.
   * Priority: manifest.entry > index.js > index.ts > dist/index.js
   */
  private resolveEntry(pluginPath: string, manifest: PluginManifest): string {
    if (manifest.entry) {
      const entryPath = path.resolve(pluginPath, manifest.entry);
      if (fs.existsSync(entryPath)) return entryPath;
      throw new Error(`Declared entry "${manifest.entry}" not found in ${pluginPath}`);
    }

    const candidates = ['index.js', 'index.ts', 'index.mjs', 'dist/index.js', 'dist/index.mjs'];
    for (const c of candidates) {
      const full = path.join(pluginPath, c);
      if (fs.existsSync(full)) return full;
    }

    throw new Error(`No entry point found in ${pluginPath}. Declare "entry" in manifest.`);
  }

  // ── Permission Management ─────────────────────────────────────────────────

  /** Check whether a plugin's required permissions have been granted. */
  private checkPermissions(required: Permission[], pluginName: string): void {
    for (const perm of required) {
      const key = `${pluginName}:${perm}`;
      if (!this.grantedPermissions.has(key)) {
        if (process.env.IMZX_AUTO_APPROVE === 'true' || process.env.IMZX_AUTO_APPROVE === '1') {
          this.grantedPermissions.add(key);
          continue;
        }
        // In non-interactive mode or tests, auto-grant
        if (!process.stdin.isTTY) {
          this.grantedPermissions.add(key);
          continue;
        }
        throw new Error(
          `Plugin "${pluginName}" requires permission "${perm}". ` +
          `Grant via grantPermission("${pluginName}", "${perm}") or set IMZX_AUTO_APPROVE=true.`,
        );
      }
    }
  }

  /** Grant a permission for a specific plugin. */
  grantPermission(pluginName: string, permission: Permission): void {
    this.grantedPermissions.add(`${pluginName}:${permission}`);
  }

  /** Revoke a permission for a specific plugin. */
  revokePermission(pluginName: string, permission: Permission): void {
    this.grantedPermissions.delete(`${pluginName}:${permission}`);
  }

  // ── Plugin Loading ────────────────────────────────────────────────────────

  /**
   * Load a plugin from a local directory (absolute or relative to pluginDir).
   * Also supports npm package names — resolves via node_modules.
   */
  async loadPlugin(pluginPath: string): Promise<Plugin> {
    // Resolve path
    let resolvedPath = pluginPath;
    if (!path.isAbsolute(pluginPath)) {
      // Try as relative to pluginDir first
      const candidate = path.join(this.pluginDir, pluginPath);
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
      } else if (fs.existsSync(path.resolve(pluginPath))) {
        resolvedPath = path.resolve(pluginPath);
      } else {
        // Try as npm package in pluginDir/node_modules
        const nmCandidate = path.join(this.pluginDir, 'node_modules', pluginPath);
        if (fs.existsSync(nmCandidate)) {
          resolvedPath = nmCandidate;
        } else {
          throw new Error(`Plugin not found: ${pluginPath}`);
        }
      }
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Plugin directory does not exist: ${resolvedPath}`);
    }

    const manifest = this.resolveManifest(resolvedPath);

    // Check for duplicate
    if (this.plugins.has(manifest.name)) {
      await this.unloadPlugin(manifest.name);
    }

    // Check permissions
    this.checkPermissions(manifest.permissions, manifest.name);

    // Resolve and dynamic-import entry point
    const entryPath = this.resolveEntry(resolvedPath, manifest);
    let mod: Record<string, unknown>;

    try {
      mod = await import(pathToFileURL(entryPath).href);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const plugin: Plugin = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        permissions: manifest.permissions,
        tools: [],
        hooks: [],
        personas: manifest.personas ?? [],
        pluginPath: resolvedPath,
        loadedAt: new Date().toISOString(),
        status: 'error',
        error: errorMsg,
      };
      this.plugins.set(manifest.name, plugin);
      this.emit('plugin:error', { name: manifest.name, error: errorMsg });
      return plugin;
    }

    // Bind tool handlers from module exports
    const tools: ToolDef[] = manifest.tools.map((t) => {
      const modRec = mod as Record<string, unknown>;
      const modDefault = modRec.default as Record<string, unknown> | undefined;
      const exported = (modRec[t.function.name] ?? modDefault?.[t.function.name]) as
        | ((args: Record<string, unknown>) => Promise<string> | string)
        | undefined;

      if (exported) {
        return {
          ...t,
          function: {
            ...t.function,
            // Attach handler via a non-serializable side channel
            _handler: exported,
          },
        } as ToolDef & { function: { _handler: Function } };
      }
      return t;
    });

    // Resolve hooks
    const hooks: PluginHookDef[] = [];
    if (manifest.hooks) {
      for (const h of manifest.hooks) {
        const modRec = mod as Record<string, unknown>;
        const modDefault = modRec.default as Record<string, unknown> | undefined;
        const handler = (modRec[h.handler] ?? modDefault?.[h.handler]) as HookHandler | undefined;
        if (handler) {
          hooks.push({ name: h.name, handler, priority: h.priority });
        }
      }
    }

    const plugin: Plugin = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      permissions: manifest.permissions,
      tools,
      hooks,
      personas: manifest.personas ?? [],
      pluginPath: resolvedPath,
      loadedAt: new Date().toISOString(),
      status: 'active',
    };

    this.plugins.set(manifest.name, plugin);
    this.emit('plugin:loaded', { name: manifest.name, version: manifest.version });
    return plugin;
  }

  /**
   * Unload a plugin by name, calling its dispose() if present.
   */
  unloadPlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    plugin.dispose?.();
    this.plugins.delete(name);
    this.emit('plugin:unloaded', { name });
  }

  /**
   * List all loaded plugins.
   */
  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a single plugin by name.
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  // ── Aggregate Accessors ───────────────────────────────────────────────────

  /**
   * Aggregate ToolDef arrays from all active plugins.
   * Returns OpenAI function-calling format compatible definitions.
   */
  getTools(): ToolDef[] {
    const tools: ToolDef[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.status === 'active') {
        tools.push(...plugin.tools);
      }
    }
    return tools;
  }

  /**
   * Aggregate hook definitions from all active plugins.
   * Sorted by priority (lower = runs first).
   */
  getHooks(): PluginHookDef[] {
    const hooks: PluginHookDef[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.status === 'active') {
        hooks.push(...plugin.hooks);
      }
    }
    return hooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Aggregate persona definitions from all active plugins.
   */
  getPersonas(): PersonaDef[] {
    const personas: PersonaDef[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.status === 'active' && plugin.personas) {
        personas.push(...plugin.personas);
      }
    }
    return personas;
  }

  // ── Hook Pipeline ─────────────────────────────────────────────────────────

  /**
   * Run a hook pipeline through all registered handlers for the given hook name.
   * Each handler receives (and may mutate) the context object.
   * Returns the final context after all handlers have run.
   */
  async runHook(hookName: HookName, context: HookContext): Promise<HookContext> {
    const hooks = this.getHooks().filter((h) => h.name === hookName);
    let ctx = { ...context, hook: hookName };

    for (const h of hooks) {
      try {
        const result = await h.handler(ctx);
        if (result && typeof result === 'object') {
          ctx = { ...ctx, ...result };
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.emit('hook:error', { hook: hookName, error: errMsg });
        // Continue pipeline — don't let one bad hook break everything
      }
    }

    return ctx;
  }

  /**
   * Execute a plugin tool by name with sandbox support.
   * Runs the pre_tool_use / post_tool_use hook pipeline around execution.
   */
  async executePluginTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: { sandboxed?: boolean; timeout?: number },
  ): Promise<string> {
    // Find tool across plugins
    let handler: ((a: Record<string, unknown>) => Promise<string> | string) | undefined;
    let plugin: Plugin | undefined;

    for (const p of this.plugins.values()) {
      if (p.status !== 'active') continue;
      const t = p.tools.find(
        (tool) => (tool as any).function.name === toolName,
      ) as any;
      if (t?.function?._handler) {
        handler = t.function._handler;
        plugin = p;
        break;
      }
    }

    if (!handler) {
      throw new Error(`Plugin tool "${toolName}" not found or has no handler`);
    }

    // Pre-tool hook
    const preCtx = await this.runHook('pre_tool_use', {
      hook: 'pre_tool_use',
      toolName,
      args: { ...args },
    });
    const finalArgs = (preCtx.args as Record<string, unknown>) ?? args;

    let result: string;

    if (options?.sandboxed && plugin) {
      // Run in sandboxed subprocess
      const entryPath = this.resolveEntry(plugin.pluginPath, this.resolveManifest(plugin.pluginPath));
      result = await runSandboxed(entryPath, toolName, finalArgs, options.timeout);
    } else {
      result = await handler(finalArgs);
    }

    // Post-tool hook
    const postCtx = await this.runHook('post_tool_use', {
      hook: 'post_tool_use',
      toolName,
      args: finalArgs,
      result,
    });

    return typeof postCtx.result === 'string' ? postCtx.result : result;
  }

  // ── Install / Uninstall ───────────────────────────────────────────────────

  /**
   * Install a plugin from npm into the plugin directory.
   */
  async installPlugin(packageName: string): Promise<void> {
    const pluginDir = this.pluginDir;
    fs.mkdirSync(pluginDir, { recursive: true });

    try {
      execFileSync('npm', ['install', packageName, '--prefix', pluginDir], {
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to install "${packageName}": ${msg}`);
    }

    // Try to auto-load the installed plugin
    const installedDir = path.join(pluginDir, 'node_modules', packageName);
    if (fs.existsSync(installedDir)) {
      await this.loadPlugin(installedDir);
    }

    this.emit('plugin:installed', { name: packageName });
  }

  /**
   * Uninstall a plugin: unload + remove from node_modules.
   */
  async uninstallPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      this.unloadPlugin(name);
    }

    const pkgDir = path.join(this.pluginDir, 'node_modules', name);
    if (fs.existsSync(pkgDir)) {
      await fsp.rm(pkgDir, { recursive: true, force: true });
    }

    this.emit('plugin:uninstalled', { name });
  }

  // ── Hot Reload ────────────────────────────────────────────────────────────

  /**
   * Start watching the plugin directory for changes.
   * Modified subdirectories trigger a reload of that plugin.
   */
  startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = fs.watch(this.pluginDir, { recursive: false }, async (event, filename) => {
        if (!filename) return;

        const changedPath = path.join(this.pluginDir, filename);

        // Debounce: wait a bit for file writes to settle
        await new Promise((r) => setTimeout(r, 200));

        // Check which plugin directory was affected
        for (const plugin of this.plugins.values()) {
          if (changedPath.startsWith(plugin.pluginPath + path.sep) || changedPath === plugin.pluginPath) {
            try {
              this.emit('plugin:reloading', { name: plugin.name });
              await this.loadPlugin(plugin.pluginPath);
              this.emit('plugin:reloaded', { name: plugin.name });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              this.emit('plugin:error', { name: plugin.name, error: msg });
            }
            return;
          }
        }

        // New directory added — try to load it
        if (fs.existsSync(changedPath) && fs.statSync(changedPath).isDirectory()) {
          try {
            await this.loadPlugin(changedPath);
          } catch {
            // Not a valid plugin directory — ignore
          }
        }
      });

      this.emit('watcher:started', { path: this.pluginDir });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('watcher:error', { error: msg });
    }
  }

  /**
   * Stop watching the plugin directory.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.emit('watcher:stopped');
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Load all plugins from the plugin directory and optionally start watching.
   */
  async initialize(options?: { watch?: boolean }): Promise<Plugin[]> {
    const loaded: Plugin[] = [];

    if (!fs.existsSync(this.pluginDir)) {
      return loaded;
    }

    const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(this.pluginDir, entry.name);

      try {
        const plugin = await this.loadPlugin(fullPath);
        loaded.push(plugin);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit('plugin:error', { name: entry.name, error: msg });
      }
    }

    // Also check node_modules for installed plugins
    const nmDir = path.join(this.pluginDir, 'node_modules');
    if (fs.existsSync(nmDir)) {
      const nmEntries = fs.readdirSync(nmDir, { withFileTypes: true });
      for (const entry of nmEntries) {
        if (!entry.isDirectory()) continue;
        // Skip scoped package directory markers
        if (entry.name.startsWith('@')) {
          const scopeDir = path.join(nmDir, entry.name);
          const scopedEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if (!scoped.isDirectory()) continue;
            const fullPath = path.join(scopeDir, scoped.name);
            try {
              const plugin = await this.loadPlugin(fullPath);
              loaded.push(plugin);
            } catch {
              // Not a valid plugin
            }
          }
          continue;
        }
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(nmDir, entry.name);
        try {
          const plugin = await this.loadPlugin(fullPath);
          loaded.push(plugin);
        } catch {
          // Not a valid plugin — skip
        }
      }
    }

    if (options?.watch) {
      this.startWatching();
    }

    return loaded;
  }

  /**
   * Full shutdown: unload all plugins, stop watcher, clean up.
   */
  async shutdown(): Promise<void> {
    this.stopWatching();

    for (const name of Array.from(this.plugins.keys())) {
      this.unloadPlugin(name);
    }

    this.removeAllListeners();
  }
}

// ─── Convenience Exports ────────────────────────────────────────────────────────

/**
 * Create a plugin manifest object with validation.
 */
export function createManifest(input: unknown): PluginManifest {
  return PluginManifestSchema.parse(input);
}

/**
 * Quick-start helper: create a PluginManager, initialise, and return it.
 */
export async function createPluginManager(
  baseDir?: string,
  options?: { watch?: boolean },
): Promise<PluginManager> {
  const manager = new PluginManager(baseDir);
  await manager.initialize(options);
  return manager;
}

export default PluginManager;
