import TurndownService from "turndown";
import { writeFileSync } from "fs";

const TARGET_URL = "https://react.dev";

async function scrape(url: string) {
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  console.log(`Fetched ${html.length} chars of HTML`);

  // <title> 추출
  const title = html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] ?? "Untitled";
  console.log(`Page title: ${title}`);

  // <main> 영역 추출 (없으면 <body>)
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let content = mainMatch?.[1] ?? bodyMatch?.[1] ?? html;

  // 노이즈 태그 제거
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // HTML -> Markdown 변환
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // 코드 블록 처리 개선
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

  const markdown = `# ${title}\n\nSource: ${url}\n\n${turndown.turndown(content)}`;

  const outputPath = "output.md";
  writeFileSync(outputPath, markdown, "utf-8");
  console.log(`\nSaved to ${outputPath} (${markdown.length} chars)`);
  console.log("\n--- Preview (first 1000 chars) ---\n");
  console.log(markdown.slice(0, 1000));
}

scrape(TARGET_URL).catch(console.error);
