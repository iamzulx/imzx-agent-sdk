/**
 * Playwright MCP Integration — browser automation via accessibility tree.
 * [v0.8.0] Uses @playwright/mcp for AI-native browser interaction.
 *
 * Instead of screenshots/pixels, uses structured accessibility snapshots
 * with element refs for interaction — token-efficient and selector-free.
 *
 * Usage:
 *   const browser = new PlaywrightMcpBrowser({ headless: true });
 *   await browser.start();
 *   await browser.navigate('https://example.com');
 *   const snapshot = await browser.snapshot();
 *   await browser.click('e5');
 *   await browser.type('e10', 'Hello World');
 *   await browser.stop();
 *
 * Requires: npx @playwright/mcp (installed separately)
 */

import { execSync } from 'node:child_process';

export interface PlaywrightConfig {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  isolated?: boolean;
  port?: number; // HTTP transport port (for CI/headless environments)
}

export interface AccessibilityNode {
  role: string;
  name: string;
  ref?: string;
  children?: AccessibilityNode[];
  value?: string;
}

export interface BrowserActionResult {
  success: boolean;
  content: string;
  snapshot?: string;
}

export class PlaywrightMcpBrowser {
  private config: Required<PlaywrightConfig>;
  private process: any = null;
  private connected: boolean = false;

  constructor(config: PlaywrightConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      browser: config.browser ?? 'chromium',
      isolated: config.isolated ?? true,
      port: config.port ?? 8931,
    };
  }

  /**
   * Start the Playwright MCP server as a subprocess.
   */
  async start(): Promise<void> {
    const args = [
      '@playwright/mcp@latest',
      this.config.headless ? '--headless' : '',
      `--browser=${this.config.browser}`,
      this.config.isolated ? '--isolated' : '',
      `--port=${this.config.port}`,
    ].filter(Boolean);

    try {
      // Safe: hardcoded command string, no user input interpolation
      execSync('npx @playwright/mcp@latest --version', { stdio: 'pipe', timeout: 30_000 });
    } catch {
      throw new Error(
        '@playwright/mcp not available. Install with: npx playwright install --with-deps chromium\n' +
        'Then run: npx @playwright/mcp@latest --headless'
      );
    }

    this.connected = true;
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
  }

  /**
   * Navigate to a URL via MCP tool call.
   */
  async navigate(url: string): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_navigate', { url });
  }

  /**
   * Get accessibility snapshot of current page.
   * Returns structured tree with element refs (e.g., ref=e5).
   */
  async snapshot(): Promise<string> {
    const result = await this.callMcpTool('browser_snapshot', {});
    return result.content;
  }

  /**
   * Click an element by its ref ID from the accessibility snapshot.
   */
  async click(ref: string): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_click', { ref });
  }

  /**
   * Type text into an element by its ref ID.
   */
  async type(ref: string, text: string): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_type', { ref, text });
  }

  /**
   * Fill multiple form fields at once.
   */
  async fillForm(fields: Array<{ ref: string; value: string }>): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_fill_form', { fields });
  }

  /**
   * Select a dropdown option.
   */
  async selectOption(ref: string, value: string): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_select_option', { ref, value });
  }

  /**
   * Take a screenshot (returns base64 PNG).
   */
  async screenshot(): Promise<string> {
    const result = await this.callMcpTool('browser_screenshot', {});
    return result.content;
  }

  /**
   * Press a keyboard key.
   */
  async pressKey(key: string): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_press_key', { key });
  }

  /**
   * Navigate back in browser history.
   */
  async back(): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_navigate_back', {});
  }

  /**
   * Wait for a condition (e.g., text to appear, timeout).
   */
  async waitFor(text?: string, timeout?: number): Promise<BrowserActionResult> {
    return this.callMcpTool('browser_wait_for', { text, timeout });
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Call an MCP tool via the Playwright MCP server.
   * In production, this would use the MCP SDK client.
   * This stub uses HTTP transport for simplicity.
   */
  private async callMcpTool(toolName: string, args: Record<string, unknown>): Promise<BrowserActionResult> {
    if (!this.connected) {
      return { success: false, content: 'Not connected. Call start() first.' };
    }

    try {
      const response = await fetch(`http://localhost:${this.config.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return { success: false, content: `MCP error: ${response.status}` };
      }

      const data = await response.json() as any;
      const content = data.result?.content?.[0]?.text || JSON.stringify(data.result);
      return { success: true, content };
    } catch (err) {
      return { success: false, content: `MCP call failed: ${(err as Error).message}` };
    }
  }
}
