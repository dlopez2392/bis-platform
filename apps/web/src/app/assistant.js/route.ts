import { ASSISTANT_EMBED_SCRIPT } from "@/lib/assistant/embed-script";

// A route folder may contain a dot, so this serves /assistant.js — same
// convention `app/embed.js/route.ts` uses, and for the same reason:
// middleware never runs here (its matcher excludes any path with a dot),
// which is exactly what a public asset wants.
export async function GET(): Promise<Response> {
  return new Response(ASSISTANT_EMBED_SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
