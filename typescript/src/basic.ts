// Basic agent with common features
import { query } from '@anthropic-ai/claude-agent-sdk';

const CLAUDE_PATH = '/data/data/com.termux/files/home/projects/xxx/claude_bridge.py';

// Simple query example using the functional API
async function main() {
  try {
    const queryStream = await query({
      prompt: 'What time is it right now?',
      options: {
        pathToClaudeCodeExecutable: CLAUDE_PATH,
        agent: 'time-assistant',
        agents: {
          'time-assistant': {
            description: 'An assistant that can provide the current time.',
            prompt: 'You are a helpful assistant that can provide the current time.',
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