import * as readline from "readline";
import * as config from "./config.ts";
import { defaultStats } from "./types.ts";
import type { Message, Stats } from "./types.ts";
import type { ProviderType, FinishReason } from "./provider.ts";

// ── 상수 ──
const MAX_CONTINUATIONS = 20;

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
const SHOW_CURSOR = `${CSI}?25h`;

const cols = () => process.stdout.columns || 80;

function drawStatusBar(stats: Stats) {
  const { status, realtimeTps, totalTokens, ttft, avgTps, thinkingTokens, continuations } = stats;

  const statusMap = {
    idle: { color: DIM, label: "Idle" },
    thinking: { color: MAGENTA, label: "Thinking..." },
    generating: { color: YELLOW, label: "Generating..." },
    continuing: { color: CYAN, label: "Continuing..." },
    done: { color: GREEN, label: "Done" },
  };
  const { color: statusColor, label: statusLabel } = statusMap[status];

  const parts = [
    `${GRAY}${config.provider.name}${RESET}`,
    `${CYAN}${BOLD}${config.MODEL}${RESET}`,
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
  if (continuations > 0) {
    parts.push(`Cont: ${YELLOW}${continuations}${RESET}`);
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
  for (const [cmd, desc] of Object.entries(config.COMMANDS)) {
    console.log(`  ${YELLOW}${BOLD}${cmd}${RESET} : ${desc}`);
  }
  console.log();
}

function printWelcome() {
  console.log(`${DIM}${config.provider.name} TUI Chat — ${config.MODEL}${RESET}`);
  console.log(`${DIM}/help 로 명령어 확인 | Ctrl+C 로 종료${RESET}\n`);
}

async function main() {
  await config.selectProvider();
  await config.selectModel();

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
        const cmds = Object.keys(config.COMMANDS);
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
      process.stdout.write(`${CSI}s\n${CLEAR_LINE}${CSI}u`);

      if (line.startsWith("/")) {
        const hits = Object.keys(config.COMMANDS).filter(
          (c) => c.startsWith(line) && c !== line,
        );
        if (hits.length > 0) {
          const hint = hits
            .map((c) => `${YELLOW}${c}${RESET} ${DIM}${config.COMMANDS[c]}${RESET}`)
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
    if (trimmed === "/provider") {
      try {
        const providers: { type: ProviderType; label: string }[] = [
          { type: "ollama", label: "Ollama" },
          { type: "vllm", label: "vLLM" },
        ];

        const lastProvider = config.loadLastProvider();

        console.log(`\n${CYAN}${BOLD}── Provider 선택 ──${RESET}\n`);
        console.log(`  ${DIM}현재: ${config.provider.name}${RESET}\n`);
        for (let i = 0; i < providers.length; i++) {
          const p = providers[i]!;
          const marker = p.type === lastProvider ? ` ${GREEN}← 마지막 사용${RESET}` : "";
          const savedHost = config.loadProviderHost(p.type);
          const hostInfo = savedHost ? ` ${GRAY}(${savedHost})${RESET}` : "";
          console.log(`  ${YELLOW}${BOLD}${i + 1}${RESET}) ${p.label}${hostInfo}${marker}`);
        }
        console.log();

        const lastIdx = lastProvider ? providers.findIndex((p) => p.type === lastProvider) : -1;
        const defaultHint = lastIdx >= 0 ? ` [Enter=${lastIdx + 1}]` : "";

        const answer = await new Promise<string>((resolve) => {
          isPrompting = true;
          rl.question(
            `${BLUE}${BOLD}Provider를 선택하세요 (1-${providers.length})${defaultHint}: ${RESET}`,
            (a) => {
              isPrompting = false;
              resolve(a);
            },
          );
        });

        let selectedIdx: number;
        if (answer.trim() === "" && lastIdx >= 0) {
          selectedIdx = lastIdx;
        } else {
          selectedIdx = parseInt(answer.trim(), 10) - 1;
          if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= providers.length) {
            console.log(`${YELLOW}잘못된 선택입니다.${RESET}`);
            continue;
          }
        }

        const selected = providers[selectedIdx]!;
        config.setProvider(selected.type);
        console.log(`${GREEN}${BOLD}✓ Provider 변경: ${selected.label}${RESET}\n`);

        console.log(`${DIM}새 Provider의 모델을 선택합니다...${RESET}`);
        try {
          const models = await config.listModels();
          const modelAnswer = await new Promise<string>((resolve) => {
            isPrompting = true;
            rl.question(
              `${BLUE}${BOLD}모델 번호를 선택하세요 (1-${models.length}): ${RESET}`,
              (a) => {
                isPrompting = false;
                resolve(a);
              },
            );
          });
          config.applyModelSelection(models, modelAnswer);
        } catch (err: any) {
          console.log(`${YELLOW}모델 목록을 가져올 수 없습니다: ${err.message}${RESET}\n`);
        }

        drawStatusBar(stats);
      } catch (err: any) {
        console.log(`\n${YELLOW}Provider 변경 실패: ${err.message}${RESET}\n`);
      }
      continue;
    }
    if (trimmed === "/model") {
      try {
        const models = await config.listModels();
        const lastModel = config.loadLastModel();
        const lastIdx = lastModel ? models.indexOf(lastModel) : -1;
        const defaultHint = lastIdx >= 0 ? ` [Enter=${lastIdx + 1}]` : "";

        const answer = await new Promise<string>((resolve) => {
          isPrompting = true;
          rl.question(
            `${BLUE}${BOLD}모델 번호를 선택하세요 (1-${models.length})${defaultHint}: ${RESET}`,
            (a) => {
              isPrompting = false;
              resolve(a);
            },
          );
        });

        if (answer.trim() === "" && lastIdx >= 0) {
          config.setModel(models[lastIdx]!);
          console.log(`${GREEN}${BOLD}✓ 선택된 모델: ${config.MODEL}${RESET}\n`);
        } else {
          config.applyModelSelection(models, answer);
        }

        drawStatusBar(stats);
      } catch (err: any) {
        console.log(`\n${YELLOW}모델 목록을 가져올 수 없습니다: ${err.message}${RESET}\n`);
      }
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
    let continuationCount = 0;

    stats = { ...defaultStats, status: "thinking" };
    drawStatusBar(stats);

    process.stdout.write(`${GRAY}${ITALIC}💭 Thinking...${RESET}\n`);

    let lastFinishReason: FinishReason = null;

    try {
      // 자동 연속 생성 루프: finish_reason이 "length"이면 자동으로 이어서 추론
      do {
        // 연속 생성 시 메시지 구성
        let chatMessages: Message[];
        if (continuationCount === 0) {
          chatMessages = messages.map((m) => ({ role: m.role, content: m.content }));
        } else {
          // 이전 생성 결과를 assistant 메시지로 추가하고 이어서 생성 요청
          chatMessages = [
            ...messages.slice(0, -0), // 원본 대화 (아직 push 안 한 상태이므로 user까지)
            { role: "assistant" as const, content: responseContent },
            { role: "user" as const, content: "Continue from exactly where you stopped. Do not repeat any previous text. Continue directly." },
          ];

          process.stdout.write(`${GRAY}${DIM} ↳ auto-continue (${continuationCount}/${MAX_CONTINUATIONS})${RESET}`);

          stats = { ...stats, status: "continuing", continuations: continuationCount };
          drawStatusBar(stats);
        }

        const stream = config.provider.chatStream(
          config.MODEL,
          chatMessages,
          { think: continuationCount === 0 },
        );

        lastFinishReason = null;

        for await (const chunk of stream) {
          const now = performance.now();

          if (chunk.thinking) {
            if (firstTokenTime === null) firstTokenTime = now;

            thinkingContent += chunk.thinking;
            thinkingTokenCount++;
            process.stdout.write(`${GRAY}${ITALIC}${chunk.thinking}${RESET}`);

            stats = {
              ...stats,
              status: "thinking",
              thinkingTokens: thinkingTokenCount,
            };
            drawStatusBar(stats);
            continue;
          }

          if (chunk.content) {
            if (isInThinking) {
              isInThinking = false;
              process.stdout.write(`${RESET}\n\n${GREEN}${BOLD}AI:${RESET}  `);
            }

            if (firstResponseTokenTime === null) {
              firstResponseTokenTime = now;
              if (firstTokenTime === null) firstTokenTime = now;
            }

            responseContent += chunk.content;
            tokenCount++;
            tokenTimestamps.push(now);
            process.stdout.write(chunk.content);

            const oneSecAgo = now - 1000;
            const recentCount = tokenTimestamps.filter((t) => t > oneSecAgo).length;

            const genTime = firstResponseTokenTime
              ? (now - firstResponseTokenTime) / 1000
              : 0;
            const avgTps = genTime > 0 ? tokenCount / genTime : 0;

            stats = {
              status: continuationCount > 0 ? "continuing" : "generating",
              realtimeTps: recentCount,
              totalTokens: tokenCount,
              ttft: firstResponseTokenTime
                ? firstResponseTokenTime - startTime
                : null,
              avgTps,
              thinkingTokens: thinkingTokenCount,
              continuations: continuationCount,
            };
            drawStatusBar(stats);
          }

          if (chunk.done && chunk.finish_reason) {
            lastFinishReason = chunk.finish_reason;
          }
        }

        // finish_reason이 "length"이면 자동 연속 생성
        if (lastFinishReason === "length") {
          continuationCount++;
        }
      } while (lastFinishReason === "length" && continuationCount <= MAX_CONTINUATIONS);

      if (continuationCount > MAX_CONTINUATIONS) {
        process.stdout.write(`\n${YELLOW}${DIM}(최대 연속 생성 횟수 ${MAX_CONTINUATIONS}회 도달)${RESET}`);
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
      continuations: continuationCount,
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
