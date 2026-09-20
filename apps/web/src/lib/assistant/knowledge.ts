/**
 * The assistant's fetched knowledge: an owner may point their assistant at a
 * URL that returns plain text about their business — bis-rgv.com publishes
 * its per-locale site pack this way, and a client's `llms.txt` is the same
 * shape. Fetched at request time, cached per URL, and NEVER allowed to fail
 * the request: a pack that is down means an assistant that knows a little
 * less, not a visitor who gets no answer.
 */
export const KNOWLEDGE_MAX_CHARS = 40_000;
export const KNOWLEDGE_TTL_MS = 15 * 60_000;
export const KNOWLEDGE_TIMEOUT_MS = 4_000;

type Entry = { text: string | null; at: number };
const cache = new Map<string, Entry>();

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

export async function fetchKnowledge(
  url: string,
  deps: { fetchImpl?: Fetcher; now?: () => number } = {},
): Promise<string | null> {
  const now = deps.now ?? Date.now;
  const fetchImpl: Fetcher = deps.fetchImpl ?? ((u, init) => fetch(u, init));
  const hit = cache.get(url);
  if (hit && now() - hit.at < KNOWLEDGE_TTL_MS) return hit.text;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KNOWLEDGE_TIMEOUT_MS);
  let text: string | null = null;
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (res.ok) text = (await res.text()).slice(0, KNOWLEDGE_MAX_CHARS).trim() || null;
  } catch {
    text = null;
  } finally {
    clearTimeout(timer);
  }
  // A failure is cached too, for one TTL: a dead pack must not add a 4 s
  // timeout to every turn of every conversation until someone notices.
  cache.set(url, { text, at: now() });
  return text;
}

/** Test-only. */
export function __resetKnowledgeCache(): void {
  cache.clear();
}
