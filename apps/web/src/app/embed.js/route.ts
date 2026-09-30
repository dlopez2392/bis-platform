import { EMBED_SCRIPT } from "@/lib/forms/embed-script";

// A route folder may contain a dot, so this serves /embed.js. The proxy
// (src/proxy.ts, formerly middleware.ts) never runs here: its matcher
// excludes any path containing a dot, which is exactly what a public asset
// wants.
export async function GET(): Promise<Response> {
  return new Response(EMBED_SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
