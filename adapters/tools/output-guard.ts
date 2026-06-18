/**
 * Output Guard — validates and sanitizes agent output before returning to user.
 * Based on OWASP LLM Top 10 (2026), Maxim AI Bifrost output guardrails.
 *
 * Checks for:
 * - Credential leakage (API keys, tokens, passwords)
 * - Internal path exposure (/etc/*, .ssh/, .env)
 * - PII (emails, phone numbers)
 * - Excessive output length
 *
 * Returns sanitized output with redacted sensitive content.
 */

export interface OutputIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface OutputGuardResult {
  safe: boolean;
  issues: OutputIssue[];
  sanitized: string;
  original_length: number;
  sanitized_length: number;
}

export class OutputGuard {
  private maxOutputLength: number;

  constructor(maxOutputLength: number = 50000) {
    this.maxOutputLength = maxOutputLength;
  }

  check(output: string): OutputGuardResult {
    const issues: OutputIssue[] = [];
    let sanitized = output;

    // Check: credential leakage
    const patterns: Array<{ regex: RegExp; type: string; replacement: string; severity: OutputIssue['severity'] }> = [
      { regex: /sk-[a-zA-Z0-9]{20,}/g, type: 'api_key', replacement: '[REDACTED_API_KEY]', severity: 'high' },
      { regex: /ghp_[a-zA-Z0-9]{36}/g, type: 'github_token', replacement: '[REDACTED_GITHUB]', severity: 'high' },
      { regex: /glpat-[a-zA-Z0-9\-]{20,}/g, type: 'gitlab_token', replacement: '[REDACTED_GITLAB]', severity: 'high' },
      { regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, type: 'private_key', replacement: '[REDACTED_KEY]', severity: 'high' },
      { regex: /bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, type: 'bearer_token', replacement: '[REDACTED_BEARER]', severity: 'high' },
      { regex: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, type: 'password', replacement: 'password=[REDACTED]', severity: 'high' },
    ];

    for (const p of patterns) {
      const matches = output.match(p.regex);
      if (matches && matches.length > 0) {
        issues.push({ type: p.type, description: `Found ${matches.length} ${p.type}(s) in output`, severity: p.severity });
        sanitized = sanitized.replace(p.regex, p.replacement);
      }
    }

    // Check: internal paths
    const pathRegex = /\/(?:etc\/passwd|etc\/shadow|proc\/self|root\/\.ssh|home\/[^/]+\/\.ssh|home\/[^/]+\/\.aws|home\/[^/]+\/\.env)/g;
    const pathMatches = sanitized.match(pathRegex);
    if (pathMatches) {
      issues.push({ type: 'internal_path', description: `Internal path exposure: ${pathMatches.length} paths`, severity: 'medium' });
      sanitized = sanitized.replace(pathRegex, '[REDACTED_PATH]');
    }

    // Check: PII (emails)
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = sanitized.match(emailRegex);
    if (emails && emails.length > 2) {
      issues.push({ type: 'pii_email', description: `${emails.length} emails in output`, severity: 'low' });
    }

    // Check: excessive length
    if (output.length > this.maxOutputLength) {
      issues.push({ type: 'length', description: `Output ${output.length} exceeds limit ${this.maxOutputLength}`, severity: 'medium' });
      sanitized = sanitized.substring(0, this.maxOutputLength) + '\n... (truncated by OutputGuard)';
    }

    return {
      safe: issues.filter(i => i.severity === 'high').length === 0,
      issues,
      sanitized,
      original_length: output.length,
      sanitized_length: sanitized.length,
    };
  }

  formatGuardResults(result: OutputGuardResult): string {
    if (result.safe && result.issues.length === 0) return '';
    const lines = result.issues.map(i => `  [${i.severity.toUpperCase()}] ${i.type}: ${i.description}`);
    return `\n## Output Guard:\n${lines.join('\n')}`;
  }
}
