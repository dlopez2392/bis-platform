// pnpm --filter web exec tsx scripts/model-spike.ts
//
// The OpenAI model switch's Step 0 (a) (docs/superpowers/plans/2026-11-26-openai-model-switch.md, section 4):
// what gpt-6-luna accepts for each text task, and which gpt-6, Realtime and transcription models this key's
// project can see. Prints one markdown summary (model-spike-lib.ts says what it may and may not contain);
// sofia-corpus.yml (step=model-spike) also appends it to the job summary. Both are PUBLIC.
//
// The key comes from the shell only, never a file, and is never printed. Exit 0 when every task had an
// accepted variant, 1 when one did not, 2 when there is no key. apps/web/ci/model-spike.test.ts pins all three.
import { runModelSpike } from "./model-spike-lib";

async function main(): Promise<void> {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) {
    console.error("OPENAI_API_KEY is not set in this shell (it is never read from a file)");
    process.exit(2);
  }
  const { markdown, everyTaskAccepted } = await runModelSpike(fetch, key);
  console.log(markdown);
  process.exit(everyTaskAccepted ? 0 : 1);
}

void main();
