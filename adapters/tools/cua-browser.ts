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

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
    const commands = [
      `termux-screenshot "${path}"`,
      `scrot "${path}"`,
      `screencapture -x "${path}"`,
      `import -window root "${path}"`,
    ];

    for (const cmd of commands) {
      try {
        execSync(cmd, { timeout: 10_000, stdio: 'pipe' });
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
    // Use curl for HTTP fetching (works on Termux without puppeteer)
    const escapedUrl = url.replace(/"/g, '\\"');
    const result = execSync(
      `curl -sL --max-time ${Math.floor(this.config.timeoutMs / 1000)} -A "${this.config.userAgent}" "${escapedUrl}"`,
      { timeout: this.config.timeoutMs, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    );
    return result;
  }

  private extractContent(html: string, url: string): PageContent {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : 'Untitled';

    // Extract links
    const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const links: Array<{ text: string; href: string }> = [];
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) && links.length < 100) {
      links.push({
        text: linkMatch[2].replace(/<[^>]+>/g, '').trim().slice(0, 200),
        href: linkMatch[1],
      });
    }

    // Extract metadata
    const metadata: Record<string, string> = {};
    const metaRegex = /<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']+)["']/gi;
    let metaMatch;
    while ((metaMatch = metaRegex.exec(html))) {
      metadata[metaMatch[1]] = metaMatch[2];
    }

    // Strip HTML tags for text content
    const content = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
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
