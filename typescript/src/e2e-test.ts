// E2E Integration Test: Bug Fix Workflow
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'node:fs/promises';

const CLAUDE_PATH = '/data/data/com.termux/files/home/projects/imzx/typescript/node_modules/@anthropic-ai/claude-agent-sdk/bin/claude'; // Approximate path

async function testIntegration() {
  console.log('🧪 Starting E2E Integration Test...');

  try {
    const queryStream = await query({
      prompt: 'Please find the bug in src/buggy_file.ts and fix it using the write_file tool.',
      options: {
        pathToClaudeCodeExecutable: CLAUDE_PATH,
        agent: 'code-reviewer',
        agents: {
          'code-reviewer': {
            description: 'Fixes bugs in code',
            prompt: 'You are a bug-fixing agent. Find the logic error in the file and overwrite it with the correct implementation.',
          }
        }
      }
    });

    for await (const message of queryStream) {
      console.log('Agent:', message);
    }

    const fixedContent = await fs.readFile('/data/data/com.termux/files/home/projects/imzx/typescript/src/buggy_file.ts', 'utf8');
    if (fixedContent.includes('price * (1 + tax)')) {
      console.log('✅ SUCCESS: The agent fixed the bug!');
    } else {
      console.log('❌ FAILURE: The bug was not fixed.');
    }
  } catch (error: any) {
    console.error('Test Error:', error.message);
  }
}

testIntegration();
