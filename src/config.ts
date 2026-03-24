import { Ollama } from "ollama";

export const OLLAMA_HOST = "http://localhost:11434";
export const MODEL = "qwen3.5:9b";

export const ollama = new Ollama({ host: OLLAMA_HOST });

export const COMMANDS: Record<string, string> = {
  "/help": "사용 가능한 명령어 목록을 표시합니다",
  "/clear": "대화 컨텍스트를 초기화합니다",
  "/quit": "앱을 종료합니다",
};
