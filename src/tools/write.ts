import { tool } from "ai";
import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInWorkspace, displayPath } from "./fs-safety.ts";
import { requestPermission } from "../permissions.ts";

export const write = tool({
  description:
    "Create a new file or overwrite an existing one with the given content. " +
    "Creates parent directories as needed. Prefer 'edit' for small changes to " +
    "existing files.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the workspace root."),
    content: z.string().describe("The full content to write to the file."),
  }),
  execute: async ({ path, content }) => {
    const abs = resolveInWorkspace(path);
    const existed = await Bun.file(abs).exists();

    await requestPermission(
      "write",
      `${existed ? "overwrite" : "create"} ${displayPath(abs)} (${content.length} chars)`,
    );

    await mkdir(dirname(abs), { recursive: true });
    await Bun.write(abs, content);

    return {
      path: displayPath(abs),
      action: existed ? "overwritten" : "created",
      bytes: Buffer.byteLength(content, "utf8"),
    };
  },
});
