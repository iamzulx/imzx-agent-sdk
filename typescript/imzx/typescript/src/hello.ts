// Minimal Hello World example
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk';

// Create a minimal agent instance
const agent = new ClaudeAgent({
  name: 'HelloWorldAgent',
  systemPrompt: 'You are a friendly assistant.',
});

// Simple query example
async function main() {
  try {
    const response = await agent.query('Hello! What is your name?');
    console.log('Response:', response.content);
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
