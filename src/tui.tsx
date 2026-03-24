import React from "react";
import { render, Box, Text } from "ink";
import * as readline from "readline";
import { PassThrough } from "stream";
import { ollama, MODEL, COMMANDS } from "./config.ts";
import { defaultStats } from "./types.ts";
import type { Message, DisplayMessage, Stats } from "./types.ts";

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

function ChatArea({ messages, height }: { messages: DisplayMessage[]; height: number }) {
  const lines: { role: string; text: string; isThinking?: boolean }[] = [];

  for (const msg of messages) {
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
  messages: DisplayMessage[];
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
  const messages: Message[] = [];
  const displayMsgs: DisplayMessage[] = [];
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
    process.stdout.write("\x1b[2J\x1b[H");
    app.clear();
  };

  process.on("SIGINT", () => {
    app.unmount();
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  });

  process.stdout.on("resize", () => update());

  displayMsgs.push({
    role: "system",
    content: `Ollama TUI Chat — ${MODEL}  |  /help 로 명령어 확인`,
  });
  update();

  while (true) {
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

    fullClear();

    if (!input) {
      update();
      continue;
    }

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

    messages.push({ role: "user", content: input });
    displayMsgs.push({ role: "user", content: input });
    update("생성 중...");

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

        if (isInThinking && respText) {
          isInThinking = false;
        }

        if (respText) {
          if (firstResponseTokenTime === null) {
            firstResponseTokenTime = now;
            if (firstTokenTime === null) firstTokenTime = now;
          }

          responseContent += respText;
          tokenCount++;
          tokenTimestamps.push(now);

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
