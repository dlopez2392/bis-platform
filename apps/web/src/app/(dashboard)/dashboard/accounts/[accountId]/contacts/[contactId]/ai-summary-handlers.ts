import { parseAiSummary, type AiSummaryResponse } from "@/lib/record/ai-summary-view";

/** One ask, then (I4) a re-ask every 2 s while another reader writes, at most 15 times. Never throws. */
export const POLL_EVERY_MS = 2_000;
export const POLL_LIMIT = 15;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Waits `ms`, or ends at once when `signal` aborts, clearing its timer (final review M-h): a closed record
 *  leaves no 2 s timer behind it. */
export function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function loadAiSummary(
  url: string, o: { force: boolean; fetchImpl?: Fetch; wait?: (ms: number) => Promise<void>; signal?: AbortSignal },
): Promise<AiSummaryResponse> {
  const f: Fetch = o.fetchImpl ?? ((u, init) => fetch(u, init));
  const wait = o.wait ?? ((ms: number) => abortableWait(ms, o.signal));
  const ask = async (method: "GET" | "POST"): Promise<AiSummaryResponse> => {
    try {
      const res = await f(url, { method, cache: "no-store", signal: o.signal });
      if (!res.ok) return { state: "failed" };
      return parseAiSummary(await res.json());
    } catch {
      return { state: "failed" };
    }
  };
  let r = await ask(o.force ? "POST" : "GET");
  for (let i = 0; i < POLL_LIMIT && r.state === "generating"; i++) {
    await wait(POLL_EVERY_MS);
    if (o.signal?.aborted) return r;
    r = await ask("GET");
  }
  return r.state === "generating" ? { state: "failed" } : r;
}
