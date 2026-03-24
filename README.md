# ollama-tui

Bun + TypeScript 환경에서 Ollama LLM과 대화하는 TUI(Terminal User Interface) 프로젝트.

## 환경 요구사항

- [Bun](https://bun.sh) 런타임
- [Ollama](https://ollama.com) 로컬 실행 (`http://localhost:11434`)
- 모델 사전 설치: `ollama pull qwen3.5:9b`

## 설치

```bash
bun install
```

## 실행

```bash
# 단순 생성 (스트리밍 + TPS 측정)
bun run generate

# TUI 채팅 (ANSI 기반)
bun run tui

# TUI 채팅 (React/Ink 기반)
bun run tui:ink

# 웹 스크래핑 (HTML → Markdown)
bun run scrape
```

## 프로젝트 구조

```
src/
  config.ts      # 공유 설정 (Ollama host, model, commands)
  types.ts       # 공유 타입 (Message, Stats)
  generate.ts    # Ollama 스트리밍 생성 + TPS 측정
  tui.ts         # ANSI escape 기반 TUI 채팅
  tui.tsx        # React/Ink 기반 TUI 채팅
  scrape.ts      # 웹페이지 → Markdown 변환
```
