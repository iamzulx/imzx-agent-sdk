/**
 * Voice/Realtime Agent Adapter — architecture for voice-enabled agents.
 * [v0.8.0] Supports: OpenAI Realtime API, LiveKit STT→LLM→TTS pipeline.
 *
 * This module provides the interface and types. Actual voice processing
 * requires runtime dependencies (@openai/agents/realtime or @livekit/agents).
 *
 * Architecture:
 *   Browser: WebRTC → OpenAI Realtime API (direct, ~800ms latency)
 *   Server:  WebSocket → Realtime API relay (tools + compliance)
 *   Pipeline: Audio → VAD → STT → LLM → TTS → Audio (LiveKit)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VoiceConfig {
  provider: 'openai-realtime' | 'livekit-pipeline' | 'custom';
  model?: string;
  voice?: string;
  systemPrompt?: string;
  tools?: VoiceTool[];
  /** Allow user to interrupt agent speech */
  allowInterruptions?: boolean;
  /** Minimum words before interruption is allowed */
  interruptMinimumWords?: number;
}

export interface VoiceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface VoiceEvent {
  type: 'user_speech' | 'agent_speech' | 'tool_call' | 'audio' | 'transcript' | 'error';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type VoiceEventHandler = (event: VoiceEvent) => void;

// ─── Voice Agent Interface ───────────────────────────────────────────────────

export abstract class VoiceAgent {
  protected config: VoiceConfig;
  protected handlers: VoiceEventHandler[] = [];
  protected active: boolean = false;

  constructor(config: VoiceConfig) {
    this.config = config;
  }

  on(handler: VoiceEventHandler): void {
    this.handlers.push(handler);
  }

  protected emit(event: VoiceEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* don't let handler errors break the agent */ }
    }
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendAudio(data: Buffer): void;
  abstract sendText(text: string): void;

  isActive(): boolean { return this.active; }
}

// ─── OpenAI Realtime Adapter ────────────────────────────────────────────────

/**
 * OpenAI Realtime API adapter — voice-to-voice with ~800ms latency.
 * Requires: npm install @openai/agents (includes @openai/agents/realtime)
 *
 * Usage:
 *   const agent = new OpenAIRealtimeAgent({
 *     provider: 'openai-realtime',
 *     model: 'gpt-4o-realtime-preview',
 *     voice: 'alloy',
 *     systemPrompt: 'You are a helpful voice assistant.',
 *   });
 *   await agent.connect();
 */
export class OpenAIRealtimeAgent extends VoiceAgent {
  private ws: any = null; // WebSocket connection

  async connect(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI Realtime');

    try {
      const { WebSocket } = await import('ws' as string) as any;
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${this.config.model || 'gpt-4o-realtime-preview'}`;

      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        this.active = true;
        // Send session config
        this.ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            instructions: this.config.systemPrompt || 'You are a helpful voice assistant.',
            voice: this.config.voice || 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        }));
        this.emit({ type: 'transcript', content: 'Connected to OpenAI Realtime', timestamp: new Date().toISOString() });
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleRealtimeEvent(event);
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        this.active = false;
      });

      this.ws.on('error', (err: Error) => {
        this.emit({ type: 'error', content: err.message, timestamp: new Date().toISOString() });
      });
    } catch (err) {
      throw new Error(`OpenAI Realtime connection failed: ${(err as Error).message}. Install 'ws' package: npm install ws`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.active = false;
  }

  sendAudio(data: Buffer): void {
    if (!this.ws || !this.active) return;
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: data.toString('base64'),
    }));
  }

  sendText(text: string): void {
    if (!this.ws || !this.active) return;
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    }));
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }

  private handleRealtimeEvent(event: any): void {
    switch (event.type) {
      case 'response.audio.delta':
        this.emit({
          type: 'audio',
          content: event.delta, // base64 audio
          timestamp: new Date().toISOString(),
        });
        break;
      case 'response.audio_transcript.delta':
        this.emit({
          type: 'agent_speech',
          content: event.delta,
          timestamp: new Date().toISOString(),
        });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emit({
          type: 'user_speech',
          content: event.transcript,
          timestamp: new Date().toISOString(),
        });
        break;
      case 'response.function_call_arguments.done':
        this.emit({
          type: 'tool_call',
          content: event.name,
          timestamp: new Date().toISOString(),
          metadata: { arguments: event.arguments },
        });
        break;
    }
  }
}

// ─── Pipeline Voice Agent (STT → LLM → TTS) ───────────────────────────────

/**
 * Pipeline-based voice agent — sequential STT → LLM → TTS processing.
 * Requires: npm install @livekit/agents @livekit/agents-plugins-openai
 *
 * This is a stub that defines the interface. Full implementation requires
 * LiveKit runtime for audio processing.
 */
export class PipelineVoiceAgent extends VoiceAgent {
  private llmFn: ((text: string) => Promise<string>) | null = null;

  /** Set the LLM function for text generation. */
  setLLM(fn: (text: string) => Promise<string>): void {
    this.llmFn = fn;
  }

  async connect(): Promise<void> {
    // In production: initialize LiveKit room connection
    // const room = new Room();
    // await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
    this.active = true;
    this.emit({ type: 'transcript', content: 'Pipeline voice agent ready', timestamp: new Date().toISOString() });
  }

  async disconnect(): Promise<void> {
    this.active = false;
  }

  sendAudio(_data: Buffer): void {
    // In production: pipe audio frames to LiveKit VAD → STT
    // When STT produces transcript, call processTranscript()
  }

  sendText(text: string): void {
    this.processTranscript(text);
  }

  private async processTranscript(text: string): Promise<void> {
    this.emit({ type: 'user_speech', content: text, timestamp: new Date().toISOString() });

    if (!this.llmFn) {
      this.emit({ type: 'error', content: 'No LLM function configured', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const response = await this.llmFn(text);
      this.emit({ type: 'agent_speech', content: response, timestamp: new Date().toISOString() });
      // In production: pipe response to TTS → audio output
    } catch (err) {
      this.emit({ type: 'error', content: (err as Error).message, timestamp: new Date().toISOString() });
    }
  }
}
