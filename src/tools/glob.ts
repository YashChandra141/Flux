import { tool } from "ai";
import { z } from "zod";
import { Glob } from "bun";
import { WORKSPACE_ROOT } from "./fs-safety.ts";

const IGNORED_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".cache", ".flux"];
const MAX_RESULTS = 200;

export const glob = tool({
  description:
    "Find files by name using a glob pattern (e.g. '**/*.ts', 'src/**/*.test.ts'). " +
    "Returns matching file paths relative to the workspace root.",
  inputSchema: z.object({
    pattern: z.string().describe("Glob pattern to match file paths against."),
  }),
  execute: async ({ pattern }) => {
    const g = new Glob(pattern);
    const results: string[] = [];

    for await (const file of g.scan({ cwd: WORKSPACE_ROOT, onlyFiles: true, dot: false })) {
      const normalized = file.replaceAll("\\", "/");
      if (IGNORED_DIRS.some((dir) => normalized.split("/").includes(dir))) continue;
      results.push(normalized);
      if (results.length >= MAX_RESULTS) break;
    }

    results.sort();
    return {
      pattern,
      count: results.length,
      files: results.length ? results.join("\n") : "(no files matched)",
      truncated: results.length >= MAX_RESULTS ? `Showing first ${MAX_RESULTS}.` : undefined,
    };
  },
});
