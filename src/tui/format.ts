const MAX_BODY_LINES = 14;

/** Compact one-line preview of a tool's input arguments. */
export function previewInput(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  switch (name) {
    case "read":
    case "ls":
    case "write":
    case "edit":
      return str("path") ?? "";
    case "glob":
    case "grep":
      return str("pattern") ?? "";
    case "bash":
      return str("command") ?? "";
    case "task":
      return str("prompt") ?? "";
    default:
      return Object.values(input)
        .filter((v) => typeof v === "string")
        .join(" ");
  }
}

export function oneLine(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

export interface DiffLine {
  text: string;
  color?: "red" | "green" | "cyan" | "dim";
}

function cap(lines: DiffLine[]): DiffLine[] {
  if (lines.length <= MAX_BODY_LINES) return lines;
  const extra = lines.length - MAX_BODY_LINES;
  return [
    ...lines.slice(0, MAX_BODY_LINES),
    { text: `… (${extra} more line${extra === 1 ? "" : "s"})`, color: "dim" },
  ];
}

/** Build a block diff (removed lines red, added lines green) for an edit. */
export function editDiff(find: string, replace: string): DiffLine[] {
  const minus: DiffLine[] = find.split("\n").map((l) => ({ text: "- " + l, color: "red" }));
  const plus: DiffLine[] = replace.split("\n").map((l) => ({ text: "+ " + l, color: "green" }));
  return cap([...minus, ...plus]);
}

/** Preview of newly written content as added lines. */
export function writePreview(content: string): DiffLine[] {
  return cap(content.split("\n").map((l) => ({ text: "+ " + l, color: "green" as const })));
}

/** Body lines for a bash result: the command, then stdout (and stderr on failure). */
export function bashBody(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number,
): DiffLine[] {
  const lines: DiffLine[] = [{ text: "$ " + command, color: "cyan" }];
  if (stdout && stdout !== "(no stdout)") {
    for (const l of stdout.split("\n")) lines.push({ text: l });
  }
  if (exitCode !== 0 && stderr && stderr !== "(no stderr)") {
    for (const l of stderr.split("\n")) lines.push({ text: l, color: "red" });
  }
  return cap(lines);
}
