#!/usr/bin/env node
// imzx CLI entry point
// Usage: npx imzx run "prompt" / npx imzx chat / npx imzx serve

import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

// Register tsx for TypeScript support
register('tsx/esm', import.meta.url);

const cliPath = new URL('./interfaces/cli/cli-handler.ts', import.meta.url);
await import(cliPath.href);
