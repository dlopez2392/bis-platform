import type { Metadata } from "next";
import { readBriefToken } from "@/lib/brief/token";
import { BriefOffForm } from "./brief-off-form";
import { briefOffChrome, type BriefOffState } from "./copy";

export const dynamic = "force-dynamic";

/** Never indexed, and no Referer carries the token anywhere. The title is bilingual (the token carries no language). */
export const metadata: Metadata = {
  title: briefOffChrome().pageTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * `/brief/off/<token>`: where the daily brief's "Turn this off" link, and a client that opens the one-click URL by
 * GET, land. A GET only READS: it checks the token's signature (no database, no client) and asks. The person's own
 * press runs `turnOffAction`, so a mail scanner or a prefetch that opens this link turns nothing off. Platform-
 * neutral on purpose: it reads no account, so it carries no brand (the reader is the business's own team member,
 * not their customer), and it never prints the token. Server-rendered: no loading state.
 */
export default async function BriefOffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = readBriefToken(token);
  const initial: BriefOffState = read.ok ? "ask" : read.why === "bad_token" ? "bad_link" : "failed";
  return (
    <main className="bis-brief-off-page">
      <style>{BRIEF_OFF_CSS}</style>
      <div className="bis-brief-off">
        <BriefOffForm token={token} initial={initial} />
      </div>
    </main>
  );
}

// The /u page's convention: `var(--token, fallback)`; this tree loads no globals.css. No backticks in this literal.
const BRIEF_OFF_CSS = `
.bis-brief-off-page { background: var(--background, transparent); min-height: 100vh; }
.bis-brief-off {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 32px 16px; max-width: 480px; margin: 0 auto;
}
.bis-brief-off-section:focus { outline: none; }
.bis-brief-off-lang + .bis-brief-off-lang { margin-top: 16px; }
.bis-brief-off-title { font-size: 17px; font-weight: 600; margin: 0 0 4px; }
.bis-brief-off-detail { color: var(--muted-foreground, #71717a); margin: 0; }
.bis-brief-off-actions { margin: 20px 0 0; }
.bis-brief-off-primary {
  font: inherit; font-weight: 600; border: none; border-radius: var(--radius, 0.5rem); padding: 10px 18px; cursor: pointer;
  background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff);
}
.bis-brief-off-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.bis-brief-off-primary:focus-visible, .bis-brief-off-link:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
.bis-brief-off-link { color: var(--foreground, #18181b); }
`;
