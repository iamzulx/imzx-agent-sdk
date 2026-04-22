// Coding agent example (Code Reviewer)
import { ClaudeAgent, Tool } from '@anthropic-ai/claude-agent-sdk';

// Define a tool to "read" a file for the agent
const read_file_tool = new Tool({
  name: 'read_file',
  description: 'Reads the content of a file for code review.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read.' },
    },
    required: ['path'],
  },
  execute: async ({ path }) => {
    // In a real scenario, this would use the filesystem
    return {
      content: `// Mock content for ${path}\\nfunction add(a, b) { return a + b; }`,
    };
  },
});

// Create a coding agent specialized in code review
const agent = new ClaudeAgent({
  name: 'CodingReviewAgent',
  systemPrompt: `You are an expert code reviewer.
  Analyze the provided code for bugs, security vulnerabilities, and adherence to best practices.
  Provide constructive feedback and suggestions for improvement.`,
  tools: [read_file_tool],
});

// Simple query example
async function main() {
  try {
    const response = await agent.query('Please review the file "src/utils.ts"');
    console.log('Response:', response.content);
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
