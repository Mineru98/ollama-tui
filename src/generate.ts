import * as config from "./config.ts";
import type { FinishReason } from "./provider.ts";

const MAX_CONTINUATIONS = 20;
const PROMPT = "TypeScript의 장점을 5가지 알려줘.";

async function generate() {
  await config.selectProvider();
  await config.selectModel();
  console.log(`Provider: ${config.provider.name}`);
  console.log(`Model: ${config.MODEL}`);
  console.log(`Prompt: ${PROMPT}`);
  console.log("---");

  const startTime = performance.now();
  let tokenCount = 0;
  let firstTokenTime: number | null = null;
  let fullResponse = "";
  let continuationCount = 0;
  let lastFinishReason: FinishReason = null;

  do {
    const currentPrompt = continuationCount === 0
      ? PROMPT
      : fullResponse + "\n[Continue]";

    if (continuationCount > 0) {
      console.log(`\n--- auto-continue (${continuationCount}/${MAX_CONTINUATIONS}) ---`);
    }

    const stream = config.provider.generateStream(config.MODEL, currentPrompt);
    lastFinishReason = null;

    for await (const chunk of stream) {
      if (!firstTokenTime) {
        firstTokenTime = performance.now();
        const ttft = firstTokenTime - startTime;
        console.log(`\n[TTFT: ${ttft.toFixed(0)}ms]\n`);
      }

      process.stdout.write(chunk.response);
      fullResponse += chunk.response;
      tokenCount++;

      if (chunk.done) {
        lastFinishReason = chunk.finish_reason ?? "stop";

        if (lastFinishReason !== "length") {
          const totalTime = performance.now() - startTime;
          const generationTime = performance.now() - firstTokenTime!;

          console.log("\n\n--- Stats ---");
          console.log(`Total tokens: ${tokenCount}`);
          console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
          console.log(`Generation time: ${(generationTime / 1000).toFixed(2)}s`);
          console.log(`Tokens/sec: ${(tokenCount / (generationTime / 1000)).toFixed(2)}`);
          console.log(`TTFT: ${(firstTokenTime! - startTime).toFixed(0)}ms`);
          if (continuationCount > 0) {
            console.log(`Auto-continuations: ${continuationCount}`);
          }

          if (chunk.eval_count && chunk.eval_duration) {
            const tps = chunk.eval_count / (chunk.eval_duration / 1e9);
            console.log(`\n--- ${config.provider.name} Internal Stats ---`);
            console.log(`Eval tokens: ${chunk.eval_count}`);
            console.log(`Eval duration: ${(chunk.eval_duration / 1e9).toFixed(2)}s`);
            console.log(`TPS: ${tps.toFixed(2)}`);
            if (chunk.prompt_eval_count) {
              console.log(`Prompt eval: ${chunk.prompt_eval_count} tokens in ${((chunk.prompt_eval_duration ?? 0) / 1e9).toFixed(2)}s`);
            }
          }
        }
      }
    }

    if (lastFinishReason === "length") {
      continuationCount++;
    }
  } while (lastFinishReason === "length" && continuationCount <= MAX_CONTINUATIONS);

  if (continuationCount > MAX_CONTINUATIONS) {
    console.log(`\n(최대 연속 생성 횟수 ${MAX_CONTINUATIONS}회 도달)`);
  }
}

generate().catch(console.error);
