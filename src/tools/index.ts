import { read } from "./read.ts";
import { ls } from "./ls.ts";
import { grep } from "./grep.ts";
import { glob } from "./glob.ts";
import { write } from "./write.ts";
import { edit } from "./edit.ts";
import { bash } from "./bash.ts";
import { task } from "./task.ts";

/**
 * The full tool registry handed to the model. Read-only tools are safe to run
 * automatically; mutating tools (write/edit/bash) gate themselves through the
 * permission system before doing anything.
 */
export const tools = {
  read,
  ls,
  grep,
  glob,
  write,
  edit,
  bash,
  task,
} as const;

/** Tools that don't change anything on disk — used to auto-approve in the UI. */
export const READ_ONLY_TOOLS = new Set(["read", "ls", "grep", "glob", "task"]);

export type ToolName = keyof typeof tools;
