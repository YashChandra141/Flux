import { resolve, relative, isAbsolute } from "node:path";

/** The directory the agent is allowed to touch (where it was launched). */
export const WORKSPACE_ROOT = process.cwd();

/**
 * Resolve a user/model-supplied path against the workspace root and ensure it
 * stays inside it. This is a guardrail so the model can't wander into, say,
 * C:\Windows or /etc via a relative "../../.." path.
 */
export function resolveInWorkspace(inputPath: string): string {
  const absolute = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(WORKSPACE_ROOT, inputPath);

  const rel = relative(WORKSPACE_ROOT, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `Path "${inputPath}" is outside the workspace (${WORKSPACE_ROOT}).`,
    );
  }
  return absolute;
}

/** Display a path relative to the workspace root for nicer output. */
export function displayPath(absolutePath: string): string {
  const rel = relative(WORKSPACE_ROOT, absolutePath);
  return rel === "" ? "." : rel;
}
