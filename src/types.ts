export type Message = { role: "user" | "assistant"; content: string };

export type Stats = {
  status: "idle" | "thinking" | "generating" | "continuing" | "done";
  realtimeTps: number;
  totalTokens: number;
  ttft: number | null;
  avgTps: number | null;
  thinkingTokens: number;
  continuations: number;
};

export const defaultStats: Stats = {
  status: "idle",
  realtimeTps: 0,
  totalTokens: 0,
  ttft: null,
  avgTps: null,
  thinkingTokens: 0,
  continuations: 0,
};
