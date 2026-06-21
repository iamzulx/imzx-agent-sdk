/**
 * Computer-Using Agent (CUA) — browser automation tools for the agent.
 * Uses native Node.js APIs + curl for HTTP-based page fetching.
 *
 * Features:
 * - Navigate to URLs and extract page content
 * - Screenshot via platform-specific tools
 * - DOM querying (basic CSS selectors)
 * - Form interaction (fill, click, submit)
 * - Page content extraction (text, links, metadata)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrowserConfig {
  /** Directory to store screenshots. Default: .imzx/screenshots */
  screenshotDir?: string;
  /** Custom user agent string */
  userAgent?: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

export interface PageContent {
  url: string;
  title: string;
  content: string;
  links: Array<{ text: string; href: string }>;
  metadata: Record<string, string>;
  fetchedAt: string;
}

export interface ScreenshotResult {
  path: string;
  timestamp: string;
  width?: number;
  height?: number;
}

export interface FormField {
  selector: string;
  value: string;
  type?: 'text' | 'select' | 'checkbox';
}

// ─── CUA Browser ─────────────────────────────────────────────────────────────

export class CuaBrowser {
  private config: Required<BrowserConfig>;
  private history: PageContent[] = [];
  private currentPage: PageContent | null = null;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      screenshotDir: config.screenshotDir || join(process.cwd(), '.imzx', 'screenshots'),
      userAgent: config.userAgent || 'imzx-agent-sdk/0.6.1 (compatible)',
      timeoutMs: config.timeoutMs ?? 15_000,
    };
    mkdirSync(this.config.screenshotDir, { recursive: true });
  }

  /** Navigate to URL and extract content. */
  async navigate(url: string): Promise<PageContent> {
    try {
      const html = await this.fetchHtml(url);
      const content = this.extractContent(html, url);
      this.history.push(content);
      this.currentPage = content;
      return content;
    } catch (err: unknown) {
      const error: PageContent = {
        url,
        title: 'Error',
        content: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
        links: [],
        metadata: {},
        fetchedAt: new Date().toISOString(),
      };
      this.currentPage = error;
      return error;
    }
  }

  /** Get current page content. */
  getCurrentPage(): PageContent | null {
    return this.currentPage;
  }

  /** Get navigation history. */
  getHistory(): PageContent[] {
    return [...this.history];
  }

  /** Go back to previous page. */
  back(): PageContent | null {
    if (this.history.length < 2) return this.currentPage;
    this.history.pop();
    this.currentPage = this.history[this.history.length - 1] || null;
    return this.currentPage;
  }

  /** Extract all links from current page. */
  getLinks(): Array<{ text: string; href: string }> {
    return this.currentPage?.links || [];
  }

  /** Search page content for a query. */
  searchContent(query: string): string[] {
    if (!this.currentPage) return [];
    const lines = this.currentPage.content.split('\n');
    const results: string[] = [];
    const lower = query.toLowerCase();
    for (const line of lines) {
      if (line.toLowerCase().includes(lower)) {
        results.push(line.trim());
      }
    }
    return results;
  }

  /** Take screenshot (requires platform-specific tool). */
  screenshot(): ScreenshotResult | null {
    const timestamp = new Date().toISOString();
    const filename = `screenshot_${Date.now()}.png`;
    const path = join(this.config.screenshotDir, filename);

    // Try platform-specific screenshot tools
    // [S1 FIX] Use execFileSync with argument arrays — no shell injection
    const commands: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'termux-screenshot', args: [path] },
      { cmd: 'scrot', args: [path] },
      { cmd: 'screencapture', args: ['-x', path] },
      { cmd: 'import', args: ['-window', 'root', path] },
    ];

    for (const { cmd, args } of commands) {
      try {
        execFileSync(cmd, args, { timeout: 10_000, stdio: 'pipe' });
        return { path, timestamp };
      } catch {
        continue;
      }
    }

    return null; // No screenshot tool available
  }

  /** Extract page metadata. */
  getMetadata(): Record<string, string> {
    return this.currentPage?.metadata || {};
  }

  /** Get page summary (first 500 chars of content). */
  getSummary(): string {
    if (!this.currentPage) return 'No page loaded';
    return this.currentPage.content.slice(0, 500) + (this.currentPage.content.length > 500 ? '...' : '');
  }

  // ── Internal Methods ─────────────────────────────────────────────────────

  private async fetchHtml(url: string): Promise<string> {
    // [S1 FIX] Use native fetch() instead of execSync curl — prevents command injection
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    // Block private/internal addresses (SSRF protection)
    const hostname = parsed.hostname;
    const isPrivate = hostname === 'localhost' || hostname === '0.0.0.0'
      || hostname === '::1' || hostname.startsWith('127.')
      || hostname.startsWith('10.') || hostname.startsWith('192.168.')
      || hostname.startsWith('172.16.') || hostname.startsWith('172.17.')
      || hostname.startsWith('172.18.') || hostname.startsWith('172.19.')
      || hostname.startsWith('172.2') || hostname.startsWith('172.30.')
      || hostname.startsWith('172.31.') || hostname.startsWith('169.254.')
      || hostname.startsWith('fd') || hostname.startsWith('fe80');
    if (isPrivate) {
      throw new Error('Access to private/internal addresses is blocked.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(parsed.href, {
        headers: { 'User-Agent': this.config.userAgent },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      return text.slice(0, 5 * 1024 * 1024); // 5MB limit
    } finally {
      clearTimeout(timer);
    }
  }

  private extractContent(html: string, url: string): PageContent {
    // [v0.8.0] Use cheerio for proper DOM parsing instead of regex
    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, nav, footer, header, noscript, iframe').remove();

    // Extract title
    const title = $('title').text().trim().slice(0, 200) || 'Untitled';

    // Extract links (limit 100)
    const links: Array<{ text: string; href: string }> = [];
    $('a[href]').each((_, el) => {
      if (links.length >= 100) return false;
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().slice(0, 200);
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ text, href });
      }
    });

    // Extract metadata from meta tags
    const metadata: Record<string, string> = {};
    $('meta[name], meta[property]').each((_, el) => {
      const name = $(el).attr('name') || $(el).attr('property') || '';
      const content = $(el).attr('content') || '';
      if (name && content) metadata[name] = content;
    });

    // Extract main text content
    const content = $('main, article, [role=main], body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50_000);

    return {
      url,
      title,
      content,
      links,
      metadata,
      fetchedAt: new Date().toISOString(),
    };
  }
}

// ─── CUA Tool Definitions (for agent integration) ────────────────────────────

export function getCuaToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return [
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: 'Navigate to a URL and extract page content (text, links, metadata).',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to navigate to' } },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current screen.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_search',
        description: 'Search current page content for a query.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_links',
        description: 'Get all links from the current page.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];
}
