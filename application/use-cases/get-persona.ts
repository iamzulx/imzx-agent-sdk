import { Persona } from '../domain/personas/types';
import { PersonaRepository } from '../domain/personas/repository';

/**
 * Use case: Retrieve a persona by its ID.
 * This encapsulates the business logic for getting a persona.
 * It depends on the PersonaRepository interface, not implementation details.
 */
export class GetPersonaUseCase {
  constructor(private readonly personaRepository: PersonaRepository) {}

  /**
   * Execute the use case to get a persona.
   * @param id - The ID of the persona to retrieve
   * @returns Promise resolving to the persona
   */
  async execute(id: string): Promise<Persona> {
    // Business rule: Validate that ID is not empty
    if (!id.trim()) {
      throw new Error('Persona ID cannot be empty');
    }

    // Delegate to repository (implementation detail)
    return this.personaRepository.findById(id);
  }
}