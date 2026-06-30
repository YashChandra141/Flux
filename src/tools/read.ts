import { tool } from "ai";
import { z } from "zod";
import { resolveInWorkspace } from "./fs-safety.ts";

const MAX_BYTES = 256 * 1024; // don't blow the context window on huge files

export const read = tool({
  description:
    "Read a UTF-8 text file from the workspace. Returns the file content with " +
    "1-based line numbers. Use this before editing a file.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-based line number to start reading from."),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of lines to read."),
  }),
  execute: async ({ path, offset, limit }) => {
    const abs = resolveInWorkspace(path);
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${path}`);
    }
    if (file.size > MAX_BYTES) {
      throw new Error(
        `File is ${file.size} bytes (limit ${MAX_BYTES}). Use offset/limit to read a slice.`,
      );
    }

    const content = await file.text();
    const allLines = content.split("\n");
    const start = (offset ?? 1) - 1;
    const end = limit ? start + limit : allLines.length;
    const slice = allLines.slice(start, end);

    const numbered = slice
      .map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`)
      .join("\n");

    return {
      path,
      totalLines: allLines.length,
      shown: `${start + 1}-${Math.min(end, allLines.length)}`,
      content: numbered || "(empty file)",
    };
  },
});
