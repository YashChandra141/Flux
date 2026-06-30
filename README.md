# Flux

Flux is an AI coding agent in your terminal — the same core pattern behind
OpenCode, Codex CLI, and Claude Code — built on **Bun + the Vercel AI SDK v5**.

It is small enough to read in one sitting, but it actually works: it streams
model output, calls tools to read/search/edit files and run shell commands,
asks permission before mutating anything, and manages its own context window.

## The big idea

A coding agent is not magic. It is a **loop**:

```
call the model  →  it asks to use tools  →  run the tools  →  feed results back  →  repeat
```

The loop ends when the model stops asking for tools and just answers. The
"intelligence" is the LLM; the *product* is the harness around it — tools,
permissions, context management, and UI. That harness is what this repo is.

```
user prompt
   │
   ▼
append to history ──► call LLM (system + tools + history)
   ▲                          │
   │                 ┌────────┴────────┐
   │                 │ text?  tool call?│
   │                 └───┬─────────┬────┘
   │             answer  │         │ permission gate
   │  (done) ◄───────────┘         ▼
   │                        execute tool
   └──────── feed result back ─────┘
```

## Requirements

- [Bun](https://bun.sh) >= 1.1
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on your PATH (used by the `grep` tool)
- An API key for one of: NVIDIA NIM, Anthropic, OpenAI, or Google

## Setup

```bash
bun install
cp .env.example .env   # then put your API key in .env
```

Set a key in `.env` (or several — it auto-picks in priority order
nvidia → anthropic → openai → google):

```
NVIDIA_API_KEY=nvapi-...
# optional overrides:
# FLUX_PROVIDER=nvidia
# FLUX_MODEL=meta/llama-3.3-70b-instruct
```

### NVIDIA NIM (free hosted models)

[build.nvidia.com](https://build.nvidia.com/models) gives you a free,
OpenAI-compatible API (base URL `https://integrate.api.nvidia.com/v1`) with
many hosted models. The agent talks to it via the OpenAI provider with a custom
base URL. These curated models all support the tool calling this agent needs:

| Model id                                   | Why                                    |
| ------------------------------------------ | -------------------------------------- |
| `meta/llama-3.3-70b-instruct`              | Default — reliable tool calling        |
| `moonshotai/kimi-k2.6`                     | Kimi — agentic coding / tool use       |
| `z-ai/glm5.1`                              | GLM — agentic coding, reasoning, tools |
| `qwen/qwen3-235b-a22b`                     | Qwen3 — large MoE, tool calling        |
| `qwen/qwen2.5-coder-32b-instruct`          | Qwen — coding specialist               |
| `minimaxai/minimax-m2.7`                   | MiniMax — coding + reasoning           |
| `google/gemma-3-27b-it`                    | Gemma — general (weaker tool calling)  |
| `deepseek-ai/deepseek-v3.1`                | Strong general + coding                |
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | Reasoning + tool calling, efficient    |
| `mistralai/mistral-nemotron`               | Built for agentic workflows            |

Pick one by setting `FLUX_MODEL` in `.env`, or switch live in the TUI with `/models`.

## Run

Interactive REPL:

```bash
bun start
```

One-shot (run a single task and exit):

```bash
bun start "add a hello function to src/index.ts and run the type-check"
```

Compile to a single standalone binary:

```bash
bun run compile     # produces ./flux
```

### Slash commands

| Command         | What it does                                              |
| --------------- | --------------------------------------------------------- |
| `/help`         | Show help                                                 |
| `/mode [name]`  | Cycle or set the permission mode                          |
| `/clear`        | Clear the conversation history                            |
| `/exit` `/quit` | Leave                                                     |

### Permission modes

Like Claude Code's permission cycle, mutating actions are gated:

- **default** — ask before every write/edit/shell command
- **auto-edit** — auto-approve file changes, still ask before shell commands
- **plan** — read-only; the agent proposes changes instead of making them
- **yolo** — approve everything (be careful)

## How it maps to the codebase

| Concept                | File                                                   |
| ---------------------- | ------------------------------------------------------ |
| The agent loop         | [`src/agent.ts`](src/agent.ts)                         |
| Provider selection     | [`src/provider.ts`](src/provider.ts)                   |
| System prompt + env    | [`src/prompts.ts`](src/prompts.ts)                     |
| Permission gate        | [`src/permissions.ts`](src/permissions.ts)             |
| Context / compaction   | [`src/context.ts`](src/context.ts)                     |
| Entry point            | [`src/cli.ts`](src/cli.ts)                             |
| Full-screen TUI (Ink)  | [`src/tui/`](src/tui)                                  |
| Inline one-shot render | [`src/ui.ts`](src/ui.ts)                               |
| Tools                  | [`src/tools/`](src/tools)                              |

### UI: interactive TUI vs one-shot

- **Interactive** (`bun start`) launches a full-screen [Ink](https://github.com/vadimdemedes/ink)
  (React-for-the-terminal) TUI: a scrollback transcript via `<Static>`, live
  tool cards with spinners and diffs, a sticky input box, a status bar, and an
  in-app permission modal. Press **Shift+Tab** to cycle permission modes and
  **Esc** to cancel a running turn.
- **One-shot** (`bun start "task"`) skips the TUI and uses the lightweight inline
  renderer in [`src/ui.ts`](src/ui.ts), which is pipe-friendly.

Both share the exact same agent loop and tools — the only difference is the
implementation of the `AgentEvents` interface and the permission asker
(`setPermissionAsker`), so the TUI never touches [`src/agent.ts`](src/agent.ts).

### Tools

| Tool   | Type      | Purpose                                         |
| ------ | --------- | ----------------------------------------------- |
| `read` | read-only | Read a file with line numbers                   |
| `ls`   | read-only | List a directory                                |
| `glob` | read-only | Find files by name pattern                      |
| `grep` | read-only | Search file contents (ripgrep)                  |
| `task` | read-only | Spawn a read-only sub-agent for big searches    |
| `write`| mutating  | Create/overwrite a file                         |
| `edit` | mutating  | Replace an exact string in a file               |
| `bash` | mutating  | Run a shell command                             |

Mutating tools call `requestPermission(...)` before doing anything; if you
deny, the model receives an error and adapts instead of crashing.

## Tech stack & why

| Layer            | Choice                          | Why                                              |
| ---------------- | ------------------------------- | ------------------------------------------------ |
| Runtime          | Bun                             | Fast startup, native shell/FS, single-binary compile |
| Language         | TypeScript                      | Same ecosystem as OpenCode/Claude Code           |
| LLM layer        | Vercel AI SDK v5 (`ai`)         | Provider-agnostic streaming + tool calling       |
| Tool schemas     | Zod v4                          | Describes tool inputs to the model + validates   |
| Interactive TUI  | Ink (React) + ink-text-input    | Full-screen terminal UI: cards, input, status    |
| One-shot / prompts | `@clack/prompts` + `chalk`    | Inline rendering and approvals for headless runs |
| Search           | ripgrep                         | Fast recursive code search                       |

## What a "real" agent adds (left as exercises)

This is intentionally minimal. Production agents layer on:

- **Streaming tool execution** while the model is still generating.
- **Multi-stage context compaction** (summaries + collapse, not one naive pass).
- **LSP/diagnostics feedback** after edits so the model self-corrects type errors.
- **MCP client** support to plug in external tool servers.
- **Session persistence** (e.g. `bun:sqlite`) and resumable conversations.
- **A rich TUI** (OpenCode built its own; Ink is the easy TS option).

## Building the same thing in Python

The architecture is identical — only the libraries change:

| Piece            | TypeScript (this repo)        | Python equivalent                               |
| ---------------- | ----------------------------- | ----------------------------------------------- |
| Agent loop / LLM | Vercel AI SDK `streamText`    | [`pydantic-ai`](https://ai.pydantic.dev) Agent, or raw `anthropic` / `openai` SDKs |
| Tool schemas     | Zod                           | `pydantic` models / typed function signatures   |
| Tool calling     | `tool({ inputSchema, execute })` | `@agent.tool` decorator (pydantic-ai) or function-calling JSON schema |
| Streaming        | `result.fullStream`           | `agent.run_stream(...)` / SDK streaming events  |
| Terminal UI      | `@clack/prompts` + `chalk`    | [`rich`](https://github.com/Textualize/rich) / [`textual`](https://github.com/Textualize/textual) |
| Shell            | `Bun.spawn`                   | `subprocess` / `asyncio.create_subprocess_exec` |
| Search           | ripgrep                       | ripgrep (same binary)                           |
| Persistence      | `bun:sqlite`                  | `sqlite3` (stdlib)                              |

The loop, the tool registry, the permission gate, and context compaction are
exactly the same concepts in either language.

## License

MIT
