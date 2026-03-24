import * as readline from "readline";
import { ollama, COMMANDS, selectModel } from "./config.ts";
import { MODEL } from "./config.ts";
import { defaultStats } from "./types.ts";
import type { Message, Stats } from "./types.ts";

// ── ANSI escape helpers ──
const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
const ITALIC = `${CSI}3m`;
const CYAN = `${CSI}36m`;
const GREEN = `${CSI}32m`;
const BLUE = `${CSI}34m`;
const MAGENTA = `${CSI}35m`;
const YELLOW = `${CSI}33m`;
const WHITE = `${CSI}37m`;
const GRAY = `${CSI}90m`;
const CLEAR_LINE = `${CSI}2K`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;

const cols = () => process.stdout.columns || 80;

function drawStatusBar(stats: Stats) {
  const { status, realtimeTps, totalTokens, ttft, avgTps, thinkingTokens } = stats;

  const statusMap = {
    idle: { color: DIM, label: "Idle" },
    thinking: { color: MAGENTA, label: "Thinking..." },
    generating: { color: YELLOW, label: "Generating..." },
    done: { color: GREEN, label: "Done" },
  };
  const { color: statusColor, label: statusLabel } = statusMap[status];

  const parts = [
    `${CYAN}${BOLD}${MODEL}${RESET}`,
    `TPS: ${GREEN}${BOLD}${realtimeTps.toFixed(1)}${RESET}`,
    `Tokens: ${WHITE}${BOLD}${totalTokens}${RESET}`,
  ];

  if (thinkingTokens > 0) {
    parts.push(`Think: ${MAGENTA}${thinkingTokens}${RESET}`);
  }
  if (ttft !== null) {
    parts.push(`TTFT: ${MAGENTA}${ttft.toFixed(0)}ms${RESET}`);
  }
  if (avgTps !== null) {
    parts.push(`Avg: ${BLUE}${avgTps.toFixed(1)} t/s${RESET}`);
  }
  parts.push(`${statusColor}${BOLD}${statusLabel}${RESET}`);

  const line = parts.join("  │  ");
  const w = cols();
  const border = "─".repeat(Math.max(w - 2, 0));

  process.stdout.write(
    `${CSI}s${CSI}1;1H${CLEAR_LINE}┌${border}┐\n${CLEAR_LINE}│ ${line}${CSI}${w}G│\n${CLEAR_LINE}└${border}┘${CSI}u`,
  );
}

function setScrollRegion() {
  const rows = process.stdout.rows || 24;
  process.stdout.write(`${CSI}4;${rows}r`);
  process.stdout.write(`${CSI}4;1H`);
}

function resetTerminal() {
  const rows = process.stdout.rows || 24;
  process.stdout.write(`${CSI}1;${rows}r`);
  process.stdout.write(SHOW_CURSOR);
}

