/**
 * Higgsfield — Seedance 2.5 text-to-video, minimal end-to-end example.
 *
 * Run:  pnpm higgsfield
 *   (= tsx --env-file=.env.local index.ts — Node 24 loads the env file natively,
 *    so no dotenv dependency.)
 *
 * CREDENTIALS. `HF_CREDENTIALS` is `key-id:key-secret` and lives in
 * `.env.local`, which `.gitignore`'s `.env*` rule already covers. It is read
 * here and handed straight to the SDK; it is never logged, printed or written
 * anywhere. The v2 client refuses to run in a browser for the same reason —
 * this is a server-side script by design.
 */
import { config, higgsfield } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

async function main(): Promise<void> {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) {
    // Named, never echoed: the point is to say WHICH variable is missing and
    // where it belongs, without putting a secret on a terminal.
    throw new Error(
      "HF_CREDENTIALS is not set. Add it to .env.local as key-id:key-secret.",
    );
  }
  config({ credentials });

  console.log(`Requesting ${MODEL} …`);

  const result = await higgsfield.subscribe(MODEL, {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    // The SDK polls to completion rather than returning a job to chase.
    withPolling: true,
  });

  // ANYTHING BUT `completed` IS A FAILURE, and it is checked as a whitelist
  // rather than a list of known-bad statuses. `V2RequestStatus` is
  // 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' — note it does
  // NOT include 'canceled', even though the response carries a `cancel_url`
  // and a request can be cancelled. A denylist of failed/canceled/nsfw would
  // therefore let a cancelled run fall through and be reported as success.
  if (result.status !== "completed") {
    const reason =
      result.status === "nsfw"
        ? "the request was moderated"
        : result.status === "failed"
          ? "the request failed"
          : `the request ended as "${result.status}"`;
    throw new Error(`${reason} (request_id ${result.request_id})`);
  }

  // A `completed` status with no video is still not a success — say so rather
  // than printing "undefined".
  const url = result.video?.url;
  if (!url) {
    throw new Error(
      `completed but returned no video (request_id ${result.request_id})`,
    );
  }

  console.log(`Video URL: ${url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
