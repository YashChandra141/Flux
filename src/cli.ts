#!/usr/bin/env bun
import { createElement } from "react";
import { render } from "ink";
import chalk from "chalk";
import { resolveModel } from "./provider.ts";
import { buildSystemPrompt } from "./prompts.ts";
import { Conversation } from "./context.ts";
import { tools } from "./tools/index.ts";
import { runAgentTurn } from "./agent.ts";
import { createRenderer, home, intro, info, errorLine } from "./ui.ts";
import { App } from "./tui/app.tsx";

/** Headless single-task run (one-shot mode) using the inline renderer. */
async function runHeadless(
  task: string,
  system: string,
  convo: Conversation,
  model: ReturnType<typeof resolveModel>["model"],
): Promise<void> {
  process.stdout.write(`${chalk.green("›")} ${task}\n`);
  convo.addUser(task);
  if (await convo.maybeCompact()) info("(compacted earlier conversation to save context)");

  const renderer = createRenderer();
  try {
    const result = await runAgentTurn({
      model,
      system,
      messages: convo.messages,
      tools,
      events: renderer,
    });
    renderer.finish();
    if (result.usage?.totalTokens) {
      info(`[${result.steps} step(s) · ${result.usage.totalTokens} tokens]`);
    }
  } catch (err) {
    renderer.finish();
    errorLine(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  let resolved;
  try {
    resolved = resolveModel();
  } catch (err) {
    errorLine(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const system = await buildSystemPrompt();
  const convo = new Conversation(resolved.model);

  // One-shot mode: `flux "do the thing"` runs once and exits (no TUI).
  const oneShot = process.argv.slice(2).join(" ").trim();
  if (oneShot) {
    intro(resolved.provider, resolved.modelId);
    await runHeadless(oneShot, system, convo, resolved.model);
    return;
  }

  // Interactive mode: full-screen Ink TUI with the home splash.
  home(resolved.provider, resolved.modelId);
  const app = render(
    createElement(App, {
      model: resolved.model,
      system,
      convo,
      provider: resolved.provider,
      modelId: resolved.modelId,
    }),
  );
  await app.waitUntilExit();
}

main().catch((err) => {
  errorLine(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
