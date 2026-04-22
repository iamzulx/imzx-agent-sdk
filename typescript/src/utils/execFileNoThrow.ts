import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFilePromise = promisify(execFile);

export async function execFileNoThrow(file: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFilePromise(file, args);
    return { stdout, stderr, status: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: error.code || 1
    };
  }
}
