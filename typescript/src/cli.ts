#!/usr/bin/env node
import { query } from '@anthropic-ai/claude-agent-sdk';
import process from 'node:process';

const CLAUDE_PATH = '/data/data/com.termux/files/home/projects/xxx/claude_bridge.py';

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node cli.ts <prompt> [agent_name]');
    process.exit(1);
  }

  const prompt = args[0];
  const agentName = args[1] || 'general-purpose';

  console.log(`\\n🚀 Querying agent [${agentName}] with prompt: "${prompt}"\\n`);

  try {
    const queryStream = await query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: CLAUDE_PATH,
        agent: agentName,
        agents: {
          'general-purpose': {
            description: 'A general purpose assistant',
            prompt: 'You are a helpful and concise assistant.',
          },
          'code-reviewer': {
            description: 'Expert code reviewer',
            prompt: 'You are an expert code reviewer. Analyze code for bugs and security issues.',
          }
        }
      }
    });

    for await (const message of queryStream) {
      process.stdout.write(message + '\\n');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

run();
