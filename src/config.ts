import { Ollama } from "ollama";
import * as readline from "readline";

export const OLLAMA_HOST = "http://localhost:11434";
export let MODEL = "qwen3.5:9b";

export const ollama = new Ollama({ host: OLLAMA_HOST });

export async function selectModel(): Promise<string> {
  const response = await ollama.list();
  const models = response.models.map((m) => m.name);

  if (models.length === 0) {
    console.error("Ollama에 설치된 모델이 없습니다. 'ollama pull <model>' 로 모델을 설치하세요.");
    process.exit(1);
  }

  console.log("\n\x1b[36m\x1b[1m── 모델 선택 ──\x1b[0m\n");
  for (let i = 0; i < models.length; i++) {
    console.log(`  \x1b[33m\x1b[1m${i + 1}\x1b[0m) ${models[i]}`);
  }
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(`\x1b[34m\x1b[1m모델 번호를 선택하세요 (1-${models.length}): \x1b[0m`, resolve);
  });
  rl.close();

  const idx = parseInt(answer.trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) {
    console.log("\x1b[33m잘못된 선택입니다. 첫 번째 모델을 사용합니다.\x1b[0m");
    MODEL = models[0];
  } else {
    MODEL = models[idx];
  }

  console.log(`\x1b[32m\x1b[1m✓ 선택된 모델: ${MODEL}\x1b[0m\n`);
  return MODEL;
}

export const COMMANDS: Record<string, string> = {
  "/help": "사용 가능한 명령어 목록을 표시합니다",
  "/clear": "대화 컨텍스트를 초기화합니다",
  "/quit": "앱을 종료합니다",
};
