import { tool } from "ai";
import { z } from "zod";
import { WORKSPACE_ROOT, resolveInWorkspace } from "./fs-safety.ts";

const MAX_OUTPUT = 30_000;

export const grep = tool({
  description:
    "Search file contents in the workspace using ripgrep (regex). Returns " +
    "matching lines with file paths and line numbers. Fast and recursive.",
  inputSchema: z.object({
    pattern: z.string().describe("The regular expression to search for."),
    path: z
      .string()
      .optional()
      .describe("File or directory to scope the search to. Defaults to the workspace."),
    glob: z
      .string()
      .optional()
      .describe('Glob filter, e.g. "*.ts" or "src/**/*.tsx".'),
    ignoreCase: z.boolean().optional().describe("Case-insensitive search."),
  }),
  execute: async ({ pattern, path, glob, ignoreCase }) => {
    const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "50"];
    if (ignoreCase) args.push("--ignore-case");
    if (glob) args.push("--glob", glob);
    args.push("--regexp", pattern);
    args.push(path ? resolveInWorkspace(path) : ".");

    const proc = Bun.spawn(["rg", ...args], {
      cwd: WORKSPACE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // ripgrep exits 1 when there are simply no matches; that's not an error.
    if (exitCode > 1) {
      throw new Error(`ripgrep failed: ${stderr.trim() || `exit ${exitCode}`}`);
    }
    if (exitCode === 1 || stdout.trim() === "") {
      return { pattern, matches: "(no matches)" };
    }

    let output = stdout;
    let truncated = false;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT);
      truncated = true;
    }

    return {
      pattern,
      matches: output.trimEnd(),
      truncated: truncated ? "Output truncated; refine your pattern." : undefined,
    };
  },
});
