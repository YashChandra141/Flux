import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type ProviderName = "nvidia" | "anthropic" | "openai" | "google";

const PROVIDER_NAMES: ProviderName[] = ["nvidia", "anthropic", "openai", "google"];

/** NVIDIA NIM exposes an OpenAI-compatible API at this base URL. */
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Curated "best" NVIDIA NIM models for an agentic coding workflow. All of these
 * support OpenAI-style tool/function calling, which this agent requires. Set
 * FLUX_MODEL to any of these (or another NIM model id) to switch.
 */
export const NVIDIA_MODELS = {
  // Reliable, well-supported tool calling — the safe default.
  "llama-3.3-70b": "meta/llama-3.3-70b-instruct",
  // Kimi: 1T multimodal MoE, built for long-horizon coding + agentic tool use.
  kimi: "moonshotai/kimi-k2.6",
  // GLM (Z.ai): strong multilingual agentic coding, reasoning, and tool use.
  glm: "z-ai/glm4.7,z-ai/glm5.1",
  // Qwen3: large MoE with solid tool calling.
  qwen: "qwen/qwen3-235b-a22b",
  // Qwen coding specialist.
  "qwen2.5-coder": "qwen/qwen2.5-coder-32b-instruct",
  // MiniMax: 230B model strong at coding + reasoning.
  minimax: "minimaxai/minimax-m2.7,minimaxai/minimax-m3",
  // Gemma (Google): general instruct model. Note: tool-calling support is
  // weaker than the others; prefer the models above for heavy tool use.
  gemma: "google/gemma-3-27b-it,google/gemma-4-31b-it,diffusiongemma-26b-a4b-it ",
  // Strong general + coding model with tool calling.
  deepseek: "deepseek-ai/deepseek-v4-flash,deepseek-ai/deepseek-v4-pro",
  // Reasoning + tool calling, efficient.
  nemotron: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  // Built specifically for agentic workflows + function calling.
  "mistral-nemotron": "mistralai/mistral-nemotron",
} as const;

const DEFAULT_MODELS: Record<ProviderName, string> = {
  // Best default on NVIDIA NIM: dependable tool calling for the agent loop.
  nvidia: NVIDIA_MODELS["llama-3.3-70b"],
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1",
  // Free-tier friendly default. gemini-2.5-pro is NOT on the free tier.
  google: "gemini-2.5-flash",
};

const ENV_KEYS: Record<ProviderName, string> = {
  nvidia: "NVIDIA_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

export interface ResolvedModel {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
}

function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as string[]).includes(value);
}

function hasKey(provider: ProviderName): boolean {
  return Boolean(process.env[ENV_KEYS[provider]]);
}

/**
 * Decide which provider to use. An explicit FLUX_PROVIDER wins; otherwise
 * we pick the first provider that has an API key, in a stable priority order
 * (NVIDIA first so a NIM key is preferred when present).
 */
function pickProvider(): ProviderName {
  const forced = process.env.FLUX_PROVIDER?.toLowerCase();
  if (forced) {
    if (isProviderName(forced)) return forced;
    throw new Error(
      `Unknown FLUX_PROVIDER="${forced}". Use one of: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  const available = PROVIDER_NAMES.find(hasKey);
  if (!available) {
    throw new Error(
      "No API key found. Set one of " +
        PROVIDER_NAMES.map((p) => ENV_KEYS[p]).join(", ") +
        " (see .env.example).",
    );
  }
  return available;
}

function build(provider: ProviderName, modelId: string): LanguageModel {
  switch (provider) {
    case "nvidia":
      // NVIDIA NIM is OpenAI-compatible but only supports the Chat Completions
      // API (not the Responses API), so force `.chat(...)`.
      return createOpenAI({
        name: "nvidia",
        baseURL: NVIDIA_BASE_URL,
        apiKey: process.env.NVIDIA_API_KEY,
      }).chat(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
    case "google":
      return createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })(modelId);
  }
}

/** Build a model instance for a given provider + model id (used by /models). */
export function buildModel(provider: ProviderName, modelId: string): LanguageModel {
  return build(provider, modelId);
}

/**
 * List the individual models available for the active provider. For NVIDIA NIM
 * we query the OpenAI-compatible `/models` endpoint so every model in a series
 * (e.g. z-ai/glm4.7 and z-ai/glm5.1) shows up as its own selectable entry.
 * Falls back to the curated catalog if the request fails.
 */
export async function listAvailableModels(
  provider: ProviderName,
  currentId: string,
): Promise<string[]> {
  if (provider === "nvidia" && process.env.NVIDIA_API_KEY) {
    try {
      const res = await fetch(`${NVIDIA_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
        const ids = (json.data ?? [])
          .map((m) => m.id)
          .filter((x): x is string => typeof x === "string");
        if (ids.length) return Array.from(new Set(ids)).sort();
      }
    } catch {
      // fall through to the curated fallback below
    }
    return Object.values(NVIDIA_MODELS);
  }

  const fallback = new Set<string>([currentId, DEFAULT_MODELS[provider]]);
  return Array.from(fallback);
}

/**
 * Resolve an alias (e.g. "kimi") from the NVIDIA catalog to a full model id,
 * or pass through a value that already looks like a full id.
 */
export function resolveModelAlias(value: string): string {
  if (value in NVIDIA_MODELS) {
    return NVIDIA_MODELS[value as keyof typeof NVIDIA_MODELS];
  }
  return value;
}

/** Resolve the active language model from environment variables. */
export function resolveModel(): ResolvedModel {
  const provider = pickProvider();
  if (!hasKey(provider)) {
    throw new Error(
      `FLUX_PROVIDER=${provider} but ${ENV_KEYS[provider]} is not set.`,
    );
  }
  const modelId = process.env.FLUX_MODEL || DEFAULT_MODELS[provider];
  return { model: build(provider, modelId), provider, modelId };
}
