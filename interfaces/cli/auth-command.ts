/**
 * Auth Command — CLI key management.
 * imzx auth generate --label X --scope full --expires 30
 * imzx auth list
 * imzx auth revoke <key-id>
 * imzx auth rotate
 * imzx auth audit [--limit 50]
 */

import { getAuthManager } from '../../adapters/security/auth-manager.js';
import type { KeyScope } from '../../adapters/security/auth-manager.js';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
};

export class AuthCommand {
  private authManager = getAuthManager();

  async handle(args: string[]): Promise<void> {
    const cmd = args[0];
    switch (cmd) {
      case 'generate': return this.generate(args.slice(1));
      case 'list': return this.list();
      case 'revoke': return this.revoke(args.slice(1));
      case 'rotate': return this.rotate();
      case 'audit': return this.audit(args.slice(1));
      default: this.showHelp();
    }
  }

  private async generate(args: string[]): Promise<void> {
    const label = this.parseArg(args, '--label') || 'cli-generated';
    const scopeStr = this.parseArg(args, '--scope') || 'full';
    const expires = parseInt(this.parseArg(args, '--expires') || '0', 10);
    const scopes: KeyScope | KeyScope[] = scopeStr.includes(',') ? scopeStr.split(',').map(s => s.trim()) : scopeStr;

    const result = this.authManager.generateKey({
      scope: scopes,
      label,
      expiresDays: expires > 0 ? expires : undefined,
    });

    const scopeDisplay = Array.isArray(result.key.scope) ? result.key.scope.join(', ') : result.key.scope;
    const expiresDisplay = result.key.expiresAt ? new Date(result.key.expiresAt).toLocaleDateString() : 'never';

    console.log(`\n${c.green}${c.bold}✓ Key generated${c.reset}`);
    console.log(`  ${c.bold}ID:${c.reset} ${result.key.id}`);
    console.log(`  ${c.bold}Label:${c.reset} ${result.key.label}`);
    console.log(`  ${c.bold}Scope:${c.reset} ${scopeDisplay}`);
    console.log(`  ${c.bold}Expires:${c.reset} ${expiresDisplay}`);
    console.log(`\n${c.yellow}${c.bold}⚠ SAVE THIS KEY NOW — it will never be shown again:${c.reset}`);
    console.log(`  ${c.bold}${c.cyan}${result.rawKey}${c.reset}\n`);
  }

  private list(): void {
    const keys = this.authManager.listKeys();
    if (keys.length === 0) { console.log(`${c.dim}No keys configured.${c.reset}`); return; }
    console.log(`\n${c.bold}Auth Keys:${c.reset}\n`);
    for (const k of keys) {
      const status = k.expiresAt && new Date(k.expiresAt) < new Date() ? `${c.red}EXPIRED${c.reset}` : `${c.green}ACTIVE${c.reset}`;
      const scopeDisplay = Array.isArray(k.scope) ? k.scope.join(', ') : k.scope;
      console.log(`  ${c.bold}${k.id}${c.reset} ${status}`);
      console.log(`    Label: ${k.label} | Scope: ${scopeDisplay} | Created: ${k.createdAt}`);
      console.log(`    Used: ${k.usageCount}x | Last: ${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}`);
    }
    console.log();
  }

  private revoke(args: string[]): void {
    const id = args[0];
    if (!id) { console.log(`${c.red}Usage: imzx auth revoke <key-id>${c.reset}`); return; }
    if (this.authManager.revokeKey(id)) {
      console.log(`${c.green}✓ Key ${id} revoked${c.reset}`);
    } else {
      console.log(`${c.red}✗ Key ${id} not found${c.reset}`);
    }
  }

  private rotate(): void {
    const results = this.authManager.rotateAllKeys();
    if (results.length === 0) { console.log(`${c.dim}No keys to rotate.${c.reset}`); return; }
    console.log(`\n${c.yellow}${c.bold}⚠ All keys rotated. Old keys revoked.${c.reset}\n`);
    for (const r of results) {
      console.log(`  ${c.bold}${r.key.id}${c.reset} — ${c.bold}${c.cyan}${r.rawKey}${c.reset}`);
    }
    console.log(`\n${c.yellow}⚠ Save these keys now — old keys are invalidated.${c.reset}\n`);
  }

  private audit(args: string[]): void {
    this.authManager.flushAudit();
    console.log(`${c.dim}Auth events logged to .imzx/logs/auth.jsonl${c.reset}`);
    console.log(`${c.dim}Use 'cat .imzx/logs/auth.jsonl | tail -20' to view recent events.${c.reset}`);
  }

  private showHelp(): void {
    console.log(`\n${c.bold}imzx auth${c.reset} — Key Management\n`);
    console.log(`  ${c.bold}generate${c.reset} [--label X] [--scope S] [--expires N]  Generate new key`);
    console.log(`  ${c.bold}list${c.reset}                                            List all keys`);
    console.log(`  ${c.bold}revoke${c.reset} <key-id>                                   Revoke a key`);
    console.log(`  ${c.bold}rotate${c.reset}                                            Rotate all keys`);
    console.log(`  ${c.bold}audit${c.reset}                                             View auth events\n`);
  }

  private parseArg(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  }
}
