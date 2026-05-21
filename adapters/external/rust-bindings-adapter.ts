export class RustBindingsAdapter {
    async initialize(id: string, description: string, prompt: string): Promise<string> {
        return `Initialized via NAPI-RS: ${id}`;
    }

    async run(prompt: string): Promise<string> {
        return `Response from Rust NAPI-RS: ${prompt}`;
    }
}
