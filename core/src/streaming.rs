// Author: Iamzulx
// SPDX-License-Identifier: MIT
//
// Streaming module — real-time SSE streaming for LLM responses.
// Inspired by Vercel AI SDK streaming patterns and OpenAI streaming API.
// Supports chunk-by-chunk delivery with backpressure handling.

use serde::{Deserialize, Serialize};

/// A single chunk of a streamed LLM response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StreamChunk {
    /// Text content delta.
    Text { content: String },
    /// Tool call detected in the stream.
    ToolCallStart { tool_name: String },
    /// Tool call argument chunk.
    ToolCallArgs { args_chunk: String },
    /// Tool call completed.
    ToolCallComplete {
        tool_name: String,
        full_args: String,
    },
    /// Thinking/reasoning token.
    Thinking { content: String },
    /// Usage statistics.
    Usage {
        input_tokens: u32,
        output_tokens: u32,
    },
    /// Stream finished.
    Done { total_tokens: u32 },
    /// Error during streaming.
    Error { message: String },
}

/// Streaming response collector — accumulates chunks into a complete response.
#[derive(Default)]
pub struct StreamCollector {
    pub chunks: Vec<StreamChunk>,
    pub full_text: String,
    pub tool_calls: Vec<(String, String)>, // (tool_name, args)
    pub total_tokens: u32,
    pub is_done: bool,
    pub error: Option<String>,
}

impl StreamCollector {
    pub fn new() -> Self {
        Self {
            chunks: Vec::new(),
            full_text: String::new(),
            tool_calls: Vec::new(),
            total_tokens: 0,
            is_done: false,
            error: None,
        }
    }

    /// Process an incoming chunk.
    pub fn push(&mut self, chunk: StreamChunk) {
        match &chunk {
            StreamChunk::Text { content } => {
                self.full_text.push_str(content);
            }
            StreamChunk::ToolCallComplete {
                tool_name,
                full_args,
            } => {
                self.tool_calls.push((tool_name.clone(), full_args.clone()));
            }
            StreamChunk::Done { total_tokens } => {
                self.total_tokens = *total_tokens;
                self.is_done = true;
            }
            StreamChunk::Error { message } => {
                self.error = Some(message.clone());
            }
            _ => {}
        }
        self.chunks.push(chunk);
    }

    /// Get the accumulated full response text.
    pub fn text(&self) -> &str {
        &self.full_text
    }

    /// Check if the stream contains a tool call.
    pub fn has_tool_call(&self) -> bool {
        !self.tool_calls.is_empty()
    }

    /// Get the first tool call if any.
    pub fn first_tool_call(&self) -> Option<&(String, String)> {
        self.tool_calls.first()
    }
}

/// Callback type for streaming — called on each chunk.
pub type StreamCallback = Box<dyn Fn(&StreamChunk) + Send + Sync>;

/// Streaming configuration.
#[derive(Debug, Clone)]
pub struct StreamConfig {
    /// Whether to enable streaming.
    pub enabled: bool,
    /// Buffer size before flushing.
    pub buffer_size: usize,
    /// Timeout per chunk in milliseconds.
    pub chunk_timeout_ms: u64,
}

impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            buffer_size: 64,
            chunk_timeout_ms: 30_000,
        }
    }
}

/// Token stream — wraps an async iterator of StreamChunks.
pub struct TokenStream {
    receiver: tokio::sync::mpsc::Receiver<StreamChunk>,
}

impl TokenStream {
    pub fn new(receiver: tokio::sync::mpsc::Receiver<StreamChunk>) -> Self {
        Self { receiver }
    }

    /// Collect all chunks into a StreamCollector.
    pub async fn collect_all(&mut self) -> StreamCollector {
        let mut collector = StreamCollector::new();
        while let Some(chunk) = self.receiver.recv().await {
            let is_done = matches!(chunk, StreamChunk::Done { .. });
            let is_error = matches!(chunk, StreamChunk::Error { .. });
            collector.push(chunk);
            if is_done || is_error {
                break;
            }
        }
        collector
    }

    /// Process chunks with a callback as they arrive.
    pub async fn for_each<F: FnMut(StreamChunk)>(&mut self, mut callback: F) -> StreamCollector {
        let mut collector = StreamCollector::new();
        while let Some(chunk) = self.receiver.recv().await {
            let is_done = matches!(chunk, StreamChunk::Done { .. });
            let is_error = matches!(chunk, StreamChunk::Error { .. });
            collector.push(chunk.clone());
            callback(chunk);
            if is_done || is_error {
                break;
            }
        }
        collector
    }
}
