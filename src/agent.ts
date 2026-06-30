import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

/**
 * Callbacks the UI implements so the loop stays decoupled from rendering.
 * This mirrors how real agents separate the `query()` loop from the TUI.
 */
export interface AgentEvents {
  onTextDelta(text: string): void;
  onToolCall(name: string, input: unknown, id: string): void;
  onToolResult(name: string, output: unknown, id: string): void;
  onToolError(name: string, error: unknown, id: string): void;
  onError(error: unknown): void;
  onStepFinish?(): void;
}

export interface RunTurnOptions {
  model: LanguageModel;
  system: string;
  /** Mutated in place: the model's response messages are appended on completion. */
  messages: ModelMessage[];
  tools: ToolSet;
  events: AgentEvents;
  maxSteps?: number;
  abortSignal?: AbortSignal;
}

export interface TurnResult {
  /** Final assistant text of the turn (concatenated text output). */
  text: string;
  steps: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

/**
 * Run a single user turn to completion. This is the heart of the agent: call
 * the model, stream text, execute any tool calls, feed results back, and repeat
 * until the model produces a plain-text answer or we hit the step cap.
 *
 * The AI SDK runs the loop internally via `stopWhen: stepCountIs(...)`; we just
 * observe the streamed parts and forward them to the UI.
 */
export async function runAgentTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const { model, system, messages, tools, events } = opts;
  const maxSteps = opts.maxSteps ?? 25;

  const result = streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(maxSteps),
    abortSignal: opts.abortSignal,
    onStepFinish: () => events.onStepFinish?.(),
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        // v5 exposes `.text`; guard for older shapes just in case.
        const text = (part as { text?: string; textDelta?: string }).text ??
          (part as { textDelta?: string }).textDelta ?? "";
        if (text) events.onTextDelta(text);
        break;
      }
      case "tool-call":
        events.onToolCall(part.toolName, part.input, part.toolCallId);
        break;
      case "tool-result":
        events.onToolResult(part.toolName, part.output, part.toolCallId);
        break;
      case "tool-error":
        events.onToolError(part.toolName, part.error, part.toolCallId);
        break;
      case "error":
        events.onError(part.error);
        break;
      default:
        break;
    }
  }

  // Persist the model's turn (assistant text + tool calls + tool results) into
  // the shared history so the next turn has full context.
  const response = await result.response;
  messages.push(...response.messages);

  const [text, steps, usage] = await Promise.all([
    result.text,
    result.steps,
    result.usage,
  ]);

  return {
    text,
    steps: steps.length,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
  };
}
