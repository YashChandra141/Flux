import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";

/**
 * Permission modes, mirroring the idea behind Claude Code's Shift+Tab cycle.
 * - default:   ask before every mutating action
 * - auto-edit: auto-approve file writes/edits, still ask before running shell
 * - plan:      read-only; refuse all mutations so the agent proposes instead
 * - yolo:      approve everything (use with care)
 */
export type PermissionMode = "default" | "auto-edit" | "plan" | "yolo";

export type PermissionKind = "write" | "edit" | "bash";

export const MODE_ORDER: PermissionMode[] = ["default", "auto-edit", "plan", "yolo"];

export const MODE_LABELS: Record<PermissionMode, string> = {
  default: "default (ask each time)",
  "auto-edit": "auto-edit (auto file changes, ask for shell)",
  plan: "plan (read-only)",
  yolo: "yolo (approve everything)",
};

let currentMode: PermissionMode = "default";
const sessionAllow = new Set<PermissionKind>();

export function getMode(): PermissionMode {
  return currentMode;
}

export function setMode(mode: PermissionMode): void {
  currentMode = mode;
}

/** Advance to the next mode (used by the hotkey / slash command). */
export function cycleMode(): PermissionMode {
  const idx = MODE_ORDER.indexOf(currentMode);
  currentMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length]!;
  return currentMode;
}

/** Thrown when the user (or plan mode) refuses an action. */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

/** The user's decision for a single permission request. */
export type PermissionDecision = "once" | "always" | "no";

/**
 * How approvals are collected. Swappable so the same gate works for the inline
 * (clack) UI and the Ink TUI (which resolves it from a modal). Defaults to clack.
 */
export type PermissionAsker = (
  kind: PermissionKind,
  summary: string,
) => Promise<PermissionDecision>;

async function clackAsker(
  kind: PermissionKind,
  summary: string,
): Promise<PermissionDecision> {
  process.stdout.write("\n");
  const choice = await select({
    message: `${chalk.yellow("Permission needed")} — ${kind}: ${chalk.dim(summary)}`,
    options: [
      { value: "once", label: "Yes, run it once" },
      { value: "always", label: `Yes, and don't ask again for "${kind}" this session` },
      { value: "no", label: "No, reject this action" },
    ],
    initialValue: "once",
  });
  if (isCancel(choice)) return "no";
  return choice as PermissionDecision;
}

let asker: PermissionAsker = clackAsker;

export function setPermissionAsker(fn: PermissionAsker): void {
  asker = fn;
}

function autoApproved(kind: PermissionKind): boolean {
  if (currentMode === "yolo") return true;
  if (currentMode === "auto-edit" && (kind === "write" || kind === "edit")) return true;
  if (sessionAllow.has(kind)) return true;
  return false;
}

/**
 * The single gate every mutating tool calls before touching the system. It
 * either returns (approved) or throws PermissionDeniedError, which the agent
 * loop surfaces back to the model as a tool error so it can adapt.
 */
export async function requestPermission(
  kind: PermissionKind,
  summary: string,
): Promise<void> {
  if (currentMode === "plan") {
    throw new PermissionDeniedError(
      `Plan mode is active, so the "${kind}" action was not run. ` +
        `Describe the change you would make instead of performing it.`,
    );
  }

  if (autoApproved(kind)) return;

  const decision = await asker(kind, summary);
  if (decision === "no") {
    throw new PermissionDeniedError(`User rejected the "${kind}" action: ${summary}`);
  }
  if (decision === "always") {
    sessionAllow.add(kind);
  }
}
