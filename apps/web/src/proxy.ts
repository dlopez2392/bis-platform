import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

/**
 * Clerk never runs on the four public, stranger-facing trees: /c (the chat
 * widget), /f (forms), /b (booking) and /u (unsubscribe). None of them reads
 * auth — each has its own root layout with no ClerkProvider (see
 * app/c/layout.tsx) — and Clerk running there is not merely wasted work.
 *
 * WHY IT BROKE EMBEDS (2026-10-05). A browser that has ever signed in to the
 * platform carries Clerk's `__client_uat` cookie, and the embeds are
 * same-site with bis-rgv.com, so that cookie rides along on the framed
 * request. clerkMiddleware then answers the iframe's document request with a
 * 307 "handshake" to clerk.app.bis-rgv.com — a host the embedding site's CSP
 * `frame-src` does not (and should not have to) allow — and the browser
 * replaces the chat with "This content is blocked". Every anonymous visitor
 * was fine, which is why it went unnoticed: it hit exactly the people who
 * use the dashboard — danlo, and every client looking at their own site.
 *
 * Their APIs and server actions stay matched: they are not documents, so
 * Clerk never hands them a handshake, and /api/concierge reads no auth
 * either. `embed.js` is already outside the matcher (it contains a dot).
 */
export const config = {
  matcher: ["/((?!_next|c/|f/|b/|u/|.*\\..*).*)", "/(api|trpc)(.*)"],
};
