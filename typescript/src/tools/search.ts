import { Tool } from './types.js';
import { execFileNoThrow } from '../utils/execFileNoThrow.js';

export const createSearchTools = (): Tool[] => [
  {
    name: 'search_code',
    description: 'Searches for a pattern in the codebase using grep.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The regex pattern to search for.' },
      },
      required: ['pattern'],
    },
    execute: async ({ pattern }) => {
      const { stdout, stderr, status } = await execFileNoThrow('grep', ['-r', pattern, '.']);
      if (status === 0) return { content: stdout };
      if (status === 1) return { content: 'No matches found.' };
      return { content: `Error: ${stderr}` };
    },
  },
];
