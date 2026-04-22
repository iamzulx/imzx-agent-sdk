// Minimal Hello World example
// Minimal Hello World example
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as dotenv from 'dotenv';

dotenv.config();
const CLAUDE_PATH = process.env.CLAUDE_BRIDGE_PATH || './claude_bridge.py';

// Simple query example using the functional API
async function main() {
  try {
    const queryStream = await query({
      prompt: 'Hello! What is your name?',
      options: {
        pathToClaudeCodeExecutable: CLAUDE_PATH,
        agent: 'friendly-assistant',
        agents: {
          'friendly-assistant': {
            description: 'A friendly assistant',
            prompt: 'You are a friendly assistant.',
          }
        }
      }
    });

    for await (const message of queryStream) {
      console.log('Message:', message);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
