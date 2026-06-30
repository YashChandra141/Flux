import chalk from "chalk";
import type { AgentEvents } from "./agent.ts";
import { READ_ONLY_TOOLS } from "./tools/index.ts";

const FLUX_ART = [
  "███████╗██╗     ██╗   ██╗██╗  ██╗",
  "██╔════╝██║     ██║   ██║╚██╗██╔╝",
  "█████╗  ██║     ██║   ██║ ╚███╔╝ ",
  "██╔══╝  ██║     ██║   ██║ ██╔██╗ ",
  "██║     ███████╗╚██████╔╝██╔╝ ██╗",
  "╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝",
];

/** Full-screen "home" splash shown when the interactive TUI starts. */
export function home(provider: string, modelId: string): void {
  const cwd = process.cwd();
  const lines: string[] = ["", ...FLUX_ART.map((l) => chalk.cyan(l))];
  lines.push("");
  lines.push(`${chalk.bold.cyan("Flux")} ${chalk.dim("— an AI coding agent in your terminal")}`);
  lines.push("");
  lines.push(`${chalk.dim("cwd:")}    ${cwd}`);
  lines.push(`${chalk.dim("model:")}  ${provider}/${modelId}`);
  lines.push("");
  lines.push(
    chalk.dim("Type a task to begin. ") +
      chalk.cyan("/help") +
      chalk.dim(" for commands · ") +
      chalk.cyan("/models") +
      chalk.dim(" to switch model · ") +
      chalk.cyan("Shift+Tab") +
      chalk.dim(" modes · ") +
      chalk.cyan("Esc") +
      chalk.dim(" cancels"),
  );
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Compact one-line header used for headless/one-shot runs. */
export function intro(provider: string, modelId: string): void {
  process.stdout.write(
    `\n${chalk.bold.cyan("Flux")} ${chalk.dim(`· ${provider}/${modelId}`)}\n\n`,
  );
}

export function info(message: string): void {
  process.stdout.write(`${chalk.dim(message)}\n`);
}

export function warn(message: string): void {
  process.stdout.write(`${chalk.yellow(message)}\n`);
}

export function errorLine(message: string): void {
  process.stdout.write(`${chalk.red(message)}\n`);
}

const MAX_BODY_LINES = 14;

function bodyWidth(): number {
  return Math.max(40, Math.min(process.stdout.columns ?? 80, 100) - 3);
}

/** Clamp raw (un-colored) text to a width, adding an ellipsis if needed. */
function clamp(s: string, max: number): string {
  const flat = s.replace(/\t/g, "  ");
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function truncateInline(s: string, n = 80): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

/** Compact one-line preview of a tool's input arguments. */
function previewInput(name: string, input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const str = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : undefined);

  switch (name) {
    case "read":
    case "ls":
    case "write":
    case "edit":
      return str("path") ?? "";
    case "glob":
    case "grep":
      return str("pattern") ?? "";
    case "bash":
      return str("command") ?? "";
    case "task":
      return str("prompt") ?? "";
    default:
      return Object.values(obj)
        .filter((v) => typeof v === "string")
        .join(" ");
  }
}

/** A bordered card: a colored title, indented body lines, and a footer. */
function card(title: string, body: string[], footer: string): void {
  const out: string[] = [chalk.dim("╭─ ") + title];
  for (const line of body) out.push(chalk.dim("│  ") + line);
  out.push(chalk.dim("╰─ ") + footer);
  process.stdout.write(out.join("\n") + "\n");
}

function capLines(lines: string[]): string[] {
  if (lines.length <= MAX_BODY_LINES) return lines;
  const extra = lines.length - MAX_BODY_LINES;
  return [...lines.slice(0, MAX_BODY_LINES), chalk.dim(`… (${extra} more line${extra === 1 ? "" : "s"})`)];
}

/** Block diff: removed lines in red, added lines in green. */
function diffBody(find: string, replace: string): string[] {
  const w = bodyWidth();
  const minus = find.split("\n").map((l) => chalk.red("- " + clamp(l, w - 2)));
  const plus = replace.split("\n").map((l) => chalk.green("+ " + clamp(l, w - 2)));
  return capLines([...minus, ...plus]);
}

function addedBody(content: string): string[] {
  const w = bodyWidth();
  return capLines(content.split("\n").map((l) => chalk.green("+ " + clamp(l, w - 2))));
}

function bashBody(command: string, stdout: string, stderr: string, exitCode: number): string[] {
  const w = bodyWidth();
  const lines: string[] = [chalk.cyan("$ " + clamp(command, w - 2))];
  const out = stdout && stdout !== "(no stdout)" ? stdout.split("\n") : [];
  for (const l of out) lines.push(clamp(l, w));
  if (exitCode !== 0 && stderr && stderr !== "(no stderr)") {
    for (const l of stderr.split("\n")) lines.push(chalk.red(clamp(l, w)));
  }
  return capLines(lines);
}

/**
 * Build the rendering callbacks for one turn. Read-only tools render as a single
 * compact line at call time; mutating tools render as a card (with a diff for
 * edits/writes) at result time, so denied actions never show a fake diff.
 */
export function createRenderer(): AgentEvents & { finish: () => void } {
  let streaming = false;
  const pending = new Map<string, unknown>();

  const breakStream = () => {
    if (streaming) {
      process.stdout.write("\n");
      streaming = false;
    }
  };

  return {
    onTextDelta(text: string) {
      if (!streaming) {
        process.stdout.write(chalk.dim("● "));
        streaming = true;
      }
      process.stdout.write(text);
    },

    onToolCall(name: string, input: unknown, id: string) {
      pending.set(id, input);
      if (READ_ONLY_TOOLS.has(name)) {
        breakStream();
        const preview = truncateInline(previewInput(name, input));
        process.stdout.write(
          `${chalk.blue("⎿")} ${chalk.bold(name)}${preview ? " " + chalk.dim(preview) : ""}\n`,
        );
      }
      // Mutating tools wait for the result so the card can show the outcome.
    },

    onToolResult(name: string, output: unknown, id: string) {
      const input = pending.get(id) as Record<string, unknown> | undefined;
      pending.delete(id);
      if (READ_ONLY_TOOLS.has(name)) return;

      breakStream();
      const out = (output ?? {}) as Record<string, unknown>;

      if (name === "edit" && input) {
        card(
          chalk.magenta.bold("edit") + "  " + chalk.dim(String(input.path ?? "")),
          diffBody(String(input.find ?? ""), String(input.replace ?? "")),
          chalk.green(`✓ replaced ${out.replaced ?? "?"} occurrence(s)`),
        );
        return;
      }
      if (name === "write" && input) {
        card(
          chalk.magenta.bold("write") +
            "  " +
            chalk.dim(`${input.path ?? ""} (${out.action ?? "written"})`),
          addedBody(String(input.content ?? "")),
          chalk.green(`✓ ${out.bytes ?? "?"} bytes`),
        );
        return;
      }
      if (name === "bash") {
        const exitCode = Number(out.exitCode ?? 0);
        card(
          chalk.magenta.bold("bash"),
          bashBody(
            String((input?.command as string) ?? out.command ?? ""),
            String(out.stdout ?? ""),
            String(out.stderr ?? ""),
            exitCode,
          ),
          exitCode === 0
            ? chalk.green("✓ exit 0")
            : chalk.red(`✗ exit ${exitCode}`),
        );
        return;
      }

      // Fallback for any other mutating tool.
      process.stdout.write(
        `  ${chalk.green("✓")} ${chalk.dim(truncateInline(JSON.stringify(out), 100))}\n`,
      );
    },

    onToolError(name: string, error: unknown, id: string) {
      pending.delete(id);
      breakStream();
      const msg = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${chalk.red("✗")} ${chalk.red(`${name}: ${truncateInline(msg, 140)}`)}\n`);
    },

    onError(error: unknown) {
      breakStream();
      const msg = error instanceof Error ? error.message : String(error);
      errorLine(`Error: ${msg}`);
    },

    finish() {
      breakStream();
    },
  };
}
