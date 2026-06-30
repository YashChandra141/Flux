import { tool } from "ai";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveInWorkspace, displayPath } from "./fs-safety.ts";

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".flux",
  "dist",
  "build",
  ".next",
  ".cache",
]);

export const ls = tool({
  description:
    "List the contents of a directory in the workspace (non-recursive). " +
    "Directories are suffixed with '/'. Use this to explore the project layout.",
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory path relative to the workspace root. Defaults to '.'."),
  }),
  execute: async ({ path }) => {
    const abs = resolveInWorkspace(path ?? ".");
    const entries = await readdir(abs, { withFileTypes: true });

    const items = entries
      .filter((e) => !IGNORED.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort((a, b) => {
        const aDir = a.endsWith("/");
        const bDir = b.endsWith("/");
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.localeCompare(b);
      });

    return {
      path: displayPath(abs),
      count: items.length,
      entries: items.length ? items.join("\n") : "(empty directory)",
      hint: "Some folders like node_modules/.git are hidden.",
    };
  },
});
