import React from "react";
import { render, Box, Text } from "ink";
import { Ollama } from "ollama";
import * as readline from "readline";
import { PassThrough } from "stream";

const ollama = new Ollama({ host: "http://localhost:11434" });
const MODEL = "qwen3.5:9b";

// ── Types ──
type Message = { role: "user" | "assistant"; content: string };
type DisplayMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
};

type Stats = {
  status: "idle" | "thinking" | "generating" | "done";
  realtimeTps: number;
  totalTokens: number;
  ttft: number | null;
  avgTps: number | null;
  thinkingTokens: number;
};

const defaultStats: Stats = {
  status: "idle",
  realtimeTps: 0,
  totalTokens: 0,
  ttft: null,
  avgTps: null,
  thinkingTokens: 0,
};

const COMMANDS: Record<string, string> = {
  "/help": "사용 가능한 명령어 목록을 표시합니다",
  "/clear": "대화 컨텍스트를 초기화합니다",
  "/quit": "앱을 종료합니다",
};

// ── Components ──
function StatusBar({ stats }: { stats: Stats }) {
  const statusMap: Record<string, { color: string; label: string }> = {
    idle: { color: "gray", label: "Idle" },
    thinking: { color: "magenta", label: "Thinking..." },
    generating: { color: "yellow", label: "Generating..." },
    done: { color: "green", label: "Done" },
  };
  const { color, label } = statusMap[stats.status];

  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color="cyan">{MODEL}</Text>
      <Text>TPS: <Text color="green" bold>{stats.realtimeTps.toFixed(1)}</Text></Text>
      <Text>Tokens: <Text bold>{stats.totalTokens}</Text></Text>
      {stats.thinkingTokens > 0 && (
        <Text>Think: <Text color="magenta">{stats.thinkingTokens}</Text></Text>
      )}
      {stats.ttft !== null && (
        <Text>TTFT: <Text color="magenta">{stats.ttft.toFixed(0)}ms</Text></Text>
      )}
      {stats.avgTps !== null && (
        <Text>Avg: <Text color="blue">{stats.avgTps.toFixed(1)} t/s</Text></Text>
      )}
      <Text color={color} bold>{label}</Text>
    </Box>
  );
}

