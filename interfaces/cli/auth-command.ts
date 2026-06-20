/**
 * Auth Command — CLI key management.
 * imzx auth generate --name X --scope full --expires 30
 * imzx auth list
 * imzx auth revoke <key-id>
 * imzx auth rotate <key-id>
 * imzx auth export
 * imzx auth import <file>
 * imzx auth events [--limit 50]
 */

import { getAuthManager, maskKey } from '../../adapters/tools/auth-manager.js';

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
      case 'rotate': return this.rotate(args.slice(1));
      case 'export': return this.exportKeys();
      case 'import': return this.importKeys(args.slice(1));
      case 'events': return this.events(args.slice(1));
      default: this.showHelp();
    }
  }

  private async generate(args: string[]): Promise<void> {
    const name = this.parseArg(args, '--name') || 'key-' + Date.now();
    const scope = this.parseArg(args, '--scope') || 'full';
    const expires = parseInt(this.parseArg(args, '--expires') || '0', 10);
    const scopes = scope.split(',').map(s => s.trim());
    const { key, authKey } = this.authManager.generateKey({ name, scopes, expiresDays: expires > 0 ? expires : undefined });
    console.log(`\n${c.green}${c.bold}✓ Key generated${c.reset}`);
    console.log(`  ${c.bold}Name:${c.reset} ${authKey.name}`);
    console.log(`  ${c.bold}ID:${c.reset} ${authKey.id}`);
    console.log(`  ${c.bold}Scope:${c.reset} ${authKey.scope.join(', ')}`);
    console.log(`  ${c.bold}Expires:${c.reset} ${authKey.expiresAt || 'never'}`);
    console.log(`\n${c.yellow}${c.bold}⚠ SAVE THIS KEY NOW — it will never be shown again:${c.reset}`);
    console.log(`  ${c.bold}${c.cyan}${key}${c.reset}\n`);
    this.authManager.logEvent({
      timestamp: new Date().toISOString(), event: 'auth_success', endpoint: '/auth/generate',
      ip: 'cli', keyHash: authKey.hash, keyName: authKey.name,
    });
  }

  private list(): void {
    const keys = this.authManager.listKeys();
    if (keys.length === 0) { console.log(`${c.dim}No keys configured.${c.reset}`); return; }
    console.log(`\n${c.bold}Auth Keys:${c.reset}\n`);
    for (const k of keys) {
      const status = k.revoked ? `${c.red}REVOKED${c.reset}` : k.expiresAt && new Date(k.expiresAt) < new Date() ? `${c.red}EXPIRED${c.reset}` : `${c.green}ACTIVE${c.reset}`;
      console.log(`  ${c.bold}${k.id}${c.reset} ${status}`);
      console.log(`    Name: ${k.name} | Scope: ${k.scope.join(', ')} | Created: ${k.createdAt}`);
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

  private rotate(args: string[]): void {
    const id = args[0];
    if (!id) { console.log(`${c.red}Usage: imzx auth rotate <key-id>${c.reset}`); return; }
    const result = this.authManager.rotateKey(id);
    if (result) {
      console.log(`${c.green}✓ Key rotated${c.reset}`);
      console.log(`  ${c.yellow}${c.bold}⚠ New key:${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}${result.key}${c.reset}\n`);
    } else {
      console.log(`${c.red}✗ Key ${id} not found${c.reset}`);
    }
  }

  private exportKeys(): void {
    console.log(this.authManager.exportKeys());
  }

  private importKeys(args: string[]): void {
    const file = args[0];
    if (!file) { console.log(`${c.red}Usage: imzx auth import <file>${c.reset}`); return; }
    try {
      const { readFileSync } = require('node:fs');
      this.authManager.importKeys(readFileSync(file, 'utf-8'));
      console.log(`${c.green}✓ Keys imported${c.reset}`);
    } catch (err: any) {
      console.log(`${c.red}✗ Import failed: ${err.message}${c.reset}`);
    }
  }

  private events(args: string[]): void {
    const limit = parseInt(this.parseArg(args, '--limit') || '50', 10);
    const events = this.authManager.getRecentEvents(limit);
    if (events.length === 0) { console.log(`${c.dim}No auth events.${c.reset}`); return; }
    console.log(`\n${c.bold}Recent Auth Events (last ${events.length}):${c.reset}\n`);
    for (const e of events) {
      const color = e.event === 'auth_success' ? c.green : e.event === 'auth_failed' ? c.red : c.yellow;
      console.log(`  ${color}${e.event}${c.reset} | ${e.endpoint} | ${e.ip} | ${e.keyName || maskKey(e.keyHash)} | ${e.reason || ''}`);
    }
    console.log();
  }

  private showHelp(): void {
    console.log(`\n${c.bold}imzx auth${c.reset} — Key Management\n`);
    console.log(`  ${c.bold}generate${c.reset} [--name X] [--scope S] [--expires N]  Generate new key`);
    console.log(`  ${c.bold}list${c.reset}                                              List all keys`);
    console.log(`  ${c.bold}revoke${c.reset} <key-id>                                     Revoke a key`);
    console.log(`  ${c.bold}rotate${c.reset} <key-id>                                     Rotate a key`);
    console.log(`  ${c.bold}export${c.reset}                                              Export keys (JSON)`);
    console.log(`  ${c.bold}import${c.reset} <file>                                       Import keys from file`);
    console.log(`  ${c.bold}events${c.reset} [--limit N]                                  Show auth events\n`);
  }

  private parseArg(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  }
}
