import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createProvider, type Provider, type ProviderType } from "./provider.ts";

export let MODEL = "qwen3.5:9b";
export let provider: Provider = createProvider("ollama");

// ── 설정 파일 경로 ──
const CONFIG_DIR = path.join(os.homedir(), ".ollama-tui");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface ConfigData {
  lastModel?: string;
  lastProvider?: ProviderType;
  providerHost?: Record<string, string>;
}

function loadConfig(): ConfigData {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(data: ConfigData): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const existing = loadConfig();
    const merged = { ...existing, ...data };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
  } catch {
    // 저장 실패 시 무시
  }
}

export function loadLastModel(): string | null {
  return loadConfig().lastModel ?? null;
}

export function saveLastModel(model: string): void {
  saveConfig({ lastModel: model });
}

export function loadLastProvider(): ProviderType | null {
  return loadConfig().lastProvider ?? null;
}

export function saveProviderConfig(type: ProviderType, host?: string): void {
  const data: ConfigData = { lastProvider: type };
  if (host) {
    const existing = loadConfig();
    data.providerHost = { ...existing.providerHost, [type]: host };
  }
  saveConfig(data);
}

export function loadProviderHost(type: ProviderType): string | undefined {
  return loadConfig().providerHost?.[type];
}

export function setModel(name: string): void {
  MODEL = name;
  saveLastModel(name);
}

export function setProvider(type: ProviderType, host?: string): void {
  const resolvedHost = host ?? loadProviderHost(type);
  provider = createProvider(type, resolvedHost);
  saveProviderConfig(type, resolvedHost);
}

/** Provider 선택 */
export async function selectProvider(): Promise<void> {
  const providers: { type: ProviderType; label: string; defaultHost: string }[] = [
    { type: "ollama", label: "Ollama", defaultHost: "http://localhost:11434" },
    { type: "vllm", label: "vLLM", defaultHost: "http://localhost:8000" },
  ];

  const lastProvider = loadLastProvider();
  const lastIdx = lastProvider ? providers.findIndex((p) => p.type === lastProvider) : -1;

  console.log("\n\x1b[36m\x1b[1m── Provider 선택 ──\x1b[0m\n");
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const marker = p.type === lastProvider ? " \x1b[32m← 마지막 사용\x1b[0m" : "";
    const savedHost = loadProviderHost(p.type);
    const hostInfo = savedHost ? ` \x1b[90m(${savedHost})\x1b[0m` : ` \x1b[90m(${p.defaultHost})\x1b[0m`;
    console.log(`  \x1b[33m\x1b[1m${i + 1}\x1b[0m) ${p.label}${hostInfo}${marker}`);
  }
  console.log();

  const defaultHint = lastIdx >= 0 ? ` [Enter=${lastIdx + 1}]` : "";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `\x1b[34m\x1b[1mProvider를 선택하세요 (1-${providers.length})${defaultHint}: \x1b[0m`,
      resolve,
    );
  });
  rl.close();

  let selectedIdx: number;
  if (answer.trim() === "" && lastIdx >= 0) {
    selectedIdx = lastIdx;
  } else {
    selectedIdx = parseInt(answer.trim(), 10) - 1;
    if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= providers.length) {
      console.log("\x1b[33m잘못된 선택입니다. Ollama를 사용합니다.\x1b[0m");
      selectedIdx = 0;
    }
  }

  const selected = providers[selectedIdx]!;
  setProvider(selected.type);
  console.log(`\x1b[32m\x1b[1m✓ 선택된 Provider: ${selected.label}\x1b[0m\n`);
}

/** 사용 가능한 모델 목록을 가져와 번호 리스트로 출력합니다 */
export async function listModels(): Promise<string[]> {
  const models = await provider.listModels();

  if (models.length === 0) {
    console.error(`${provider.name}에 사용 가능한 모델이 없습니다.`);
    process.exit(1);
  }

  console.log("\n\x1b[36m\x1b[1m── 모델 선택 ──\x1b[0m\n");
  const lastModel = loadLastModel();
  for (let i = 0; i < models.length; i++) {
    const marker = models[i] === lastModel ? " \x1b[32m← 마지막 사용\x1b[0m" : "";
    console.log(`  \x1b[33m\x1b[1m${i + 1}\x1b[0m) ${models[i]}${marker}`);
  }
  console.log();

  return models;
}

/** 모델 번호 입력을 파싱하여 모델을 설정합니다 */
export function applyModelSelection(models: string[], answer: string): string {
  const idx = parseInt(answer.trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) {
    console.log("\x1b[33m잘못된 선택입니다. 첫 번째 모델을 사용합니다.\x1b[0m");
    setModel(models[0]!);
  } else {
    setModel(models[idx]!);
  }
  console.log(`\x1b[32m\x1b[1m✓ 선택된 모델: ${MODEL}\x1b[0m\n`);
  return MODEL;
}

export async function selectModel(): Promise<string> {
  const models = await listModels();

  const lastModel = loadLastModel();
  const lastIdx = lastModel ? models.indexOf(lastModel) : -1;
  const defaultHint = lastIdx >= 0 ? ` [Enter=${lastIdx + 1}]` : "";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `\x1b[34m\x1b[1m모델 번호를 선택하세요 (1-${models.length})${defaultHint}: \x1b[0m`,
      resolve,
    );
  });
  rl.close();

  if (answer.trim() === "" && lastIdx >= 0) {
    setModel(models[lastIdx]!);
    console.log(`\x1b[32m\x1b[1m✓ 선택된 모델: ${MODEL}\x1b[0m\n`);
    return MODEL;
  }

  return applyModelSelection(models, answer);
}

export const COMMANDS: Record<string, string> = {
  "/help": "사용 가능한 명령어 목록을 표시합니다",
  "/model": "다른 모델을 선택합니다",
  "/provider": "다른 Provider를 선택합니다 (Ollama/vLLM)",
  "/clear": "대화 컨텍스트를 초기화합니다",
  "/quit": "앱을 종료합니다",
};