function printHelp() {
  console.log(`\n${CYAN}${BOLD}── Commands ──${RESET}`);
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${YELLOW}${BOLD}${cmd}${RESET} : ${desc}`);
  }
  console.log();
}

function printWelcome() {
  console.log(`${DIM}Ollama TUI Chat — ${MODEL}${RESET}`);
  console.log(`${DIM}/help 로 명령어 확인 | Ctrl+C 로 종료${RESET}\n`);
}

async function main() {
  await selectModel();

  const messages: Message[] = [];
  let stats: Stats = { ...defaultStats };

  process.stdout.write(`${CSI}2J${CSI}1;1H`);
  drawStatusBar(stats);
  setScrollRegion();
  printWelcome();

  let isPrompting = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line: string): [string[], string] => {
      if (line.startsWith("/")) {
        const cmds = Object.keys(COMMANDS);
        const hits = cmds.filter((c) => c.startsWith(line));
        return [hits.length ? hits : cmds, line];
      }
      return [[], line];
    },
  });

  process.stdin.on("keypress", () => {
    if (!isPrompting) return;
    setImmediate(() => {
      const line = (rl as any).line ?? "";
      // Clear previous suggestion line
      process.stdout.write(`${CSI}s\n${CLEAR_LINE}${CSI}u`);

      if (line.startsWith("/")) {
        const hits = Object.keys(COMMANDS).filter(
          (c) => c.startsWith(line) && c !== line,
        );
        if (hits.length > 0) {
          const hint = hits
            .map((c) => `${YELLOW}${c}${RESET} ${DIM}${COMMANDS[c]}${RESET}`)
            .join("   ");
          process.stdout.write(`${CSI}s\n${CLEAR_LINE}  ${hint}${CSI}u`);
        }
      }
    });
  });

  const prompt = (): Promise<string> =>
    new Promise((resolve) => {
      isPrompting = true;
      rl.question(`${BLUE}${BOLD}? ${RESET}`, (answer) => {
        isPrompting = false;
        process.stdout.write(`\r${CLEAR_LINE}`);
        resolve(answer);
      });
    });

  rl.on("close", () => {
    resetTerminal();
    console.log("\nBye!");
    process.exit(0);
  });

  process.stdout.on("resize", () => {
    drawStatusBar(stats);
    setScrollRegion();
  });

  while (true) {
    const input = await prompt();
    const trimmed = input.trim();
    if (!trimmed) continue;

    if (trimmed === "/help") {
      printHelp();
      continue;
    }
    if (trimmed === "/clear") {
      messages.length = 0;
      stats = { ...defaultStats };
      process.stdout.write(`${CSI}2J${CSI}1;1H`);
      drawStatusBar(stats);
      setScrollRegion();
      console.log(`${GREEN}${BOLD}✓ 대화가 초기화되었습니다.${RESET}\n`);
      continue;
    }
    if (trimmed === "/quit") {
      resetTerminal();
      console.log("\nBye!");
      process.exit(0);
    }
    if (trimmed.startsWith("/")) {
      console.log(`${YELLOW}알 수 없는 명령어: ${trimmed}${RESET}`);
      console.log(`${DIM}/help 로 사용 가능한 명령어를 확인하세요.${RESET}\n`);
      continue;
    }

    messages.push({ role: "user", content: trimmed });
    console.log(`\n${BLUE}${BOLD}You:${RESET} ${trimmed}\n`);

    const tokenTimestamps: number[] = [];
    let thinkingContent = "";
    let responseContent = "";
    let tokenCount = 0;
    let thinkingTokenCount = 0;
    let isInThinking = true;
    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let firstResponseTokenTime: number | null = null;

    stats = { ...defaultStats, status: "thinking" };
    drawStatusBar(stats);

    process.stdout.write(`${GRAY}${ITALIC}💭 Thinking...${RESET}\n`);

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
        const now = performance.now();
        const hasThinking = !!(chunk as any).message?.thinking;
        const thinkText = hasThinking ? (chunk as any).message.thinking : "";
        const respText = chunk.message?.content ?? "";

        if (thinkText) {
          if (firstTokenTime === null) firstTokenTime = now;

          thinkingContent += thinkText;
          thinkingTokenCount++;
          process.stdout.write(`${GRAY}${ITALIC}${thinkText}${RESET}`);

          stats = {
            ...stats,
            status: "thinking",
            thinkingTokens: thinkingTokenCount,
          };
          drawStatusBar(stats);
          continue;
        }

        if (isInThinking && respText) {
          isInThinking = false;
          process.stdout.write(`${RESET}\n\n${GREEN}${BOLD}AI:${RESET}  `);
        }

        if (respText) {
          if (firstResponseTokenTime === null) {
            firstResponseTokenTime = now;
            if (firstTokenTime === null) firstTokenTime = now;
          }

          responseContent += respText;
          tokenCount++;
          tokenTimestamps.push(now);
          process.stdout.write(respText);

          const oneSecAgo = now - 1000;
          const recentCount = tokenTimestamps.filter((t) => t > oneSecAgo).length;

          const genTime = firstResponseTokenTime
            ? (now - firstResponseTokenTime) / 1000
            : 0;
          const avgTps = genTime > 0 ? tokenCount / genTime : 0;

          stats = {
            status: "generating",
            realtimeTps: recentCount,
            totalTokens: tokenCount,
            ttft: firstResponseTokenTime
              ? firstResponseTokenTime - startTime
              : null,
            avgTps,
            thinkingTokens: thinkingTokenCount,
          };
          drawStatusBar(stats);
        }
      }
    } catch (err: any) {
      console.log(`\n${CSI}31m[Error: ${err.message}]${RESET}`);
    }

    const endTime = performance.now();
    const totalGenTime = firstResponseTokenTime
      ? (endTime - firstResponseTokenTime) / 1000
      : 0;

    stats = {
      status: "done",
      realtimeTps: 0,
      totalTokens: tokenCount,
      ttft: firstResponseTokenTime
        ? firstResponseTokenTime - startTime
        : null,
      avgTps: totalGenTime > 0 ? tokenCount / totalGenTime : null,
      thinkingTokens: thinkingTokenCount,
    };
    drawStatusBar(stats);

    if (isInThinking) {
      process.stdout.write(`${RESET}\n`);
    }

    messages.push({ role: "assistant", content: responseContent });
    tokenTimestamps.length = 0;

    console.log("\n");
  }
}

main().catch((err) => {
  resetTerminal();
  console.error(err);
  process.exit(1);
});
