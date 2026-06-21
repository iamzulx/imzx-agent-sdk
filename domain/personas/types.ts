/**
 * Persona — pure domain type. No third-party dependencies.
 * Validation (Zod) lives in the adapter layer: adapters/persistence/file-persona-repository.ts
 *
 * [A1 FIX] Removed Zod dependency from domain layer — Clean Architecture.
 */
export interface Persona {
  id?: string;
  description: string;
  prompt: string;
}
