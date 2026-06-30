export type ToolStatus = "running" | "done" | "error";

export interface ToolItem {
  type: "tool";
  key: number;
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: ToolStatus;
  output?: Record<string, unknown>;
  error?: string;
}

export interface TextItem {
  type: "user" | "assistant" | "info" | "error";
  key: number;
  text: string;
}

export type Item = TextItem | ToolItem;

let counter = 0;
export function nextKey(): number {
  return ++counter;
}
