#!/usr/bin/env node
import { query } from '@anthropic-ai/claude-agent-sdk';
import process from 'node:process';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs/promises';
import { PersonaSchema } from './imzx/schema.js';
import { logger } from './imzx/logger.js';
import { safeResolve } from './utils/safeResolve.js';

dotenv.config();
const CLAUDE_PATH = process.env.CLAUDE_BRIDGE_PATH || './claude_bridge.py';
const PERSONA_DIR = process.env.PERSONA_DIR || './personas';

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node cli.ts <prompt> [agent_name]');
    process.exit(1);
  }

  const prompt = args[0];
  const agentName = args[1] || 'general-purpose';

  // Load persona from JSON
  let personaData;
  try {
    const personaPath = safeResolve(PERSONA_DIR, `${agentName}.json`);
    const content = await fs.readFile(personaPath, 'utf8');
    personaData = JSON.parse(content);
    // Validate persona using Zod
    PersonaSchema.parse(personaData);
  } catch (error) {
    logger.error(`Persona '${agentName}' not found or invalid in ${PERSONA_DIR}.`);
    process.exit(1);
  }

  logger.info(`Querying agent [${agentName}] with prompt: "${prompt}"`);

  try {
    const queryStream = await query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: CLAUDE_PATH,
        agent: agentName,
        agents: {
          [agentName]: {
            description: personaData.description,
            prompt: personaData.prompt,
          }
        }
      }
    });

    for await (const message of queryStream) {
      logger.info(`Agent Response: ${message}`);
    }
  } catch (error: any) {
    logger.error(`Error: ${error.message}`);
  }
}

run();
