import { describe, it, expect } from 'vitest';
import { execFileNoThrow } from './src/utils/execFileNoThrow.js';

describe('execFileNoThrow', () => {
  it('should return stdout for a successful command', async () => {
    const { stdout, status } = await execFileNoThrow('echo', ['hello']);
    expect(stdout.trim()).toBe('hello');
    expect(status).toBe(0);
  });

  it('should return an error and non-zero status for a failing command', async () => {
    const { stderr, status } = await execFileNoThrow('ls', ['/non-existent-dir']);
    expect(stderr).toBeDefined();
    expect(status).not.toBe(0);
  });

  it('should handle invalid commands gracefully', async () => {
    const { stderr, status } = await execFileNoThrow('non-existent-command', []);
    expect(stderr).toBeDefined();
    expect(status).not.toBe(0);
  });
});
