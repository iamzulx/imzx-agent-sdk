import { Persona } from './types';

/**
 * Port interface for persona persistence.
 * Defines the contract for how use cases can access persona data.
 * Implementations can be file-based, database-based, or even remote APIs.
 */
export interface PersonaRepository {
  /**
   * Finds a persona by its unique identifier.
   * @param id - The persona ID to look for
   * @returns Promise resolving to the found persona
   * @throws Error if persona not found
   */
  findById(id: string): Promise<Persona>;

  /**
   * Saves a persona to persistent storage.
   * @param persona - The persona to save
   * @returns Promise that resolves when save is complete
   */
  save(persona: Persona): Promise<void>;
}
