import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PersonaSchema } from '../../domain/personas/types.js';
import type { Persona } from '../../domain/personas/types.js';
import type { PersonaRepository } from '../../domain/personas/repository.js';

/**
 * File-based implementation of PersonaRepository.
 * Stores personas as JSON files in the filesystem.
 * This is an infrastructure detail that should not leak into domain or application layers.
 */
export class FilePersonaRepository implements PersonaRepository {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Retrieves a persona by ID from the filesystem.
   * @param id - The persona ID to find
   */
  async findById(id: string): Promise<Persona> {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid persona ID: ${id}. Only alphanumeric, underscores, and hyphens are allowed.`);
    }
    const filePath = join(this.baseDir, `${id}.json`);
    const content = await readFile(filePath, 'utf-8');
    const parsed = PersonaSchema.parse(JSON.parse(content));
    return { ...parsed, id };
  }

  /**
   * Saves a persona to the filesystem as a JSON file.
   * @param persona - The persona to save
   */
  async save(persona: Persona): Promise<void> {
    if (!persona.id) {
      throw new Error('Persona ID is required');
    }
    const filePath = join(this.baseDir, `${persona.id}.json`);
    const content = JSON.stringify(PersonaSchema.parse(persona), null, 2);
    await writeFile(filePath, content, 'utf-8');
  }
}
