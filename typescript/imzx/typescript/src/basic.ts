// Basic agent with common features
import { ClaudeAgent, Tool } from '@anthropic-ai/claude-agent-sdk';

// Define a simple tool
const get_time_tool = new Tool({
  name: 'get_time',
  description: 'Returns the current time.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    return {
      content: new Date().toISOString(),
    };
  },
});

// Create a basic agent with common features
const agent = new ClaudeAgent({
  name: 'BasicAgent',
  systemPrompt: 'You are a helpful assistant that can provide the current time.',
  tools: [get_time_tool],
});

// Simple query example
async function main() {
  try {
    const response = await agent.query('What time is it right now?');
    console.log('Response:', response.content);
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
