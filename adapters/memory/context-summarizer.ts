/**
 * Context Summarizer — anchored iterative summarization for long conversations.
 * Based on Factory AI (2026): structured summarization scored 3.70/5 vs Anthropic 3.44.
 * Zylos Research: context drift causes 65% of enterprise AI failures.
 *
 * [v0.8.0] Added LLM-based progressive summarization + sliding window context.
 */

export interface SummaryEntry {
  id: string;
  content: string;
  key_facts: string[];
  preserved_files: string[];
  preserved_decisions: string[];
  timestamp: string;
  token_estimate: number;
}

export interface LlmLike {
  complete(messages: Array<{ role: string; content: string | null }>): Promise<{ content: string | null }>;
}

export class ContextSummarizer {
  private summaries: SummaryEntry[] = [];
  private maxSummaries: number = 10;
  private llmProvider: LlmLike | null = null;

  constructor(llmProvider?: LlmLike) {
    this.llmProvider = llmProvider || null;
  }

  /** [v0.8.0] Set or update the LLM provider for LLM-based summarization. */
  setLlmProvider(provider: LlmLike): void {
    this.llmProvider = provider;
  }

  /**
   * Summarize messages. Uses LLM if available, otherwise regex extraction.
   */
  async summarize(messages: Array<{ role: string; content: string | null }>): Promise<SummaryEntry> {
    if (this.llmProvider && messages.length > 4) {
      return this.summarizeWithLLM(messages);
    }
    return this.summarizeWithRegex(messages);
  }

  /**
   * [v0.8.0] LLM-based progressive summarization.
   * Feeds previous summary + new chunk → produces updated summary.
   */
  private async summarizeWithLLM(messages: Array<{ role: string; content: string | null }>): Promise<SummaryEntry> {
    const previousSummary = this.summaries.length > 0
      ? this.summaries[this.summaries.length - 1].content
      : '(empty — conversation just started)';

    const chunkText = messages.map(m => `${m.role}: ${(m.content || '').substring(0, 500)}`).join('\n');

    try {
      const response = await this.llmProvider!.complete([
        {
          role: 'system',
          content: `You are a context compression engine. Given a PREVIOUS SUMMARY and a NEW CHUNK of conversation, produce an UPDATED SUMMARY that:
1. Preserves all key facts, decisions, user preferences, and open questions
2. Removes redundancy and filler
3. Keeps specific identifiers (names, IDs, URLs, file paths, code snippets)
4. Stays concise (under 300 words)

Respond with the updated summary only. No preamble.`,
        },
        {
          role: 'user',
          content: `PREVIOUS SUMMARY:\n${previousSummary}\n\nNEW CHUNK:\n${chunkText}`,
        },
      ]);

      const summaryText = response.content || '(summarization failed)';
      const files = this.extractFiles(chunkText);
      const decisions = this.extractDecisions(chunkText);

      const summary: SummaryEntry = {
        id: `sum_${Date.now()}`,
        content: summaryText,
        key_facts: this.extractKeyFacts(summaryText + '\n' + chunkText),
        preserved_files: files,
        preserved_decisions: decisions,
        timestamp: new Date().toISOString(),
        token_estimate: Math.ceil(summaryText.length / 3.75),
      };

      this.summaries.push(summary);
      this.trimSummaries();
      return summary;
    } catch {
      // LLM failed — fall back to regex
      return this.summarizeWithRegex(messages);
    }
  }

  /**
   * Regex-based summarization (original fallback).
   */
  private summarizeWithRegex(messages: Array<{ role: string; content: string | null }>): SummaryEntry {
    const allText = messages.map(m => m.content || '').filter(c => c.length > 0).join('\n');
    const keyFacts = this.extractKeyFacts(allText);
    const files = this.extractFiles(allText);
    const decisions = this.extractDecisions(allText);

    const parts: string[] = [];
    if (keyFacts.length > 0) parts.push(`Key facts: ${keyFacts.join('; ')}`);
    if (files.length > 0) parts.push(`Files: ${files.join(', ')}`);
    if (decisions.length > 0) parts.push(`Decisions: ${decisions.join('; ')}`);

    const summary: SummaryEntry = {
      id: `sum_${Date.now()}`,
      content: parts.join('\n') || `Conversation with ${messages.length} messages`,
      key_facts: keyFacts,
      preserved_files: files,
      preserved_decisions: decisions,
      timestamp: new Date().toISOString(),
      token_estimate: Math.ceil(parts.join('').length / 3.75),
    };

    this.summaries.push(summary);
    this.trimSummaries();
    return summary;
  }

