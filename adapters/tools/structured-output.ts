/**
 * Structured Output — JSON schema validation for reliable agent responses.
 * Based on: Agentic Patterns (Balic 2026), HuggingFace Output Schema,
 * Pydantic + Zod patterns (Techsy 2026), OpenAI Structured Outputs.
 */

export interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  enum?: string[];
  items?: SchemaField;
  properties?: Record<string, SchemaField>;
}

export interface OutputSchema {
  name: string;
  description: string;
  fields: Record<string, SchemaField>;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  data?: T;
  errors: string[];
  retries: number;
}

export class StructuredOutputValidator {
  private schemas: Map<string, OutputSchema> = new Map();

  registerSchema(schema: OutputSchema): void {
    this.schemas.set(schema.name, schema);
  }

  validate<T = unknown>(rawOutput: string, schemaName: string): ValidationResult<T> {
    const schema = this.schemas.get(schemaName);
    if (!schema) return { valid: false, errors: [`Schema '${schemaName}' not found`], retries: 0 };

    let parsed: unknown;
    try {
      const cleaned = this.extractJson(rawOutput);
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      return { valid: false, errors: [`Invalid JSON: ${e.message}`], retries: 0 };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, errors: ['Expected JSON object at root'], retries: 0 };
    }

    const errors = this.validateObject(parsed as Record<string, unknown>, schema);
    return { valid: errors.length === 0, data: errors.length === 0 ? (parsed as T) : undefined, errors, retries: 0 };
  }

  async validateWithRetry<T = unknown>(generateFn: () => Promise<string>, schemaName: string, maxRetries: number = 3): Promise<ValidationResult<T>> {
    const schema = this.schemas.get(schemaName);
    if (!schema) return { valid: false, errors: [`Schema '${schemaName}' not found`], retries: 0 };

    let allErrors: string[] = [];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const raw = await generateFn();
      const result = this.validate<T>(raw, schemaName);
      if (result.valid) return { ...result, retries: attempt };
      allErrors = result.errors;
    }
    return { valid: false, errors: [...allErrors, `Failed after ${maxRetries} retries`], retries: maxRetries };
  }

  toJsonSchema(schema: OutputSchema): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(schema.fields)) {
      properties[key] = this.fieldToJsonSchema(field);
      if (field.required !== false) required.push(key);
    }
    return { type: 'object', description: schema.description, properties, required, additionalProperties: false };
  }

  formatErrors(errors: string[]): string {
    return `Your response was invalid. Fix these issues:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\nRespond with valid JSON only.`;
  }

  private validateObject(obj: Record<string, unknown>, schema: OutputSchema): string[] {
    const errors: string[] = [];
    for (const [key, field] of Object.entries(schema.fields)) {
      const value = obj[key];
      if (value === undefined || value === null) {
        if (field.required !== false) errors.push(`Missing required field: '${key}'`);
        continue;
      }
      errors.push(...this.validateField(value, field, key));
    }
    return errors;
  }

  private validateField(value: unknown, field: SchemaField, path: string): string[] {
    const errors: string[] = [];
    switch (field.type) {
      case 'string':
        if (typeof value !== 'string') errors.push(`'${path}' must be string, got ${typeof value}`);
        else if (field.enum && !field.enum.includes(value)) errors.push(`'${path}' must be one of: ${field.enum.join(', ')}`);
        break;
      case 'number':
        if (typeof value !== 'number') errors.push(`'${path}' must be number, got ${typeof value}`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`'${path}' must be boolean, got ${typeof value}`);
        break;
      case 'array':
        if (!Array.isArray(value)) { errors.push(`'${path}' must be array`); break; }
        if (field.items) { for (let i = 0; i < value.length; i++) errors.push(...this.validateField(value[i], field.items, `${path}[${i}]`)); }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) errors.push(`'${path}' must be object`);
        else if (field.properties) errors.push(...this.validateObject(value as Record<string, unknown>, { name: path, description: '', fields: field.properties }));
        break;
    }
    return errors;
  }

  private extractJson(text: string): string {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
    return text.trim();
  }

  private fieldToJsonSchema(field: SchemaField): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: field.type };
    if (field.description) schema.description = field.description;
    if (field.enum) schema.enum = field.enum;
    if (field.items) schema.items = this.fieldToJsonSchema(field.items);
    if (field.properties) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(field.properties)) props[k] = this.fieldToJsonSchema(v);
      schema.properties = props;
    }
    return schema;
  }
}
