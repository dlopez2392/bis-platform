import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

const dbm = vi.hoisted(() => ({ getBranding: vi.fn(), readConsentState: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm, serviceDb: () => ({ tag: "service" }) }));
const unsub = vi.hoisted(() => ({ recordUnsubscribe: vi.fn() }));
vi.mock("@/lib/consent/unsubscribe", async (importOriginal) => ({ ...(await importOriginal<object>()), ...unsub }));
vi.mock("./actions", () => ({ unsubscribeAction: vi.fn(), resubscribeAction: vi.fn() }));

import UnsubscribePage, { metadata } from "./page";
import { sealConsentToken } from "@/lib/consent/token";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import type { Branding } from "@bis/db";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const P = { v: 1 as const, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email" as const, t: "ana@example.com", i: 1_790_000_000_000, n: null };
const BRANDING: Branding = { brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#0e7490", brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null };
const render = async (token: string) => renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token }) }));

beforeEach(() => {
  dbm.getBranding.mockReset().mockResolvedValue(BRANDING);
  dbm.readConsentState.mockReset().mockResolvedValue({ state: "allowed" });
  unsub.recordUnsubscribe.mockReset();
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("/u/[token]", () => {
  it("(decision Q1) an allowed address: the question in English AND Spanish, the client's name, ONE primary button — and NOTHING recorded on the GET (a mail scanner's fetch changes nothing; mutation: record on render → FAILS)", async () => {
    const html = await render(sealConsentToken(P, SECRET));
    expect(html).toContain("Stop emails from Rio Roofing?");
    expect(html).toContain("¿Dejar de recibir correos de Rio Roofing?");
    expect(html.match(/class="bis-unsub-primary"/g)).toHaveLength(1);
    expect(html).not.toMatch(/class="bis-unsub-ghost"/);
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("a stopped address: spec §6's unsubscribed lines and ONE ghost Resubscribe, no primary (rule 8; mutation: render the primary too → FAILS)", async () => {
    dbm.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "one_click", eventId: "e1" });
    const html = await render(sealConsentToken(P, SECRET));
    expect(renderedText(html)).toContain("You're unsubscribed. Rio Roofing won't send you any more automated emails.");
    expect(html).toContain("Listo. Rio Roofing ya no le enviará correos automáticos.");
    expect(html).toContain("Resubscribe / Volver a suscribirme");
    expect(html).not.toMatch(/class="bis-unsub-primary"/);
  });

  it.each(["backfill_0049", "staff"])("a stop made by %s (not the customer's own): the QUESTION and its one primary 'Stop emails', not 'You're unsubscribed', and nothing recorded on the GET (review R1-I1, decision Q5; mutation: treat every stop as stopped → no bis-unsub-primary, FAILS)", async (method) => {
    dbm.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-09-01T00:00:00Z", method, eventId: "s1" });
    const html = await render(sealConsentToken(P, SECRET));
    expect(html.match(/class="bis-unsub-primary"/g)).toHaveLength(1);
    expect(html).toContain("Stop emails / Dejar de recibir correos");
    expect(renderedText(html)).not.toContain("You're unsubscribed.");
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("carries the client's brand (rule 9): its name in the header and ITS colour on the page's tokens, not the platform's fallback (mutation: render with the unbranded theme → FAILS)", async () => {
    const html = await render(sealConsentToken(P, SECRET));
    expect(html).toContain("Rio Roofing");
    const accentOf = (b: Branding) => (publicFormTheme(b, false).style as Record<string, string>)["--form-accent"];
    const unbranded = { ...BRANDING, brandName: null, brandColor: null };
    expect(accentOf(BRANDING)).not.toBe(accentOf(unbranded));
    expect(html).toContain(`--form-accent:${accentOf(BRANDING)}`);
  });

  it("a bad token shows spec §6's error lines in both languages, and reads nothing (mutation: 500 → FAILS)", async () => {
    const html = await render("1.forged.token");
    expect(renderedText(html)).toContain("This unsubscribe link doesn't work. Contact the business directly and ask them to stop.");
    expect(html).toContain("Este enlace no funciona.");
    expect(dbm.readConsentState).not.toHaveBeenCalled();
  });

  it("an unreadable ledger shows the 'went wrong' lines, never a guessed state (fails closed; mutation: default to allowed → FAILS)", async () => {
    dbm.readConsentState.mockRejectedValue(new Error("down"));
    const html = await render(sealConsentToken(P, SECRET));
    expect(html).toContain("Something went wrong on our side.");
    expect(html).not.toMatch(/class="bis-unsub-primary"/);
  });

  it("is kept out of search engines and sends no Referer to the logo's host (mutation: drop referrer → FAILS)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});
