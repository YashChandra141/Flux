import { readdir } from "node:fs/promises";
import { WORKSPACE_ROOT } from "./tools/fs-safety.ts";

const IGNORED = new Set(["node_modules", ".git", ".flux", "dist", "build"]);

async function topLevelListing(): Promise<string> {
  try {
    const entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
    return entries
      .filter((e) => !IGNORED.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort()
      .slice(0, 60)
      .join(", ");
  } catch {
    return "(unavailable)";
  }
}

async function gitState(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: WORKSPACE_ROOT,
      stdout: "pipe",
      stderr: "ignore",
    });
    const branch = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0 || !branch) return "not a git repository";

    const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
      cwd: WORKSPACE_ROOT,
      stdout: "pipe",
      stderr: "ignore",
    });
    const dirty = (await new Response(statusProc.stdout).text()).trim();
    const changed = dirty ? dirty.split("\n").length : 0;
    return `branch ${branch}, ${changed} uncommitted file(s)`;
  } catch {
    return "unknown";
  }
}

/** Build the system prompt, including a snapshot of the environment. */
export async function buildSystemPrompt(): Promise<string> {
  const [listing, git] = await Promise.all([topLevelListing(), gitState()]);

  return `You are Flux, a terminal-based AI coding agent that helps the user with software engineering tasks in their workspace.

You operate in a loop: you can call tools to read and modify files and run shell commands, observe the results, and continue until the task is done. When the task is complete, stop calling tools and give a short final summary.

# Tools
- read: read a file (with line numbers). Read before you edit.
- ls: list a directory.
- glob: find files by name pattern (e.g. **/*.ts).
- grep: search file contents with regex (ripgrep).
- write: create or overwrite a file.
- edit: replace an exact string in an existing file (preferred for small changes).
- bash: run a shell command (builds, tests, git, etc.).

# Working principles
- Gather context first: explore with ls/glob/grep and read relevant files before changing anything.
- Make the smallest change that solves the problem. Prefer 'edit' over 'write' for existing files.
- After changing code, verify when possible (run the build, tests, or type-check via bash).
- File-modifying and shell actions may require the user's approval; if an action is denied, adapt or explain instead of retrying blindly.
- Keep responses concise. Do not narrate every step; summarize what you did and why.
- Never invent file contents — read files to confirm before editing.

# Environment
- OS: ${process.platform} (${process.arch})
- Working directory: ${WORKSPACE_ROOT}
- Git: ${git}
- Top-level entries: ${listing || "(empty)"}
`;
}
