import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import imzxCore from '@imzx/core-bindings';
import { logger } from 'pino'; // Assuming logger is available or we use a simple one

// Fix: Use absolute path to personas directory located at the project root
const BASE_DIR = path.resolve(__dirname, '../../');
const PERSONA_DIR = process.env.PERSONA_DIR || path.join(BASE_DIR, 'personas');

// Simple logger for CLI
const log = (msg: string) => console.log(`[imzx] ${msg}`);
const error = (msg: string) => console.error(`[ERROR] ${msg}`);

const PersonaSchema = z.object({
  description: z.string(),
  prompt: z.string(),
});

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node index.js <prompt> [agent_name]');
    process.exit(1);
  }

  const prompt = args[0];
  const agentName = args[1] || 'general-purpose';

  try {
    // Security: Sanitize agentName to prevent Path Traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      console.error(`Invalid agent name: ${agentName}. Only alphanumeric, underscores, and hyphens are allowed.`);
      process.exit(1);
    }
    // 1. Load and Validate Persona
    const personaPath = path.resolve(PERSONA_DIR, `${agentName}.json`);
    const content = await fs.readFile(personaPath, 'utf8');
    const personaData = JSON.parse(content);

    PersonaSchema.parse(personaData);
    log(`Loaded persona: ${agentName}`);

    // 2. Initialize Agent via Rust Bindings
    log(`Initializing agent: ${agentName}...`);
    const initMsg = imzxCore.agentNew(agentName, personaData.description, personaData.prompt);
    log(`Status: ${initMsg}`);

    // 3. Run Agent via Rust Bindings
    log(`Querying: "${prompt}"`);
    const response = imzxCore.agentRun(prompt);

    console.log('\n--- Agent Response ---');
    console.log(response);
    console.log('----------------------\n');

  } catch (err: any) {
    if (err.code === 'ENOENT') {
      error(`Persona '${agentName}.json' not found in ${PERSONA_DIR}`);
    } else if (err.name === 'ZodError') {
      error(`Invalid persona format: ${err.message}`);
    } else {
      error(err.message || String(err));
    }
    process.exit(1);
  }
}

run();
