import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const db = vi.hoisted(() => ({ serviceDb: vi.fn(), unsubscribeFromBrief: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import Page, { metadata } from "./page";
import { turnOffAction } from "./actions";
import { sealBriefToken } from "@/lib/brief/token";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const SUB = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const token = () => sealBriefToken({ v: 1, s: SUB, i: 1_790_000_000_000 }, SECRET);
const render = async (t: string) => renderToStaticMarkup(await Page({ params: Promise.resolve({ token: t }) }));

beforeEach(() => {
  db.serviceDb.mockReset().mockReturnValue({ tag: "service" });
  db.unsubscribeFromBrief.mockReset().mockResolvedValue(true);
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("/brief/off/[token] page", () => {
  it("a GET only asks: the question in both languages and a button, and it reads NOTHING from the database", async () => {
    const html = await render(token());
    expect(html).toContain("Turn off your daily brief?");
    expect(html).toContain("¿Desactivar su resumen diario?");
    expect(html).toContain("Turn it off / Desactivar");
    expect(html).toContain('data-state="ask"');
    expect(db.serviceDb).not.toHaveBeenCalled();
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
  });

  it("a link that does not open says so in both languages, with no button, and still touches nothing", async () => {
    const html = await render("1.forged.token");
    expect(html).toContain('data-state="bad_link"');
    expect(html).toContain("This link does not work.");
    expect(html).toContain("Este enlace no funciona.");
    expect(html).not.toContain("Turn it off / Desactivar");
    expect(db.serviceDb).not.toHaveBeenCalled();
  });

  it("with CONSENT_TOKEN_SECRET unset it says it could not, not that the link is bad", async () => {
    const t = token();
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    const html = await render(t);
    expect(html).toContain('data-state="failed"');
    expect(db.serviceDb).not.toHaveBeenCalled();
  });

  it("is never indexed and sends no Referer, and its title is both languages", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(String(metadata.title)).toBe("Turn off your daily brief / Desactivar su resumen diario");
  });

  it("never prints the token or a person's address", async () => {
    const t = token();
    expect(await render(t)).not.toContain(t);
  });
});

describe("turnOffAction: the button's one write", () => {
  it("a good token deletes that subscription and answers off", async () => {
    expect(await turnOffAction(token())).toEqual({ state: "off" });
    expect(db.unsubscribeFromBrief).toHaveBeenCalledWith({ tag: "service" }, { id: SUB });
  });
  it("is idempotent: already gone is still off", async () => {
    db.unsubscribeFromBrief.mockResolvedValue(false);
    expect(await turnOffAction(token())).toEqual({ state: "off" });
  });
  it("a bad token is bad_link and writes nothing; a failed write is failed", async () => {
    expect(await turnOffAction("junk")).toEqual({ state: "bad_link" });
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
    db.unsubscribeFromBrief.mockRejectedValueOnce(new Error("boom"));
    expect(await turnOffAction(token())).toEqual({ state: "failed" });
  });
  it("an unset secret is failed with no query", async () => {
    const t = token();
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect(await turnOffAction(t)).toEqual({ state: "failed" });
    expect(db.serviceDb).not.toHaveBeenCalled();
  });
});
