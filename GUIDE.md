# Ollama + Web Scraping 프로젝트 가이드

Bun + TypeScript 환경에서 Ollama LLM을 제어하고, 웹페이지를 마크다운으로 변환하는 프로젝트.

## 환경 요구사항

- **Runtime**: [Bun](https://bun.sh) (Node/npm 대신 사용)
- **Ollama**: 로컬에 설치 및 실행 중 (`http://localhost:11434`)
- **모델**: `ollama pull qwen3.5:9b` 등 원하는 모델 사전 설치

## 프로젝트 초기화

```bash
# 프로젝트 생성
bun init -y

# 패키지 설치
bun add ollama turndown @types/turndown
```

## 1. Ollama 스트리밍 생성 + TPS 측정 (`index.ts`)

Ollama의 `generate` API를 스트리밍 모드로 호출하고, 토큰 생성 속도를 측정한다.

### 핵심 구조

```typescript
import { Ollama } from "ollama";

const ollama = new Ollama({ host: "http://localhost:11434" });
```

### 측정 항목

| 항목 | 설명 | 계산 방법 |
|------|------|-----------|
| **TTFT** | Time to First Token. 요청 후 첫 토큰 수신까지 걸린 시간 | `firstTokenTime - startTime` |
| **스트림 TPS** | 클라이언트 관점 초당 토큰 수 (네트워크 오버헤드 포함) | `tokenCount / generationTime` |
| **Ollama TPS** | Ollama 내부 보고 순수 추론 속도 | `eval_count / (eval_duration / 1e9)` |

### 스트리밍 처리 패턴

```typescript
const stream = await ollama.generate({
  model: MODEL,
  prompt: PROMPT,
  stream: true, // 스트리밍 활성화
});

for await (const chunk of stream) {
  // chunk.response: 토큰 텍스트
  // chunk.done: 마지막 청크 여부
  // chunk.eval_count: 생성된 총 토큰 수 (마지막 청크에만 존재)
  // chunk.eval_duration: 생성 소요 시간 (나노초, 마지막 청크에만 존재)
  // chunk.prompt_eval_count: 프롬프트 토큰 수
  // chunk.prompt_eval_duration: 프롬프트 처리 시간 (나노초)
}
```

### TPS 계산 포인트

- `performance.now()`로 시작/첫 토큰/종료 시점을 기록
- 스트림 청크 수를 카운트하여 클라이언트 기준 TPS 산출
- 마지막 청크(`chunk.done === true`)에 Ollama 자체 메트릭이 포함됨
- `eval_duration`은 **나노초** 단위이므로 `1e9`로 나눠 초 단위로 변환

### 실행

```bash
bun run index.ts
```

### 출력 예시

```
Model: qwen3.5:9b
Prompt: TypeScript의 장점을 5가지 알려줘.
---
[TTFT: 5150ms]

(생성된 텍스트...)

--- Stats ---
Total tokens: 1301
Total time: 40.94s
Generation time: 35.79s
Tokens/sec: 36.35
TTFT (Time to First Token): 5150ms

--- Ollama Internal Stats ---
Eval tokens: 1367
Eval duration: 35.04s
Ollama TPS: 39.01
Prompt eval: 21 tokens in 0.08s
```

## 2. 웹페이지 → Markdown 변환 (`scrape.ts`)

`fetch`로 HTML을 가져오고 `turndown`으로 마크다운 변환한다.

### 핵심 흐름

1. **fetch로 HTML 가져오기** - User-Agent 헤더를 설정하여 브라우저처럼 요청
2. **콘텐츠 영역 추출** - `<main>` 우선, 없으면 `<body>`
3. **노이즈 제거** - script, style, nav, footer, header, iframe, noscript 태그 제거
4. **Turndown으로 변환** - HTML → Markdown

### Turndown 설정

```typescript
const turndown = new TurndownService({
  headingStyle: "atx",        // # 스타일 헤딩
  codeBlockStyle: "fenced",   // ``` 코드 블록
  bulletListMarker: "-",      // - 리스트
});
```

### 커스텀 룰: 코드 블록 처리

`<pre><code>` 구조를 언어 감지 포함 fenced code block으로 변환:

```typescript
turndown.addRule("codeBlock", {
  filter: (node) =>
    node.nodeName === "PRE" && !!node.querySelector("code"),
  replacement: (_content, node) => {
    const code = (node as HTMLElement).querySelector("code");
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || "";
    const text = code?.textContent || "";
    return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
  },
});
```

### 노이즈 제거 패턴

정규식으로 불필요한 HTML 태그를 통째로 제거:

```typescript
content = content
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<nav[\s\S]*?<\/nav>/gi, "")
  // ...
```

### 실행

```bash
bun run scrape.ts
# output.md 파일로 저장됨
```

## 참고: Playwright 사용 시

SPA(클라이언트 렌더링만 하는 앱)는 fetch로 의미 있는 HTML을 얻을 수 없으므로 Playwright가 필요하다.
단, Windows 환경에서 headless 브라우저 실행 타임아웃이 발생할 수 있다.

```bash
bun add playwright
bunx playwright install chromium
```

```typescript
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle" });
const html = await page.evaluate(() => document.querySelector("main")?.innerHTML ?? "");
await browser.close();
```

SSR 기반 사이트(Next.js, Nuxt 등)는 fetch만으로 충분하다.

## 패키지 요약

| 패키지 | 용도 |
|--------|------|
| `ollama` | Ollama API 클라이언트 |
| `turndown` | HTML → Markdown 변환 |
| `@types/turndown` | Turndown 타입 정의 |
| `playwright` | 브라우저 자동화 (SPA 스크래핑 시 필요) |
