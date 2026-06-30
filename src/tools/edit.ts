import { tool } from "ai";
import { z } from "zod";
import { resolveInWorkspace, displayPath } from "./fs-safety.ts";
import { requestPermission } from "../permissions.ts";

export const edit = tool({
  description:
    "Make a precise edit to an existing file by replacing an exact string. " +
    "The 'find' string must appear exactly once unless replaceAll is true. " +
    "Read the file first so your 'find' string matches exactly.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    find: z.string().describe("Exact text to search for (must match verbatim)."),
    replace: z.string().describe("Text to replace it with."),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace every occurrence instead of requiring a unique match."),
  }),
  execute: async ({ path, find, replace, replaceAll }) => {
    const abs = resolveInWorkspace(path);
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${path}. Use 'write' to create it.`);
    }

    const original = await file.text();
    const occurrences = original.split(find).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `The 'find' string was not found in ${path}. Read the file and copy the exact text.`,
      );
    }
    if (occurrences > 1 && !replaceAll) {
      throw new Error(
        `The 'find' string appears ${occurrences} times in ${path}. ` +
          `Add more surrounding context to make it unique, or set replaceAll: true.`,
      );
    }

    await requestPermission(
      "edit",
      `replace ${occurrences} occurrence(s) in ${displayPath(abs)}`,
    );

    const updated = replaceAll
      ? original.split(find).join(replace)
      : original.replace(find, replace);
    await Bun.write(abs, updated);

    return {
      path: displayPath(abs),
      replaced: replaceAll ? occurrences : 1,
    };
  },
});
