import { ollama, MODEL } from "./config.ts";

const PROMPT = "TypeScript의 장점을 5가지 알려줘.";

async function generate() {
  console.log(`Model: ${MODEL}`);
  console.log(`Prompt: ${PROMPT}`);
  console.log("---");

  const startTime = performance.now();
  let tokenCount = 0;
  let firstTokenTime: number | null = null;
  let fullResponse = "";

  const stream = await ollama.generate({
    model: MODEL,
    prompt: PROMPT,
    stream: true,
  });

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
      const totalTime = performance.now() - startTime;
      const generationTime = performance.now() - firstTokenTime!;

      console.log("\n\n--- Stats ---");
      console.log(`Total tokens: ${tokenCount}`);
      console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
      console.log(`Generation time: ${(generationTime / 1000).toFixed(2)}s`);
      console.log(`Tokens/sec: ${(tokenCount / (generationTime / 1000)).toFixed(2)}`);
      console.log(`TTFT (Time to First Token): ${(firstTokenTime! - startTime).toFixed(0)}ms`);

      if (chunk.eval_count && chunk.eval_duration) {
        const ollamaTps = chunk.eval_count / (chunk.eval_duration / 1e9);
        console.log(`\n--- Ollama Internal Stats ---`);
        console.log(`Eval tokens: ${chunk.eval_count}`);
        console.log(`Eval duration: ${(chunk.eval_duration / 1e9).toFixed(2)}s`);
        console.log(`Ollama TPS: ${ollamaTps.toFixed(2)}`);
        console.log(`Prompt eval: ${chunk.prompt_eval_count} tokens in ${((chunk.prompt_eval_duration ?? 0) / 1e9).toFixed(2)}s`);
      }
    }
  }
}

generate().catch(console.error);
