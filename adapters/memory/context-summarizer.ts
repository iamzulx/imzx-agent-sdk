/**
 * Context Summarizer — anchored iterative summarization for long conversations.
 * Based on Factory AI (2026): structured summarization scored 3.70/5 vs Anthropic 3.44.
 * Zylos Research: context drift causes 65% of enterprise AI failures.
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

export class ContextSummarizer {
  private summaries: SummaryEntry[] = [];
  private maxSummaries: number = 10;

  summarize(messages: Array<{ role: string; content: string | null }>): SummaryEntry {
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
    if (this.summaries.length > this.maxSummaries) {
      const oldest = this.summaries.slice(0, -this.maxSummaries + 1);
      const merged = this.mergeSummaries(oldest);
      this.summaries = [merged, ...this.summaries.slice(-this.maxSummaries + 1)];
    }
    return summary;
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
    return {
      id: `merged_${Date.now()}`,
      content: `Merged ${entries.length} segments. ${allFacts.length} facts, ${allFiles.length} files.`,
      key_facts: allFacts,
      preserved_files: allFiles,
      preserved_decisions: allDecisions,
      timestamp: new Date().toISOString(),
      token_estimate: Math.ceil(allFacts.join('').length / 3.75),
    };
  }
}