function ChatArea({ messages, height }: { messages: DisplayMsg[]; height: number }) {
  const lines: { role: string; text: string; isThinking?: boolean }[] = [];

  for (const msg of messages) {
    // Thinking block
    if (msg.thinking) {
      const thinkLines = msg.thinking.split("\n");
      for (let i = 0; i < thinkLines.length; i++) {
        lines.push({
          role: i === 0 ? "thinking" : "",
          text: thinkLines[i],
          isThinking: true,
        });
      }
    }
    // Content
    const contentLines = msg.content.split("\n");
    for (let i = 0; i < contentLines.length; i++) {
      lines.push({
        role: i === 0 ? msg.role : "",
        text: contentLines[i],
        isThinking: false,
      });
    }
  }

  const visible = lines.slice(-height);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((line, i) => (
        <Box key={`msg-${lines.length - visible.length + i}`}>
          {line.role === "user" && <Text color="blue" bold>{"You: "}</Text>}
          {line.role === "assistant" && <Text color="green" bold>{"AI:  "}</Text>}
          {line.role === "thinking" && <Text color="magenta" dimColor>{"💭   "}</Text>}
          {line.role === "system" && <Text color="yellow" bold>{"SYS: "}</Text>}
          {line.role === "" && <Text>{"     "}</Text>}
          <Text
            wrap="wrap"
            dimColor={line.isThinking}
            italic={line.isThinking}
            color={line.isThinking ? "magenta" : undefined}
          >
            {line.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function Display({
  messages,
  stats,
  hint,
  termHeight,
}: {
  messages: DisplayMsg[];
  stats: Stats;
  hint: string;
  termHeight: number;
}) {
  const chatHeight = Math.max(termHeight - 6, 3);

  return (
    <Box flexDirection="column" height={termHeight}>
      <StatusBar stats={stats} />
      <ChatArea messages={messages} height={chatHeight} />
      <Box borderStyle="single" borderColor={stats.status === "idle" || stats.status === "done" ? "blue" : "gray"} paddingX={1}>
        <Text color="blue" bold>{"? "}</Text>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  );
}

// ── Main ──
async function main() {
  const messages: Message[] = []; // Sent to ollama
  const displayMsgs: DisplayMsg[] = []; // Displayed in UI
  let stats: Stats = { ...defaultStats };

  const fakeStdin = new PassThrough();
  const getHeight = () => process.stdout.rows || 24;

  const app = render(
    <Display
      messages={displayMsgs}
      stats={stats}
      hint="입력 대기 중..."
      termHeight={getHeight()}
    />,
    { stdin: fakeStdin, exitOnCtrlC: false },
  );

  const update = (hint = "입력 대기 중...") => {
    app.rerender(
      <Display
        messages={displayMsgs}
        stats={stats}
        hint={hint}
        termHeight={getHeight()}
      />,
    );
  };

  const fullClear = () => {
    process.stdout.write("\x1b[2J\x1b[H"); // Clear screen, cursor to 1,1
    app.clear();
  };

  // Ctrl+C
  process.on("SIGINT", () => {
    app.unmount();
    process.stdout.write("\x1b[?25h"); // Show cursor
    process.exit(0);
  });

  // Resize
  process.stdout.on("resize", () => update());

  // Welcome
  displayMsgs.push({
    role: "system",
    content: `Ollama TUI Chat — ${MODEL}  |  /help 로 명령어 확인`,
  });
  update();

  // ── Main loop ──
  while (true) {
    // ── Input phase: readline with Korean IME support ──
    const input = await new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      rl.question("\x1b[34m\x1b[1m? \x1b[0m", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    // Clear screen and re-render (clean slate after readline)
    fullClear();

    if (!input) {
      update();
      continue;
    }

    // ── Commands ──
    if (input === "/help") {
      const helpLines = Object.entries(COMMANDS)
        .map(([cmd, desc]) => `${cmd} : ${desc}`)
        .join("\n");
      displayMsgs.push({ role: "system", content: helpLines });
      update();
      continue;
    }

    if (input === "/clear") {
      messages.length = 0;
      displayMsgs.length = 0;
      stats = { ...defaultStats };
      displayMsgs.push({ role: "system", content: "대화가 초기화되었습니다." });
      update();
      continue;
    }

    if (input === "/quit") {
      app.unmount();
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }

    if (input.startsWith("/")) {
      displayMsgs.push({
        role: "system",
        content: `알 수 없는 명령어: ${input}  |  /help 로 확인`,
      });
      update();
      continue;
    }

    // ── User message ──
    messages.push({ role: "user", content: input });
    displayMsgs.push({ role: "user", content: input });
    update("생성 중...");

    // ── Generation phase ──
    const tokenTimestamps: number[] = [];
    let thinkingContent = "";
    let responseContent = "";
    let tokenCount = 0;
    let thinkingTokenCount = 0;
    let isInThinking = true;
    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let firstResponseTokenTime: number | null = null;
    let aborted = false;

    // Enable raw mode for Esc detection
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    const escHandler = (data: Buffer) => {
      if (data[0] === 0x1b && data.length === 1) aborted = true;
      if (data[0] === 0x03) {
        app.unmount();
        process.stdout.write("\x1b[?25h");
        process.exit(0);
      }
    };
    process.stdin.on("data", escHandler);

    stats = { ...defaultStats, status: "thinking" };

    // Add assistant message placeholder
    const assistantIdx = displayMsgs.length;
    displayMsgs.push({ role: "assistant", content: "", thinking: "" });
    update("생성 중... (Esc로 중단)");

    try {
      const chatMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const stream = await ollama.chat({
        model: MODEL,
        messages: chatMessages,
        stream: true,
        think: true,
      });

      for await (const chunk of stream) {
        if (aborted) break;

        const now = performance.now();
        const thinkText: string = (chunk as any).message?.thinking ?? "";
        const respText: string = chunk.message?.content ?? "";

        // ── Thinking phase ──
        if (thinkText) {
          if (firstTokenTime === null) firstTokenTime = now;
          thinkingContent += thinkText;
          thinkingTokenCount++;

          displayMsgs[assistantIdx] = {
            role: "assistant",
            content: responseContent,
            thinking: thinkingContent,
          };
          stats = { ...stats, status: "thinking", thinkingTokens: thinkingTokenCount };

          fullClear();
          update("생성 중... (Esc로 중단)");
          continue;
        }

        // ── Transition ──
        if (isInThinking && respText) {
          isInThinking = false;
        }

        // ── Response phase ──
        if (respText) {
          if (firstResponseTokenTime === null) {
            firstResponseTokenTime = now;
            if (firstTokenTime === null) firstTokenTime = now;
          }

          responseContent += respText;
          tokenCount++;
          tokenTimestamps.push(now);

          // Sliding window TPS
          const oneSecAgo = now - 1000;
          const recentCount = tokenTimestamps.filter((t) => t > oneSecAgo).length;
          const genTime = (now - firstResponseTokenTime) / 1000;

          displayMsgs[assistantIdx] = {
            role: "assistant",
            content: responseContent,
            thinking: thinkingContent,
          };
          stats = {
            status: "generating",
            realtimeTps: recentCount,
            totalTokens: tokenCount,
            ttft: firstResponseTokenTime - startTime,
            avgTps: genTime > 0 ? tokenCount / genTime : 0,
            thinkingTokens: thinkingTokenCount,
          };

          fullClear();
          update("생성 중... (Esc로 중단)");
        }
      }
    } catch (err: any) {
      if (!aborted) {
        responseContent += `\n[Error: ${err.message}]`;
      }
    }

    // ── Cleanup ──
    process.stdin.off("data", escHandler);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);

    const endTime = performance.now();
    const totalGenTime = firstResponseTokenTime
      ? (endTime - firstResponseTokenTime) / 1000
      : 0;

    displayMsgs[assistantIdx] = {
      role: "assistant",
      content: responseContent,
      thinking: thinkingContent,
    };
    messages.push({ role: "assistant", content: responseContent });

    stats = {
      status: "done",
      realtimeTps: 0,
      totalTokens: tokenCount,
      ttft: firstResponseTokenTime ? firstResponseTokenTime - startTime : null,
      avgTps: totalGenTime > 0 ? tokenCount / totalGenTime : null,
      thinkingTokens: thinkingTokenCount,
    };

    tokenTimestamps.length = 0;

    fullClear();
    update();
  }
}

main().catch((err) => {
  process.stdout.write("\x1b[?25h");
  console.error(err);
  process.exit(1);
});
