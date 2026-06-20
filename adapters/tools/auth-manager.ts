/**
 * Auth Manager — centralized authentication, key management, IP allowlist, and audit logging.
 * 
 * Features:
 * - Multi-key support with scoped permissions
 * - Key generation, rotation, revocation
 * - Auth event audit log (.imzx/logs/auth.jsonl)
 * - IP allowlist with CIDR support
 * - HMAC request signing utilities
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthKey {
  id: string;
  name: string;
  hash: string;
  scope: string[];
  expiresAt: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface AuthResult {
  valid: boolean;
  keyName?: string;
  scopes: string[];
  reason?: string;
}

export interface AuthEvent {
  timestamp: string;
  event: 'auth_success' | 'auth_failed' | 'auth_expired' | 'auth_revoked' | 'rate_limited' | 'ip_blocked';
  endpoint: string;
  ip: string;
  keyHash: string;
  keyName?: string;
  reason?: string;
  attempts?: number;
}

export interface AuthManagerConfig {
  baseDir?: string;
  defaultScope?: string[];
}

// Scope → endpoint mapping
const SCOPE_ENDPOINTS: Record<string, string[]> = {
  full: ['.*'],
  read: ['/api/run', '/api/stats', '/api/personas', '/api/health', '/api/memory', '/api/skills', '/api/graph', '/api/telemetry'],
  write: ['/api/run', '/api/chat'],
  mcp: ['/mcp/*'],
  a2a: ['/a2a/*'],
  admin: ['/api/config', '/api/auth/*'],
  dashboard: ['/api/memory', '/api/skills', '/api/stats', '/api/telemetry', '/api/graph'],
};

// ─── IP Allowlist ───────────────────────────────────────────────────────────

function parseIPAllowlist(env: string | undefined): Array<{ match: (ip: string) => boolean }> {
  if (!env || !env.trim()) return [];
  return env.split(',').map((entry) => {
    const e = entry.trim();
    // CIDR notation
    if (e.includes('/')) {
      const [base, bitsStr] = e.split('/');
      const bits = parseInt(bitsStr, 10);
      const baseNum = ipToNumber(base);
      const mask = bits === 32 ? 0xffffffff : ~(0xffffffff >> bits);
      return { match: (ip: string) => (ipToNumber(ip) & mask) === (baseNum & mask) };
    }
    // Wildcard
    if (e.includes('*')) {
      const prefix = e.replace(/\*/g, '');
      return { match: (ip: string) => ip.startsWith(prefix) };
    }
    // Exact
    return { match: (ip: string) => ip === e };
  });
}

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateSecureKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function maskKey(key: string): string {
  return key.slice(0, 6) + '...' + key.slice(-4);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, { mode: 0o600, encoding: 'utf-8' });
  fs.renameSync(tmpPath, filePath);
}

// ─── AuthManager ────────────────────────────────────────────────────────────

export class AuthManager {
  private keys: AuthKey[] = [];
  private keysPath: string;
  private authLogPath: string;
  private ipAllowlist: Array<{ match: (ip: string) => boolean }>;
  private failedAttempts: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(config: AuthManagerConfig = {}) {
    const baseDir = config.baseDir || path.join(process.cwd(), '.imzx');
    this.keysPath = path.join(baseDir, 'auth', 'keys.json');
    this.authLogPath = path.join(baseDir, 'logs', 'auth.jsonl');
    ensureDir(path.dirname(this.keysPath));
    ensureDir(path.dirname(this.authLogPath));
    this.ipAllowlist = parseIPAllowlist(process.env.IMZX_ALLOWED_IPS);
    this.loadKeys();
  }

  // ── Key Management ──────────────────────────────────────────────────────

  private loadKeys(): void {
    try {
      if (fs.existsSync(this.keysPath)) {
        this.keys = JSON.parse(fs.readFileSync(this.keysPath, 'utf-8'));
      }
    } catch { /* start empty */ }
  }

  private saveKeys(): void {
    atomicWrite(this.keysPath, JSON.stringify(this.keys, null, 2));
  }

