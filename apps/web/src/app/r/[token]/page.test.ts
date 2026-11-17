import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { fakeDb, writesOf } from "@/lib/checkin/fake-db";

const dbm = vi.hoisted(() => ({
  getCheckinForBooking: vi.fn(), recordCheckinAnswer: vi.fn(), ensureCheckinTask: vi.fn(), markReviewLinkOpened: vi.fn(),
  getAutomation: vi.fn(), getBranding: vi.fn(), serviceDb: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));
vi.mock("./actions", () => ({ answerCheckinAction: vi.fn(), reviewLinkAction: vi.fn() }));

import CheckinPage, { generateMetadata } from "./page";
import { sealCheckinToken } from "@/lib/checkin/token";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import type { Branding } from "@bis/db";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const OTHER_ACCT = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const BOOKING = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const CONTACT = "11111111-2222-4333-8444-555555555555";
const REVIEW = "https://g.page/r/rio-roofing/review";
const BRANDING: Branding = { brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#0e7490", brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null };
const REVIEW_WORDS = /review|reseña/i;
/** What a reader sees: the page's own <style> carries class names with "review" in them and is not copy. */
const visible = (html: string) => renderedText(html.replace(/<style>[\s\S]*?<\/style>/g, ""));

const tokenFor = (l: "en" | "es", i = Date.now() - 3_600_000) => sealCheckinToken({ v: 1, a: ACCT, b: BOOKING, l, i }, SECRET);
const answerRow = (answer: string) => ({ id: "c1", accountId: ACCT, bookingId: BOOKING, contactId: CONTACT, answer, answeredAt: new Date().toISOString(), reviewLinkOpenedAt: null });
let world: ReturnType<typeof fakeDb>;
const newWorld = (bookings = [{ id: BOOKING, account_id: ACCT, status: "completed", contact_id: CONTACT }]) => { world = fakeDb({ bookings }); };
const render = async (token: string, searchParams: Record<string, string> = {}) =>
  renderToStaticMarkup(await CheckinPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(searchParams) }));
/** The review button's whole form, from its own testid to its closing tag. */
const reviewForm = (html: string) => /<form[^>]*data-testid="checkin-review"[\s\S]*?<\/form>/.exec(html)?.[0] ?? null;
const sentence = (html: string) => /<p class="bis-checkin-sentence">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? null;

