/**
 * Observability Logger — JSONL structured logging for agent operations.
 * Logs every step to a file for debugging and analysis.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LogEntry {
  ts: string;
  event: string;
  data: Record<string, unknown>;
}

export class AgentLogger {
  private stream: fs.WriteStream | null = null;
  private logPath: string;

  constructor(logDir?: string) {
    const dir = logDir || path.join(process.cwd(), '.imzx', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, `agent-${new Date().toISOString().slice(0, 10)}.jsonl`);
  }

  start(): void {
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  log(event: string, data: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      event,
      data,
    };
    if (this.stream) {
      this.stream.write(JSON.stringify(entry) + '\n');
    }
  }

  stop(): void {
    this.stream?.end();
    this.stream = null;
  }

  getLogPath(): string {
    return this.logPath;
  }
}
