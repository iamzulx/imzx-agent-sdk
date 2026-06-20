/**
 * Auth Manager — Scoped API keys, audit logging, IP allowlist.
 *
 * Features:
 * - Multi-key with scoped permissions (full, read, write, mcp, a2a)
 * - Keys stored as SHA-256 hashes only (raw key returned once at generation)
 * - Auth event audit log (JSONL append-only)
 * - IP allowlist with CIDR support
 * - Key rotation and revocation
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export type KeyScope = 'full' | 'read' | 'write' | 'mcp' | 'a2a' | string;

export interface StoredKey {
  id: string;
  hash: string;
  scope: KeyScope | KeyScope[];
  label: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
}

export interface AuthEvent {
  timestamp: string;
  eventType: 'auth_success' | 'auth_failed' | 'key_generated' | 'key_revoked' | 'key_rotated' | 'rate_limited';
  endpoint: string;
  ip: string;
  keyId?: string;
  reason?: string;
}

export interface KeyGenerationResult {
  rawKey: string;
  key: StoredKey;
}

export interface AuthManagerConfig {
  baseDir?: string;
  autoSaveIntervalMs?: number;
  autoFlushAuditAfter?: number;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/** SHA-256 hash of a key (hex). */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Generate a key ID like key_full_a1b2c3. */
export function generateKeyId(scope: string): string {
  const s = typeof scope === 'string' ? scope.replace(/[^a-z0-9]/gi, '') : 'custom';
  return `key_${s}_${randomBytes(3).toString('hex')}`;
}

/** Generate a cryptographically secure API key. */
export function generateRawKey(): string {
  return `imzx_${randomBytes(24).toString('base64url')}`;
}

/** Check if an IP matches a CIDR range. */
export function cidrMatch(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip === cidr;
  const [base, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipNum = ipToNumber(ip);
  const baseNum = ipToNumber(base);
  if (ipNum === null || baseNum === null) return false;

  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const p = parseInt(parts[i], 10);
    if (isNaN(p) || p < 0 || p > 255) return null;
    num = (num << 8) | p;
  }
  return num >>> 0;
}

/** Check if IP is allowed by the allowlist. Empty/null = allow all. */
export function checkIP(ip: string, allowedIPs?: string[]): boolean {
  if (!allowedIPs || allowedIPs.length === 0) return true;
  return allowedIPs.some(rule => {
    if (rule.includes('/')) return cidrMatch(ip, rule);
    return ip === rule;
  });
}

/** Check if a key has the required scope. */
export function checkScope(stored: StoredKey, requiredScope: string): boolean {
  const scopes = Array.isArray(stored.scope) ? stored.scope : [stored.scope];
  if (scopes.includes('full')) return true;
  return scopes.includes(requiredScope);
}

// ─── Audit Logger ────────────────────────────────────────────────────────────

class AuditLogger {
  private logPath: string;
  private buffer: AuthEvent[] = [];
  private flushThreshold: number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(logPath: string, flushAfter: number = 10) {
    this.logPath = logPath;
    this.flushThreshold = flushAfter;
    mkdirSync(dirname(logPath), { recursive: true });
  }

  log(event: AuthEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.flushThreshold) this.flush();
    else this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flush(); this.flushTimer = null; }, 30_000);
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.map(e => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(this.logPath, lines, 'utf-8');
    this.buffer = [];
  }
}

// ─── AuthManager ─────────────────────────────────────────────────────────────

export class AuthManager {
  private keys: Map<string, StoredKey> = new Map(); // hash -> StoredKey
  private keysPath: string;
  private dirty: boolean = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private audit: AuditLogger;
  private allowedIPs: string[] = [];

  constructor(config: AuthManagerConfig = {}) {
    const baseDir = config.baseDir || join(process.cwd(), '.imzx');
    this.keysPath = join(baseDir, 'auth', 'keys.json');
    this.audit = new AuditLogger(join(baseDir, 'logs', 'auth.jsonl'), config.autoFlushAuditAfter ?? 10);
    this.loadKeys();
  }

  // ── Key Persistence ──────────────────────────────────────────────────────

  private loadKeys(): void {
    try {
      if (existsSync(this.keysPath)) {
        const data = JSON.parse(readFileSync(this.keysPath, 'utf-8')) as StoredKey[];
        for (const k of data) this.keys.set(k.hash, k);
      }
    } catch { /* start fresh on corruption */ }
  }

