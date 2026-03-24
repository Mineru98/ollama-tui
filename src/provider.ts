import type { Message } from "./types.ts";

// ── Provider 인터페이스 ──

export type FinishReason = "stop" | "length" | "error" | null;

export interface ChatChunk {
  thinking?: string;
  content?: string;
  done: boolean;
  finish_reason?: FinishReason;
}

export interface GenerateChunk {
  response: string;
  done: boolean;
  finish_reason?: FinishReason;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
}

export interface ChatOptions {
  think?: boolean;
  max_tokens?: number;
}

export interface Provider {
  readonly name: string;
  listModels(): Promise<string[]>;
  chatStream(
    model: string,
    messages: Message[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk>;
  generateStream(
    model: string,
    prompt: string,
    options?: { max_tokens?: number },
  ): AsyncIterable<GenerateChunk>;
}

// ── Ollama Provider ──

import { Ollama } from "ollama";

export class OllamaProvider implements Provider {
  readonly name = "Ollama";
  private client: Ollama;

  constructor(host: string = "http://localhost:11434") {
    this.client = new Ollama({ host });
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.list();
    return response.models.map((m) => m.name);
  }

  async *chatStream(
    model: string,
    messages: Message[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    const stream = await this.client.chat({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      think: options?.think ?? false,
      ...(options?.max_tokens ? { options: { num_predict: options.max_tokens } } : {}),
    });

    let finishReason: FinishReason = null;
    for await (const chunk of stream) {
      const thinking = (chunk as any).message?.thinking || "";
      const content = chunk.message?.content ?? "";
      const done = chunk.done ?? false;

      if (done) {
        const doneReason = (chunk as any).done_reason;
        finishReason = doneReason === "length" ? "length" : "stop";
      }

      yield {
        thinking: thinking || undefined,
        content: content || undefined,
        done,
        finish_reason: done ? finishReason : undefined,
      };
    }
  }

  async *generateStream(
    model: string,
    prompt: string,
    options?: { max_tokens?: number },
  ): AsyncIterable<GenerateChunk> {
    const stream = await this.client.generate({
      model,
      prompt,
      stream: true,
      ...(options?.max_tokens ? { options: { num_predict: options.max_tokens } } : {}),
    });

    for await (const chunk of stream) {
      const done = chunk.done ?? false;
      let finishReason: FinishReason = null;
      if (done) {
        const doneReason = (chunk as any).done_reason;
        finishReason = doneReason === "length" ? "length" : "stop";
      }

      yield {
        response: chunk.response,
        done,
        finish_reason: done ? finishReason : undefined,
        eval_count: chunk.eval_count,
        eval_duration: chunk.eval_duration,
        prompt_eval_count: chunk.prompt_eval_count,
        prompt_eval_duration: chunk.prompt_eval_duration,
      };
    }
  }
}

// ── vLLM Provider (OpenAI 호환 API) ──

export class VLLMProvider implements Provider {
  readonly name = "vLLM";
  private baseUrl: string;

  constructor(host: string = "http://localhost:8000") {
    this.baseUrl = host.replace(/\/$/, "");
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`);
    if (!res.ok) {
      throw new Error(`vLLM API error: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data: Array<{ id: string }> };
    return json.data.map((m) => m.id);
  }

  async *chatStream(
    model: string,
    messages: Message[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      ...(options?.max_tokens ? { max_tokens: options.max_tokens } : {}),
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`vLLM API error: ${res.status} ${text}`);
    }

    yield* this.parseChatSSE(res);
  }

  async *generateStream(
    model: string,
    prompt: string,
    options?: { max_tokens?: number },
  ): AsyncIterable<GenerateChunk> {
    const body = {
      model,
      prompt,
      stream: true,
      ...(options?.max_tokens ? { max_tokens: options.max_tokens } : {}),
    };

    const res = await fetch(`${this.baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`vLLM API error: ${res.status} ${text}`);
    }

    yield* this.parseCompletionSSE(res);
  }

  private async *parseChatSSE(res: Response): AsyncIterable<ChatChunk> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const finishReason = json.choices?.[0]?.finish_reason as string | null;

          if (delta?.content) {
            yield { content: delta.content, done: false };
          }

          // vLLM reasoning_content 지원 (GLM-4 등)
          if (delta?.reasoning_content) {
            yield { thinking: delta.reasoning_content, done: false };
          }

          if (finishReason) {
            yield {
              done: true,
              finish_reason: finishReason === "length" ? "length" : "stop",
            };
            return;
          }
        } catch {
          // JSON 파싱 실패 시 무시
        }
      }
    }
  }

  private async *parseCompletionSSE(res: Response): AsyncIterable<GenerateChunk> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          return;
        }

        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.text ?? "";
          const finishReason = json.choices?.[0]?.finish_reason as string | null;
          yield {
            response: text,
            done: !!finishReason,
            finish_reason: finishReason === "length" ? "length" : finishReason === "stop" ? "stop" : null,
          };
        } catch {
          // JSON 파싱 실패 시 무시
        }
      }
    }
  }
}

// ── Provider 타입 ──

export type ProviderType = "ollama" | "vllm";

export function createProvider(
  type: ProviderType,
  host?: string,
): Provider {
  switch (type) {
    case "ollama":
      return new OllamaProvider(host ?? "http://localhost:11434");
    case "vllm":
      return new VLLMProvider(host ?? "http://localhost:8000");
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}