  generateKey(options: { name: string; scopes: string[]; expiresDays?: number }): { key: string; authKey: AuthKey } {
    const rawKey = generateSecureKey();
    const id = 'key_' + crypto.randomBytes(8).toString('hex');
    const authKey: AuthKey = {
      id,
      name: options.name,
      hash: hashKey(rawKey),
      scope: options.scopes.length > 0 ? options.scopes : ['full'],
      expiresAt: options.expiresDays ? new Date(Date.now() + options.expiresDays * 86400000).toISOString() : null,
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    this.keys.push(authKey);
    this.saveKeys();
    return { key: rawKey, authKey };
  }

  checkAuth(token: string): AuthResult {
    if (!token) return { valid: false, scopes: [], reason: 'No token provided' };
    const hash = hashKey(token);
    const key = this.keys.find((k) => k.hash === hash);
    if (!key) return { valid: false, scopes: [], reason: 'Invalid key' };
    if (key.revoked) return { valid: false, scopes: [], reason: 'Key revoked' };
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return { valid: false, scopes: [], reason: 'Key expired' };
    return { valid: true, keyName: key.name, scopes: key.scope };
  }

  checkScope(result: AuthResult, endpoint: string): boolean {
    if (!result.valid) return false;
    for (const scope of result.scopes) {
      const allowed = SCOPE_ENDPOINTS[scope];
      if (!allowed) continue;
      if (allowed.includes('.*')) return true;
      for (const pattern of allowed) {
        if (pattern.endsWith('/*') && endpoint.startsWith(pattern.slice(0, -1))) return true;
        if (pattern === endpoint) return true;
      }
    }
    return false;
  }

  listKeys(): Array<{ id: string; name: string; scope: string[]; expiresAt: string | null; createdAt: string; revoked: boolean }> {
    return this.keys.map((k) => ({
      id: k.id, name: k.name, scope: k.scope, expiresAt: k.expiresAt, createdAt: k.createdAt, revoked: k.revoked,
    }));
  }

  revokeKey(id: string): boolean {
    const key = this.keys.find((k) => k.id === id);
    if (!key) return false;
    key.revoked = true;
    this.saveKeys();
    return true;
  }

  rotateKey(id: string): { key: string; authKey: AuthKey } | null {
    const oldKey = this.keys.find((k) => k.id === id);
    if (!oldKey) return null;
    oldKey.revoked = true;
    const { key, authKey } = this.generateKey({ name: oldKey.name + ' (rotated)', scopes: oldKey.scope, expiresDays: oldKey.expiresAt ? Math.ceil((new Date(oldKey.expiresAt).getTime() - Date.now()) / 86400000) : undefined });
    this.saveKeys();
    return { key, authKey };
  }

  // ── IP Allowlist ─────────────────────────────────────────────────────────

  checkIpAllowed(ip: string): boolean {
    if (this.ipAllowlist.length === 0) return true; // No allowlist = allow all
    return this.ipAllowlist.some((rule) => rule.match(ip));
  }

  // ── Audit Logging ────────────────────────────────────────────────────────

  logEvent(event: AuthEvent): void {
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.authLogPath, line, { encoding: 'utf-8' });
  }

  getRecentEvents(limit = 100): AuthEvent[] {
    try {
      if (!fs.existsSync(this.authLogPath)) return [];
      const lines = fs.readFileSync(this.authLogPath, 'utf-8').trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as AuthEvent);
    } catch { return []; }
  }

  getFailedAttempts(ip: string, windowMs = 600_000): number {
    const now = Date.now();
    const entry = this.failedAttempts.get(ip);
    if (!entry || now > entry.resetAt) return 0;
    return entry.count;
  }

  recordFailedAttempt(ip: string, windowMs = 600_000): void {
    const now = Date.now();
    const entry = this.failedAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      this.failedAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
    }
  }

  // ── Export/Import ───────────────────────────────────────────────────────

  exportKeys(): string {
    return JSON.stringify(this.keys, null, 2);
  }

  importKeys(json: string): void {
    const keys = JSON.parse(json) as AuthKey[];
    for (const key of keys) {
      if (!this.keys.find((k) => k.id === key.id)) {
        this.keys.push(key);
      }
    }
    this.saveKeys();
  }
}

// ─── HMAC Utilities ──────────────────────────────────────────────────────────

export function generateHmacSignature(secret: string, method: string, path: string, body: string, timestamp: string, requestId: string): string {
  const payload = `${method}\n${path}\n${body}\n${timestamp}\n${requestId}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmacSignature(secret: string, method: string, reqPath: string, body: string, timestamp: string, requestId: string, signature: string, maxAgeMs = 300_000): boolean {
  // Check timestamp freshness (prevent replay)
  if (Date.now() - parseInt(timestamp, 10) > maxAgeMs) return false;
  const expected = generateHmacSignature(secret, method, reqPath, body, timestamp, requestId);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance: AuthManager | null = null;

export function getAuthManager(config?: AuthManagerConfig): AuthManager {
  if (!_instance) _instance = new AuthManager(config);
  return _instance;
}

export { maskKey };