  private saveKeys(): void {
    if (this.saveTimer) return;
    this.dirty = true;
    this.saveTimer = setTimeout(() => {
      try {
        mkdirSync(dirname(this.keysPath), { recursive: true });
        writeFileSync(this.keysPath, JSON.stringify([...this.keys.values()], null, 2), 'utf-8');
        this.dirty = false;
      } catch { /* ignore write errors */ }
      this.saveTimer = null;
    }, 1_000);
  }

  // ── Key Management ───────────────────────────────────────────────────────

  /** Generate a new scoped API key. Returns raw key ONCE — never stored. */
  generateKey(options: { scope: KeyScope | KeyScope[]; label: string; expiresDays?: number }): KeyGenerationResult {
    const rawKey = generateRawKey();
    const h = hashKey(rawKey);
    const now = new Date().toISOString();
    const key: StoredKey = {
      id: generateKeyId(typeof options.scope === 'string' ? options.scope : 'multi'),
      hash: h,
      scope: options.scope,
      label: options.label,
      createdAt: now,
      expiresAt: options.expiresDays ? new Date(Date.now() + options.expiresDays * 86_400_000).toISOString() : null,
      lastUsedAt: null,
      usageCount: 0,
    };
    this.keys.set(h, key);
    this.saveKeys();
    this.audit.log({
      timestamp: now, eventType: 'key_generated', endpoint: 'auth-manager',
      ip: 'local', keyId: key.id,
    });
    return { rawKey, key: { ...key, hash: '' } }; // Return key without hash
  }

  /** Validate a raw API key. Returns StoredKey if valid, null otherwise. */
  validateKey(rawKey: string, endpoint?: string, ip?: string): StoredKey | null {
    const h = hashKey(rawKey);
    const key = this.keys.get(h);
    if (!key) {
      this.audit.log({
        timestamp: new Date().toISOString(), eventType: 'auth_failed',
        endpoint: endpoint || 'unknown', ip: ip || 'unknown',
        reason: 'invalid_key',
      });
      return null;
    }
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      this.audit.log({
        timestamp: new Date().toISOString(), eventType: 'auth_failed',
        endpoint: endpoint || 'unknown', ip: ip || 'unknown',
        keyId: key.id, reason: 'expired_key',
      });
      return null;
    }
    key.lastUsedAt = new Date().toISOString();
    key.usageCount++;
    this.saveKeys();
    this.audit.log({
      timestamp: new Date().toISOString(), eventType: 'auth_success',
      endpoint: endpoint || 'unknown', ip: ip || 'unknown', keyId: key.id,
    });
    return { ...key, hash: '' }; // Return without hash
  }

  /** Revoke a key by ID. */
  revokeKey(id: string): boolean {
    for (const [h, k] of this.keys) {
      if (k.id === id) {
        this.keys.delete(h);
        this.saveKeys();
        this.audit.log({
          timestamp: new Date().toISOString(), eventType: 'key_revoked',
          endpoint: 'auth-manager', ip: 'local', keyId: id,
        });
        return true;
      }
    }
    return false;
  }

  /** List all keys (without hashes). */
  listKeys(): Omit<StoredKey, 'hash'>[] {
    return [...this.keys.values()].map(({ hash, ...rest }) => rest);
  }

  /** Rotate all keys: revoke all, generate new one per unique scope. */
  rotateAllKeys(): KeyGenerationResult[] {
    const scopes = new Set<KeyScope>();
    for (const k of this.keys.values()) {
      if (Array.isArray(k.scope)) k.scope.forEach(s => scopes.add(s));
      else scopes.add(k.scope);
    }
    // Revoke all
    this.keys.clear();
    this.saveKeys();
    // Generate new
    const results: KeyGenerationResult[] = [];
    for (const scope of scopes) {
      const r = this.generateKey({ scope, label: `rotated_${String(scope)}` });
      results.push(r);
    }
    this.audit.log({
      timestamp: new Date().toISOString(), eventType: 'key_rotated',
      endpoint: 'auth-manager', ip: 'local',
    });
    return results;
  }

  // ── IP Allowlist ─────────────────────────────────────────────────────────

  setAllowedIPs(ips: string[]): void {
    this.allowedIPs = ips;
  }

  isIPAllowed(ip: string): boolean {
    return checkIP(ip, this.allowedIPs);
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  logAudit(event: Omit<AuthEvent, 'timestamp'>): void {
    this.audit.log({ ...event, timestamp: new Date().toISOString() });
  }

  flushAudit(): void {
    this.audit.flush();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: AuthManager | null = null;

export function getAuthManager(config?: AuthManagerConfig): AuthManager {
  if (!_instance) _instance = new AuthManager(config);
  return _instance;
}
