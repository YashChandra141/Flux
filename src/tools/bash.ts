import { tool } from "ai";
import { z } from "zod";
import { WORKSPACE_ROOT } from "./fs-safety.ts";
import { requestPermission } from "../permissions.ts";

const MAX_OUTPUT = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export const bash = tool({
  description:
    "Run a shell command in the workspace directory and return its stdout, " +
    "stderr, and exit code. Use for builds, tests, git, installing packages, " +
    "etc. Always requires user approval. Avoid long-running/interactive commands.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute."),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(600_000)
      .optional()
      .describe("Timeout in milliseconds (default 60000)."),
  }),
  execute: async ({ command, timeoutMs }) => {
    await requestPermission("bash", command);

    // Use the platform shell so the model can use familiar syntax.
    const isWindows = process.platform === "win32";
    const argv = isWindows
      ? ["cmd", "/c", command]
      : ["/bin/sh", "-c", command];

    const proc = Bun.spawn(argv, {
      cwd: WORKSPACE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => proc.kill(), timeout);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    const clip = (s: string) =>
      s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…(truncated)" : s;

    return {
      command,
      exitCode,
      stdout: clip(stdout.trimEnd()) || "(no stdout)",
      stderr: clip(stderr.trimEnd()) || "(no stderr)",
    };
  },
});