beforeEach(() => {
  for (const f of Object.values(dbm)) f.mockReset();
  newWorld();
  dbm.serviceDb.mockImplementation(() => world.db);
  dbm.getCheckinForBooking.mockResolvedValue(null);
  dbm.getBranding.mockResolvedValue(BRANDING);
  dbm.getAutomation.mockResolvedValue({ enabled: true, config: { channel: "email", reviewUrl: REVIEW, checkin: true } });
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

const noWrites = () => {
  expect(writesOf(world.log)).toEqual([]);
  for (const f of [dbm.recordCheckinAnswer, dbm.ensureCheckinTask, dbm.markReviewLinkOpened]) expect(f).not.toHaveBeenCalled();
};

describe("/r/[token]: before the answer", () => {
  it("asks one question with three equal answer buttons, each a form press; no review word anywhere, in either language, and NOTHING is written by the GET (mutation: record on render -> FAILS)", async () => {
    for (const [lang, labels, title] of [["en", ["Great", "Okay", "Not great"], "How did we do?"], ["es", ["Muy bien", "Más o menos", "No muy bien"], "¿Cómo nos fue?"]] as const) {
      const html = await render(tokenFor(lang));
      const text = visible(html);
      expect(text).toContain(title);
      const buttons = [...html.matchAll(/<button([^>]*)>([^<]*)</g)].map((x) => ({ attrs: x[1]!, label: x[2]! }))
        .filter((x) => /name="answer"/.test(x.attrs))
        .map((x) => [/value="(\w+)"/.exec(x.attrs)?.[1], x.label]);
      expect(buttons)
        .toEqual([["great", labels[0]], ["okay", labels[1]], ["not_great", labels[2]]]);
      expect(text, `${lang}: nothing before the answer mentions a review`).not.toMatch(REVIEW_WORDS);
      expect(html).not.toContain('data-testid="checkin-review"');
      // A chooser of equal single-step actions carries no primary (DESIGN.md rule 8, the F-118 amendment).
      expect(html).not.toMatch(/class="bis-checkin-primary"/);
    }
    noWrites();
  });

  it("the brand rides on the page (rule 9): its name in the header and ITS colour on the page's tokens (mutation: render with the unbranded theme -> FAILS)", async () => {
    const html = await render(tokenFor("en"));
    expect(html).toContain("Rio Roofing");
    const accent = (publicFormTheme(BRANDING, false).style as Record<string, string>)["--form-accent"];
    expect(accent).toBeTruthy();
    expect(html).toContain(`--form-accent:${accent}`);
  });

  it("the page speaks the language the token carries, in the document's own lang (mutation: read the language from anywhere else -> FAILS)", async () => {
    const es = await render(tokenFor("es"));
    expect(es).toMatch(/<main[^>]*lang="es"/);
    expect(renderedText(es)).toContain("Toque la respuesta que mejor le parezca.");
    expect(renderedText(es)).not.toContain("Tap the answer");
    const en = await render(tokenFor("en"));
    expect(en).toMatch(/<main[^>]*lang="en"/);
    expect(renderedText(en)).toContain("Tap the answer that fits best.");
  });

  it("a booking of ANOTHER account, or one that is not completed, is 'not valid': no answers, no review button, none of that business's data", async () => {
    for (const bookings of [
      [{ id: BOOKING, account_id: OTHER_ACCT, status: "completed", contact_id: CONTACT }],
      [{ id: BOOKING, account_id: ACCT, status: "scheduled", contact_id: CONTACT }],
      [],
    ]) {
      newWorld(bookings);
      const html = await render(tokenFor("en"));
      expect(renderedText(html)).toContain("This link is not valid.");
      expect(html).not.toContain('data-testid="checkin-review"');
      expect(html).not.toMatch(/name="answer"/);
      expect(html).not.toContain("Rio Roofing");
    }
    expect(dbm.getBranding).not.toHaveBeenCalled();
    expect(dbm.getAutomation).not.toHaveBeenCalled();
  });

  it("an unreadable database throws to the error boundary, never a guessed page", async () => {
    dbm.getCheckinForBooking.mockRejectedValue(new Error("down"));
    await expect(render(tokenFor("en"))).rejects.toThrow("down");
  });

  it("a failed tap ('?retry=1') shows the designed 'please tap again' above the same three buttons, in the token's language", async () => {
    const html = await render(tokenFor("es"), { retry: "1" });
    expect(renderedText(html)).toContain("Algo salió mal.");
    expect(renderedText(html)).toContain("Por favor toque de nuevo.");
    expect(html).toMatch(/role="alert"/);
    expect(html.match(/name="answer"/g)).toHaveLength(3);
  });

  it("nothing in the query string reaches the page's markup or its links (the review link is never read from it)", async () => {
    const html = await render(tokenFor("en"), { url: "https://evil.example/phish", retry: "x" });
    expect(html).not.toContain("evil.example");
  });
});

describe("/r/[token]: after the answer, everyone gets the same review button", () => {
  it.each(["great", "okay", "not_great"] as const)("%s: the thank-you, the answer they gave, and the review form", async (answer) => {
    dbm.getCheckinForBooking.mockResolvedValue(answerRow(answer));
    const html = await render(tokenFor("en"));
    expect(reviewForm(html), "the review button is on the page").not.toBeNull();
    expect(renderedText(html)).toContain(`You answered: ${{ great: "Great", okay: "Okay", not_great: "Not great" }[answer]}.`);
    expect(html).not.toMatch(/name="answer"/);
    noWrites();
  });

  it("ONE button across all three answers: the same markup, the same label, the same target, the same prominence (mutation P4: hide it on not_great -> FAILS)", async () => {
    const forms: Record<string, string | null> = {};
    for (const a of ["great", "okay", "not_great"] as const) {
      dbm.getCheckinForBooking.mockResolvedValue(answerRow(a));
      forms[a] = reviewForm(await render(tokenFor("en")));
    }
    expect(forms.not_great, "not great still shows the button").not.toBeNull();
    expect(forms.great).toBe(forms.okay);
    expect(forms.great).toBe(forms.not_great);
    expect(forms.great).toContain("Leave a review");
    expect(forms.great).toContain('class="bis-checkin-primary"');
  });

  it("only the sentence above the button differs by answer: great and okay share one, not great apologises and names the business", async () => {
    const said: Record<string, string | null> = {};
    for (const a of ["great", "okay", "not_great"] as const) {
      dbm.getCheckinForBooking.mockResolvedValue(answerRow(a));
      said[a] = sentence(await render(tokenFor("en")));
    }
    expect(said.great).toBe("Thank you. If you have a minute, a review helps Rio Roofing a lot.");
    expect(said.okay).toBe(said.great);
    expect(said.not_great).toBe("We&#x27;re sorry we missed the mark. We&#x27;ve let Rio Roofing know. If you&#x27;d still like to leave a review, here is the link.");
  });

  it("in Spanish, usted, and the same one button", async () => {
    dbm.getCheckinForBooking.mockResolvedValue(answerRow("not_great"));
    const html = await render(tokenFor("es"));
    expect(renderedText(html)).toContain("Lamentamos no haber estado a la altura. Ya le avisamos a Rio Roofing.");
    expect(reviewForm(html)).toContain("Dejar una reseña");
  });

  it("the review link itself is never in the page (it is read when the button is pressed, so a scanner cannot count a press)", async () => {
    dbm.getCheckinForBooking.mockResolvedValue(answerRow("great"));
    expect(await render(tokenFor("en"))).not.toContain("g.page");
  });

  it("an account with no review link omits the button and the words that point at it, cleanly", async () => {
    dbm.getAutomation.mockResolvedValue(null);
    for (const a of ["great", "not_great"] as const) {
      dbm.getCheckinForBooking.mockResolvedValue(answerRow(a));
      const html = await render(tokenFor("en"));
      expect(reviewForm(html)).toBeNull();
      expect(visible(html)).not.toMatch(REVIEW_WORDS);
    }
  });
});

describe("/r/[token]: a link older than 30 days", () => {
  it("shows the review button alone: no answers to give, nothing written, nobody alerted", async () => {
    const html = await render(tokenFor("en", Date.now() - 31 * 86_400_000));
    expect(reviewForm(html)).not.toBeNull();
    expect(html).not.toMatch(/name="answer"/);
    expect(renderedText(html)).toContain("Thanks for choosing Rio Roofing.");
    noWrites();
  });
});

describe("/r/[token]: a link that is not a link", () => {
  it("a token that fails its MAC: the not-valid page in both languages, unbranded, and ZERO reads (mutation: skip the MAC -> FAILS)", async () => {
    const good = tokenFor("en");
    const html = await render(`${good.slice(0, -2)}${good.at(-2) === "A" ? "B" : "A"}${good.at(-1)}`);
    expect(renderedText(html)).toContain("This link is not valid.");
    expect(renderedText(html)).toContain("Este enlace no es válido.");
    expect(html).toMatch(/<section lang="en"/);
    expect(html).toMatch(/<section lang="es"/);
    expect(html).not.toContain("Rio Roofing");
    expect(dbm.serviceDb).not.toHaveBeenCalled();
    expect(world.log).toEqual([]);
    for (const f of [dbm.getBranding, dbm.getAutomation, dbm.getCheckinForBooking]) expect(f).not.toHaveBeenCalled();
  });

  it("junk, and a consent-shaped token, read nothing either", async () => {
    for (const token of ["junk", "1.forged.token", ""]) {
      expect(renderedText(await render(token))).toContain("This link is not valid.");
    }
    expect(dbm.serviceDb).not.toHaveBeenCalled();
  });

  it("an unset CONSENT_TOKEN_SECRET: 'temporarily unavailable' in both languages and ZERO queries, whatever the token", async () => {
    const token = tokenFor("en");
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    const html = await render(token);
    expect(renderedText(html)).toContain("This page is temporarily unavailable.");
    expect(renderedText(html)).toContain("Esta página no está disponible por el momento.");
    expect(dbm.serviceDb).not.toHaveBeenCalled();
    expect(world.log).toEqual([]);
  });
});

describe("/r/[token]: metadata", () => {
  it("is kept out of search engines and sends no Referer to the logo's host (mutation: drop referrer -> FAILS)", async () => {
    const g = await generateMetadata({ params: Promise.resolve({ token: tokenFor("es") }) });
    expect(g.robots).toEqual({ index: false, follow: false });
    expect(g.referrer).toBe("no-referrer");
    expect(g.title).toBe("¿Cómo nos fue?");
  });

  it("a page with no language to read titles itself in both", async () => {
    const g = await generateMetadata({ params: Promise.resolve({ token: "junk" }) });
    expect(g.title).toBe("How did we do? / ¿Cómo nos fue?");
    expect(g.robots).toEqual({ index: false, follow: false });
    expect(dbm.serviceDb).not.toHaveBeenCalled();
  });
});
