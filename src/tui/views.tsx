import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { READ_ONLY_TOOLS } from "../tools/index.ts";
import type { PermissionMode } from "../permissions.ts";
import { MODE_LABELS } from "../permissions.ts";
import type { Item, ToolItem } from "./types.ts";
import {
  previewInput,
  oneLine,
  editDiff,
  writePreview,
  bashBody,
  type DiffLine,
} from "./format.ts";

export function Banner({ provider, modelId }: { provider: string; modelId: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color="cyan">
          Flux
        </Text>
        <Text dimColor> — an AI coding agent in your terminal</Text>
      </Text>
      <Text dimColor>
        model: {provider}/{modelId}
      </Text>
      <Text dimColor>
        Type a task. Slash: /help /mode /clear /exit · Shift+Tab cycles mode ·
        Esc cancels
      </Text>
    </Box>
  );
}

function BodyLines({ lines }: { lines: DiffLine[] }) {
  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i} color={l.color === "dim" ? undefined : l.color} dimColor={l.color === "dim"}>
          {l.text}
        </Text>
      ))}
    </Box>
  );
}

function mutationBody(tool: ToolItem): { lines: DiffLine[]; footer: string; footerColor: string } {
  const input = tool.input;
  const out = tool.output ?? {};
  if (tool.name === "edit") {
    return {
      lines: editDiff(String(input.find ?? ""), String(input.replace ?? "")),
      footer: `✓ replaced ${out.replaced ?? "?"} occurrence(s)`,
      footerColor: "green",
    };
  }
  if (tool.name === "write") {
    return {
      lines: writePreview(String(input.content ?? "")),
      footer: `✓ ${out.bytes ?? "?"} bytes (${out.action ?? "written"})`,
      footerColor: "green",
    };
  }
  // bash
  const exitCode = Number(out.exitCode ?? 0);
  return {
    lines: bashBody(
      String(input.command ?? out.command ?? ""),
      String(out.stdout ?? ""),
      String(out.stderr ?? ""),
      exitCode,
    ),
    footer: exitCode === 0 ? "✓ exit 0" : `✗ exit ${exitCode}`,
    footerColor: exitCode === 0 ? "green" : "red",
  };
}

export function ToolView({ tool }: { tool: ToolItem }) {
  const readOnly = READ_ONLY_TOOLS.has(tool.name);

  // Read-only tools render as a single compact line.
  if (readOnly) {
    const preview = oneLine(previewInput(tool.name, tool.input));
    return (
      <Text>
        <Text color="blue">⎿ </Text>
        <Text bold>{tool.name}</Text>
        {preview ? <Text dimColor> {preview}</Text> : null}
        {tool.status === "running" ? (
          <Text color="blue">
            {" "}
            <Spinner type="dots" />
          </Text>
        ) : null}
        {tool.status === "error" ? <Text color="red"> ✗</Text> : null}
      </Text>
    );
  }

  // Mutating tools render as a bordered card.
  const path = typeof tool.input.path === "string" ? tool.input.path : "";
  const title = path ? `${tool.name}  ${path}` : tool.name;

  if (tool.status === "running") {
    return (
      <Box borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text>
          <Text bold color="magenta">
            {title}
          </Text>{" "}
          <Text color="yellow">
            <Spinner type="dots" /> waiting/running
          </Text>
        </Text>
      </Box>
    );
  }

  if (tool.status === "error") {
    return (
      <Box borderStyle="round" borderColor="red" paddingX={1} flexDirection="column">
        <Text bold color="magenta">
          {title}
        </Text>
        <Text color="red">✗ {oneLine(tool.error ?? "failed", 140)}</Text>
      </Box>
    );
  }

  const { lines, footer, footerColor } = mutationBody(tool);
  return (
    <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
      <Text bold color="magenta">
        {title}
      </Text>
      <BodyLines lines={lines} />
      <Text color={footerColor}>{footer}</Text>
    </Box>
  );
}

export function ItemView({ item }: { item: Item }) {
  if (item.type === "tool") return <ToolView tool={item} />;
  if (item.type === "user") {
    return (
      <Text>
        <Text color="green">› </Text>
        <Text>{item.text}</Text>
      </Text>
    );
  }
  if (item.type === "assistant") {
    return (
      <Text>
        <Text dimColor>● </Text>
        <Text>{item.text}</Text>
      </Text>
    );
  }
  if (item.type === "info") return <Text dimColor>{item.text}</Text>;
  return <Text color="red">{item.text}</Text>;
}

export function StatusBar({
  mode,
  status,
  totalTokens,
  modelId,
}: {
  mode: PermissionMode;
  status: "idle" | "thinking";
  totalTokens?: number;
  modelId?: string;
}) {
  const modeColor =
    mode === "yolo" ? "red" : mode === "plan" ? "blue" : mode === "auto-edit" ? "yellow" : "gray";
  return (
    <Box marginTop={1}>
      <Text color={modeColor}>{MODE_LABELS[mode].split(" ")[0]}</Text>
      <Text dimColor>
        {modelId ? ` · ${modelId}` : ""} · {status === "thinking" ? "thinking…" : "ready"}
        {typeof totalTokens === "number" ? ` · ${totalTokens} tok` : ""} · Shift+Tab mode · Esc
        cancel
      </Text>
    </Box>
  );
}

export interface PickerOption {
  label: string;
  value: string;
}

const PICKER_WINDOW = 12;

export function ModelPicker({
  options,
  index,
  filter,
  current,
  total,
  loading,
}: {
  options: PickerOption[];
  index: number;
  filter: string;
  current: string;
  total: number;
  loading?: boolean;
}) {
  // Keep the highlighted row centered within a fixed-height scroll window.
  const start = Math.max(0, Math.min(index - Math.floor(PICKER_WINDOW / 2), options.length - PICKER_WINDOW));
  const windowStart = Math.max(0, start);
  const slice = options.slice(windowStart, windowStart + PICKER_WINDOW);

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Select a model
      </Text>
      <Text dimColor>↑/↓ move · type to filter · Enter select · Esc cancel</Text>

      {loading ? (
        <Text color="yellow">
          <Spinner type="dots" /> loading models…
        </Text>
      ) : (
        <>
          <Text dimColor>
            filter: {filter || "(none)"} · showing {options.length} of {total}
          </Text>
          {windowStart > 0 ? <Text dimColor>  ▲ more</Text> : null}
          {slice.length === 0 ? <Text dimColor>  (no matches)</Text> : null}
          {slice.map((o, i) => {
            const absolute = windowStart + i;
            const selected = absolute === index;
            const isCurrent = o.value === current;
            return (
              <Text key={o.value} color={selected ? "cyan" : undefined} inverse={selected}>
                {selected ? "› " : "  "}
                {o.label}
                {isCurrent ? " (current)" : ""}
              </Text>
            );
          })}
          {windowStart + PICKER_WINDOW < options.length ? <Text dimColor>  ▼ more</Text> : null}
        </>
      )}
    </Box>
  );
}

export function PermissionModal({ kind, summary }: { kind: string; summary: string }) {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      flexDirection="column"
      marginTop={1}
    >
      <Text>
        <Text color="yellow" bold>
          Permission needed
        </Text>
        <Text> — {kind}</Text>
      </Text>
      <Text dimColor>{oneLine(summary, 160)}</Text>
      <Text>
        <Text color="green">[y]</Text> yes once {"  "}
        <Text color="green">[a]</Text> always for {kind} {"  "}
        <Text color="red">[n]</Text> no
      </Text>
    </Box>
  );
}
