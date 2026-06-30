import { generateText, type LanguageModel, type ModelMessage } from "ai";

/**
 * Holds the running conversation and keeps it within the model's context window.
 *
 * Real agents (Claude Code, OpenCode) do multi-stage compaction. We do the
 * essential version: when the estimated token count crosses a threshold, ask
 * the model to summarize the older turns and replace them with one short
 * summary message, preserving the most recent exchanges verbatim.
 */
export class Conversation {
  readonly messages: ModelMessage[] = [];

  constructor(
    private model: LanguageModel,
    /** Approx token budget before we compact. */
    private readonly threshold = 120_000,
    /** How many recent messages to always keep untouched. */
    private readonly keepRecent = 8,
  ) {}

  /** Swap the model used for summarization (kept in sync with /models). */
  setModel(model: LanguageModel): void {
    this.model = model;
  }

  addUser(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  clear(): void {
    this.messages.length = 0;
  }

  /** Rough token estimate (~4 chars per token) — good enough to trigger compaction. */
  estimateTokens(): number {
    let chars = 0;
    for (const m of this.messages) chars += JSON.stringify(m.content).length;
    return Math.ceil(chars / 4);
  }

  /**
   * Compact if we're over budget. Returns true if a compaction happened.
   * We only cut at a `user` message boundary so we never orphan a tool result
   * from its tool call.
   */
  async maybeCompact(): Promise<boolean> {
    if (this.estimateTokens() < this.threshold) return false;
    if (this.messages.length <= this.keepRecent + 1) return false;

    // Find a safe cut point: the first user message at/after the desired index.
    let cut = this.messages.length - this.keepRecent;
    while (cut < this.messages.length && this.messages[cut]!.role !== "user") {
      cut++;
    }
    if (cut <= 0 || cut >= this.messages.length) return false;

    const older = this.messages.slice(0, cut);
    const summary = await this.summarize(older);

    this.messages.splice(0, cut, {
      role: "user",
      content:
        "[Summary of earlier conversation, condensed to save context]\n" + summary,
    });
    return true;
  }

  private async summarize(older: ModelMessage[]): Promise<string> {
    const transcript = older
      .map((m) => `${m.role.toUpperCase()}: ${stringifyContent(m.content)}`)
      .join("\n")
      .slice(0, 60_000);

    try {
      const { text } = await generateText({
        model: this.model,
        system:
          "You compress coding-session transcripts. Produce a dense summary that " +
          "preserves: the user's goals, decisions made, files created or edited " +
          "(with paths), important findings, and any unfinished work. Use terse bullets.",
        prompt: `Summarize this transcript:\n\n${transcript}`,
      });
      return text.trim() || "(summary unavailable)";
    } catch {
      // If summarization fails, fall back to a crude truncation marker rather
      // than crashing the session.
      return "(could not summarize earlier turns; some context was dropped)";
    }
  }
}

function stringifyContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part.type === "text") return part.text;
        if (part.type === "tool-call") return `[tool-call ${part.toolName}]`;
        if (part.type === "tool-result") return `[tool-result ${part.toolName}]`;
        return `[${part.type}]`;
      })
      .join(" ");
  }
  return JSON.stringify(content);
}
