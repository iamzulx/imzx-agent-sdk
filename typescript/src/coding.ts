// Coding agent example (Professional Code Reviewer)
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createFilesystemTools } from './tools/filesystem.js';
import { createSearchTools } from './tools/search.js';

const CLAUDE_PATH = '/data/data/com.termux/files/home/projects/imzx/claude_bridge.py';

async function main() {
  // 1. Initialize Tools via Factory Functions
  const tools = [
    ...createFilesystemTools(),
    ...createSearchTools(),
  ];

  try {
    // 2. Execute Query with injected tools
    const queryStream = await query({
      prompt: 'Please explore the current project directory, find the TypeScript examples, and suggest one improvement to the hello.ts file.',
      options: {
        pathToClaudeCodeExecutable: CLAUDE_PATH,
        agent: 'code-reviewer',
        agents: {
          'code-reviewer': {
            description: 'Expert code reviewer and project architect',
            prompt: `You are an expert code reviewer.
            You have access to tools to explore the filesystem, read code, search for patterns, and write files.
            Your goal is to analyze the codebase and provide high-quality improvements.
            Always explore the directory structure first using list_files before attempting to read specific files.`,
            // In a real SDK, you'd pass the tools here
          }
        }
      }
    });

    for await (const message of queryStream) {
      console.log('Agent:', message);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
