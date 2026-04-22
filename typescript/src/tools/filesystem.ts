import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Tool } from './types.js';
import { safeResolve } from '../utils/safeResolve.js';

const PROJECT_ROOT = path.resolve(process.cwd());

export const createFilesystemTools = (): Tool[] => [
  {
    name: 'read_file',
    description: 'Reads the content of a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file.' },
      },
      required: ['path'],
    },
    execute: async ({ path: filePath }) => {
      try {
        const absolutePath = safeResolve(PROJECT_ROOT, filePath);
        const content = await fs.readFile(absolutePath, 'utf8');
        return { content };
      } catch (error: any) {
        return { content: `Error: ${error.message}` };
      }
    },
  },
  {
    name: 'list_files',
    description: 'Lists files in a directory.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory path.', default: '.' },
      },
      required: ['dir'],
    },
    execute: async ({ dir = '.' }) => {
      try {
        const absolutePath = safeResolve(PROJECT_ROOT, dir);
        const files = await fs.readdir(absolutePath);
        return { content: files.join('\n') };
      } catch (error: any) {
        return { content: `Error: ${error.message}` };
      }
    },
  },
  {
    name: 'write_file',
    description: 'Writes content to a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path.' },
        content: { type: 'string', description: 'Content to write.' },
      },
      required: ['path', 'content'],
    },
    execute: async ({ path: filePath, content }) => {
      try {
        const absolutePath = safeResolve(PROJECT_ROOT, filePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf8');
        return { content: `Success: Wrote to ${filePath}` };
      } catch (error: any) {
        return { content: `Error: ${error.message}` };
      }
    },
  },
];
