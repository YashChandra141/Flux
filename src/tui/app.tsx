import { useReducer, useRef, useState, useEffect } from "react";
import { Box, Text, Static, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { LanguageModel } from "ai";
import { runAgentTurn, type AgentEvents } from "../agent.ts";
import { tools } from "../tools/index.ts";
import { Conversation } from "../context.ts";
import {
  buildModel,
  resolveModelAlias,
  listAvailableModels,
  type ProviderName,
} from "../provider.ts";
import {
  setPermissionAsker,
  cycleMode,
  setMode,
  getMode,
  MODE_ORDER,
  MODE_LABELS,
  type PermissionMode,
  type PermissionKind,
  type PermissionDecision,
} from "../permissions.ts";
import { ItemView, StatusBar, PermissionModal, ModelPicker, type PickerOption } from "./views.tsx";
import { nextKey, type Item, type ToolItem } from "./types.ts";

interface AppProps {
  model: LanguageModel;
  system: string;
  convo: Conversation;
  provider: ProviderName;
  modelId: string;
}

interface State {
  history: Item[];
  activeAssistant: string | null;
  runningTools: ToolItem[];
  status: "idle" | "thinking";
  mode: PermissionMode;
  totalTokens?: number;
  pending: { kind: PermissionKind; summary: string } | null;
  model: LanguageModel;
  modelId: string;
  picker: PickerState | null;
}

interface PickerState {
  options: PickerOption[];
  index: number;
  filter: string;
  loading: boolean;
}

/** Options matching the current filter (case-insensitive substring). */
function pickerVisible(p: PickerState): PickerOption[] {
  if (!p.filter) return p.options;
  const f = p.filter.toLowerCase();
  return p.options.filter((o) => o.label.toLowerCase().includes(f));
}

type Action =
  | { type: "user"; text: string }
  | { type: "info"; text: string }
  | { type: "agentError"; text: string }
  | { type: "delta"; text: string }
  | { type: "toolCall"; tool: ToolItem }
  | { type: "toolDone"; id: string; output: Record<string, unknown> }
  | { type: "toolError"; id: string; error: string }
  | { type: "turnStart" }
  | { type: "turnEnd"; totalTokens?: number }
  | { type: "setMode"; mode: PermissionMode }
  | { type: "setModel"; model: LanguageModel; modelId: string }
  | { type: "setPending"; pending: State["pending"] }
  | { type: "openPicker" }
  | { type: "setPickerOptions"; options: PickerOption[]; index: number }
  | { type: "movePicker"; delta: number }
  | { type: "filterPicker"; ch: string }
  | { type: "backspacePicker" }
  | { type: "closePicker" };

function textItem(type: "user" | "assistant" | "info" | "error", text: string): Item {
  return { type, key: nextKey(), text };
}

function flushAssistant(state: State): Item[] {
  if (state.activeAssistant && state.activeAssistant.trim()) {
    return [...state.history, textItem("assistant", state.activeAssistant)];
  }
  return state.history;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "user":
      return { ...state, history: [...state.history, textItem("user", action.text)] };
    case "info":
      return { ...state, history: [...state.history, textItem("info", action.text)] };
    case "agentError":
      return { ...state, history: [...state.history, textItem("error", action.text)] };
    case "delta":
      return { ...state, activeAssistant: (state.activeAssistant ?? "") + action.text };
    case "toolCall":
      // Streaming text before a tool call is finalized into history.
      return {
        ...state,
        history: flushAssistant(state),
        activeAssistant: null,
        runningTools: [...state.runningTools, action.tool],
      };
    case "toolDone": {
      const tool = state.runningTools.find((t) => t.id === action.id);
      if (!tool) return state;
      return {
        ...state,
        runningTools: state.runningTools.filter((t) => t.id !== action.id),
        history: [...state.history, { ...tool, status: "done", output: action.output }],
      };
    }
    case "toolError": {
      const tool = state.runningTools.find((t) => t.id === action.id);
      if (!tool) return state;
      return {
        ...state,
        runningTools: state.runningTools.filter((t) => t.id !== action.id),
        history: [...state.history, { ...tool, status: "error", error: action.error }],
      };
    }
    case "turnStart":
      return { ...state, status: "thinking" };
    case "turnEnd":
      return {
        ...state,
        history: flushAssistant(state),
        activeAssistant: null,
        status: "idle",
        totalTokens: action.totalTokens ?? state.totalTokens,
      };
    case "setMode":
      return { ...state, mode: action.mode };
    case "setModel":
      return { ...state, model: action.model, modelId: action.modelId };
    case "setPending":
      return { ...state, pending: action.pending };
    case "openPicker":
      return { ...state, picker: { options: [], index: 0, filter: "", loading: true } };
    case "setPickerOptions":
      if (!state.picker) return state;
      return {
        ...state,
        picker: { ...state.picker, options: action.options, index: action.index, loading: false },
      };
    case "movePicker": {
      if (!state.picker) return state;
      const n = pickerVisible(state.picker).length;
      if (n === 0) return state;
      const index = (state.picker.index + action.delta + n) % n;
      return { ...state, picker: { ...state.picker, index } };
    }
    case "filterPicker":
      if (!state.picker) return state;
      return { ...state, picker: { ...state.picker, filter: state.picker.filter + action.ch, index: 0 } };
    case "backspacePicker":
      if (!state.picker) return state;
      return { ...state, picker: { ...state.picker, filter: state.picker.filter.slice(0, -1), index: 0 } };
    case "closePicker":
      return { ...state, picker: null };
  }
}