  /**
   * [v0.8.0] Sliding window context — keep recent messages verbatim, summarize older ones.
   * Returns messages ready for LLM: [system+summary, ...recentMessages]
   */
  buildSlidingWindowContext(
    allMessages: Array<{ role: string; content: string | null }>,
    systemPrompt: string,
    maxRecent: number = 15
  ): Array<{ role: string; content: string | null }> {
    const result: Array<{ role: string; content: string | null }> = [];

    // 1. System prompt always first
    result.push({ role: 'system', content: systemPrompt });

    // 2. Inject summary of older messages if we have overflow
    if (allMessages.length > maxRecent) {
      const olderMessages = allMessages.slice(0, allMessages.length - maxRecent);
      const olderSummary = this.summaries.length > 0
        ? this.summaries[this.summaries.length - 1].content
        : olderMessages.map(m => m.content || '').join('\n').substring(0, 500);

      result.push({
        role: 'system',
        content: `[Summary of earlier conversation]:\n${olderSummary}`,
      });
    }

    // 3. Recent messages verbatim
    const recentMessages = allMessages.slice(-maxRecent);
    result.push(...recentMessages);

    return result;
  }

  private trimSummaries(): void {
    if (this.summaries.length > this.maxSummaries) {
      const oldest = this.summaries.slice(0, -this.maxSummaries + 1);
      const merged = this.mergeSummaries(oldest);
      this.summaries = [merged, ...this.summaries.slice(-this.maxSummaries + 1)];
    }
  }

  getSummaries(): SummaryEntry[] { return [...this.summaries]; }

  formatForPrompt(): string {
    if (this.summaries.length === 0) return '';
    const recent = this.summaries.slice(-3);
    const parts = recent.map(s => {
      const lines = [`- [${s.timestamp.slice(11, 16)}] ${s.content}`];
      if (s.preserved_files.length > 0) lines.push(`  Files: ${s.preserved_files.join(', ')}`);
      return lines.join('\n');
    });
    return `\n\n## Conversation Context (compressed):\n${parts.join('\n')}`;
  }

  private extractKeyFacts(text: string): string[] {
    const facts: string[] = [];
    for (const m of text.matchAll(/error[:\s]+(.{10,80})/gi)) facts.push(`Error: ${m[1].trim()}`);
    for (const m of text.matchAll(/v?\d+\.\d+\.\d+/g)) {
      if (!facts.some(f => f.includes(m[0]))) facts.push(`Version: ${m[0]}`);
    }
    return [...new Set(facts)].slice(0, 10);
  }

  private extractFiles(text: string): string[] {
    const files = new Set<string>();
    for (const m of text.matchAll(/[\w/.-]+\.(ts|js|rs|py|json|md|toml|yaml|yml)/g)) files.add(m[0]);
    return [...files].slice(0, 15);
  }

  private extractDecisions(text: string): string[] {
    const decisions: string[] = [];
    for (const m of text.matchAll(/(?:decided|chose|selected|going with|using)\s+(.{10,80})/gi)) {
      decisions.push(m[1].trim().substring(0, 80));
    }
    return [...new Set(decisions)].slice(0, 5);
  }

  private mergeSummaries(entries: SummaryEntry[]): SummaryEntry {
    const allFacts = [...new Set(entries.flatMap(e => e.key_facts))];
    const allFiles = [...new Set(entries.flatMap(e => e.preserved_files))];
    const allDecisions = [...new Set(entries.flatMap(e => e.preserved_decisions))];
    const allContent = entries.map(e => e.content).join(' | ');
    return {
      id: `merged_${Date.now()}`,
      content: allContent.substring(0, 500),
      key_facts: allFacts,
      preserved_files: allFiles,
      preserved_decisions: allDecisions,
      timestamp: new Date().toISOString(),
      token_estimate: Math.ceil(allContent.length / 3.75),
    };
  }
}
