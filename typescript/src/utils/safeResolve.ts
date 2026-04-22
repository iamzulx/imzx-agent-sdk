import * as path from 'node:path';

export function safeResolve(baseDir: string, targetPath: string): string {
  const absoluteBase = path.resolve(baseDir);
  const absoluteTarget = path.resolve(absoluteBase, targetPath);

  if (!absoluteTarget.startsWith(absoluteBase)) {
    throw new Error(`Security Error: Attempted path traversal outside of sandbox: ${targetPath}`);
  }

  return absoluteTarget;
}