const HELP = [
  "Commands: /help  /model [id]  /models  /mode [name]  /clear  /exit",
  `Modes: ${MODE_ORDER.join(" | ")} (Shift+Tab cycles). Esc cancels a running turn.`,
].join("\n");

export function App({ model, system, convo, provider, modelId }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    history: [],
    activeAssistant: null,
    runningTools: [],
    status: "idle",
    mode: getMode(),
    pending: null,
    model,
    modelId,
    picker: null,
  });
  const [inputValue, setInputValue] = useState("");

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const resolverRef = useRef<((d: PermissionDecision) => void) | null>(null);

  // Route tool permission requests into the modal instead of clack.
  useEffect(() => {
    setPermissionAsker(
      (kind, summary) =>
        new Promise<PermissionDecision>((resolve) => {
          resolverRef.current = resolve;
          dispatch({ type: "setPending", pending: { kind, summary } });
        }),
    );
  }, []);

  function decide(d: PermissionDecision) {
    dispatch({ type: "setPending", pending: null });
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(d);
  }

  useInput((input, key) => {
    if (resolverRef.current) {
      if (input === "y") decide("once");
      else if (input === "a") decide("always");
      else if (input === "n" || key.escape) decide("no");
      return;
    }
    if (state.picker) {
      const p = state.picker;
      if (p.loading) {
        if (key.escape) dispatch({ type: "closePicker" });
        return;
      }
      if (key.escape) dispatch({ type: "closePicker" });
      else if (key.upArrow) dispatch({ type: "movePicker", delta: -1 });
      else if (key.downArrow) dispatch({ type: "movePicker", delta: 1 });
      else if (key.return) {
        const opt = pickerVisible(p)[p.index];
        dispatch({ type: "closePicker" });
        if (opt) switchModel(opt.value);
      } else if (key.backspace || key.delete) {
        dispatch({ type: "backspacePicker" });
      } else if (input && !key.ctrl && !key.meta && !key.tab) {
        dispatch({ type: "filterPicker", ch: input });
      }
      return;
    }
    if (key.tab && key.shift) {
      dispatch({ type: "setMode", mode: cycleMode() });
      return;
    }
    if (key.escape && busyRef.current) {
      abortRef.current?.abort();
    }
  });

  async function runTask(prompt: string) {
    dispatch({ type: "user", text: prompt });
    dispatch({ type: "turnStart" });
    convo.addUser(prompt);
    try {
      if (await convo.maybeCompact()) {
        dispatch({ type: "info", text: "(compacted earlier conversation to save context)" });
      }
    } catch {
      // ignore compaction errors
    }

    const ac = new AbortController();
    abortRef.current = ac;

    const events: AgentEvents = {
      onTextDelta: (t) => dispatch({ type: "delta", text: t }),
      onToolCall: (name, input, id) =>
        dispatch({
          type: "toolCall",
          tool: {
            type: "tool",
            key: nextKey(),
            id,
            name,
            input: (input ?? {}) as Record<string, unknown>,
            status: "running",
          },
        }),
      onToolResult: (_name, output, id) =>
        dispatch({ type: "toolDone", id, output: (output ?? {}) as Record<string, unknown> }),
      onToolError: (_name, error, id) =>
        dispatch({
          type: "toolError",
          id,
          error: error instanceof Error ? error.message : String(error),
        }),
      onError: (error) =>
        dispatch({
          type: "agentError",
          text: "Error: " + (error instanceof Error ? error.message : String(error)),
        }),
    };

    try {
      const result = await runAgentTurn({
        model: state.model,
        system,
        messages: convo.messages,
        tools,
        events,
        abortSignal: ac.signal,
      });
      dispatch({ type: "turnEnd", totalTokens: result.usage?.totalTokens });
    } catch (err) {
      dispatch({
        type: "agentError",
        text: "Turn failed: " + (err instanceof Error ? err.message : String(err)),
      });
      dispatch({ type: "turnEnd" });
    } finally {
      abortRef.current = null;
    }
  }

  async function openModelPicker() {
    dispatch({ type: "openPicker" });
    const ids = await listAvailableModels(provider, state.modelId);
    const options: PickerOption[] = ids.map((id) => ({ label: id, value: id }));
    const index = Math.max(
      0,
      options.findIndex((o) => o.value === state.modelId),
    );
    dispatch({ type: "setPickerOptions", options, index });
  }

  function switchModel(arg: string) {
    const id = resolveModelAlias(arg);
    try {
      const next = buildModel(provider, id);
      convo.setModel(next);
      dispatch({ type: "setModel", model: next, modelId: id });
      dispatch({ type: "info", text: `Switched model to ${id}` });
    } catch (err) {
      dispatch({
        type: "info",
        text: `Could not switch model: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  function handleSlash(raw: string) {
    const [cmd, arg] = raw.slice(1).split(/\s+/, 2);
    switch (cmd) {
      case "exit":
      case "quit":
        exit();
        return;
      case "models":
      case "model":
        if (arg) switchModel(arg);
        else void openModelPicker();
        return;
      case "clear":
        convo.clear();
        dispatch({ type: "info", text: "Context cleared." });
        return;
      case "help":
        dispatch({ type: "info", text: HELP });
        return;
      case "mode":
        if (arg && (MODE_ORDER as string[]).includes(arg)) {
          setMode(arg as PermissionMode);
          dispatch({ type: "setMode", mode: arg as PermissionMode });
        } else if (arg) {
          dispatch({ type: "info", text: `Unknown mode "${arg}". Options: ${MODE_ORDER.join(", ")}` });
          return;
        } else {
          dispatch({ type: "setMode", mode: cycleMode() });
        }
        dispatch({ type: "info", text: `Permission mode: ${MODE_LABELS[getMode()]}` });
        return;
      default:
        dispatch({ type: "info", text: `Unknown command "/${cmd}". Type /help.` });
    }
  }

  function handleSubmit(value: string) {
    const trimmed = value.trim();
    setInputValue("");
    if (!trimmed || busyRef.current) return;
    if (trimmed.startsWith("/")) {
      handleSlash(trimmed);
      return;
    }
    busyRef.current = true;
    void runTask(trimmed).finally(() => {
      busyRef.current = false;
    });
  }

  const thinkingIdle =
    state.status === "thinking" &&
    state.runningTools.length === 0 &&
    state.activeAssistant === null;

  return (
    <Box flexDirection="column">
      <Static items={state.history}>{(item) => <ItemView key={item.key} item={item} />}</Static>

      <Box flexDirection="column">
        {state.runningTools.map((t) => (
          <ItemView key={t.key} item={t} />
        ))}

        {state.activeAssistant !== null ? (
          <ItemView item={{ type: "assistant", key: -1, text: state.activeAssistant }} />
        ) : null}

        {thinkingIdle ? (
          <Text color="yellow">
            <Spinner type="dots" /> thinking…
          </Text>
        ) : null}

        {state.pending ? (
          <PermissionModal kind={state.pending.kind} summary={state.pending.summary} />
        ) : state.picker ? (
          <ModelPicker
            options={pickerVisible(state.picker)}
            index={state.picker.index}
            filter={state.picker.filter}
            current={state.modelId}
            total={state.picker.options.length}
            loading={state.picker.loading}
          />
        ) : (
          <Box borderStyle="round" paddingX={1} marginTop={1}>
            <Text color="green">› </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              focus={state.status === "idle"}
              placeholder="Describe a task, or /help"
            />
          </Box>
        )}

        <StatusBar
          mode={state.mode}
          status={state.status}
          totalTokens={state.totalTokens}
          modelId={state.modelId}
        />
      </Box>
    </Box>
  );
}
