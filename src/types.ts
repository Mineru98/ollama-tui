export type Message = { role: "user" | "assistant"; content: string };

export type DisplayMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
};

export type Stats = {
  status: "idle" | "thinking" | "generating" | "done";
  realtimeTps: number;
  totalTokens: number;
  ttft: number | null;
  avgTps: number | null;
  thinkingTokens: number;
};

export const defaultStats: Stats = {
  status: "idle",
  realtimeTps: 0,
  totalTokens: 0,
  ttft: null,
  avgTps: null,
  thinkingTokens: 0,
};
