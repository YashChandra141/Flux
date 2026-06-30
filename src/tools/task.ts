import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { resolveModel } from "../provider.ts";
import { runAgentTurn } from "../agent.ts";
import { read } from "./read.ts";
import { ls } from "./ls.ts";
import { grep } from "./grep.ts";
import { glob } from "./glob.ts";

// A sub-agent only gets read-only tools, so spawning one can never mutate the
// workspace without going through the main loop's permission gate.
const SUB_AGENT_TOOLS: ToolSet = { read, ls, grep, glob };

const SUB_AGENT_SYSTEM = `You are a focused sub-agent spawned to handle a single research/exploration task.
You have read-only tools (read, ls, grep, glob). Investigate thoroughly, then
return a concise, self-contained answer. Do not ask follow-up questions.`;

export const task = tool({
  description:
    "Spawn a read-only sub-agent to handle a focused search or multi-step " +
    "exploration (e.g. 'find where X is configured'). Returns the sub-agent's " +
    "final answer. Use this to keep large searches out of the main context.",
  inputSchema: z.object({
    prompt: z.string().describe("A self-contained description of what to find or analyze."),
  }),
  execute: async ({ prompt }) => {
    const { model } = resolveModel();
    const messages: ModelMessage[] = [{ role: "user", content: prompt }];

    const noop = () => {};
    const result = await runAgentTurn({
      model,
      system: SUB_AGENT_SYSTEM,
      messages,
      tools: SUB_AGENT_TOOLS,
      maxSteps: 15,
      events: {
        onTextDelta: noop,
        onToolCall: noop,
        onToolResult: noop,
        onToolError: noop,
        onError: noop,
      },
    });

    return { answer: result.text || "(sub-agent returned no answer)" };
  },
});
