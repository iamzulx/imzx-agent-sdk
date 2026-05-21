import { z } from 'zod';

/**
 * Persona schema for defining agent behavior and personality.
 * This is the fundamental building block of the imzx agent framework.
 */
export const PersonaSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  description: z.string().min(1, "Description is required"),
  prompt: z.string().min(1, "Prompt is required"),
});

export type Persona = z.infer<typeof PersonaSchema>;
