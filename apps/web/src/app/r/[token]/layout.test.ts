import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicHtml } from "@/components/public/public-html";

// next/font/google throws outside a Next build (app/d/[token]/layout.test.ts).
vi.mock("next/font/google", () => ({ Geist: (o: unknown) => o, Inter: (o: unknown) => o, Source_Serif_4: (o: unknown) => o }));
const dbm = vi.hoisted(() => ({ serviceDb: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));

import CheckinLayout, { metadata } from "./layout";
import { sealCheckinToken } from "@/lib/checkin/token";

const SECRET = "layout-test-secret-0123456789abcdef-0123";
const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-${String(n).repeat(12)}`;
const SENTINEL = "__children__";
const render = (token: string) => CheckinLayout({ params: Promise.resolve({ token }), children: SENTINEL });

beforeEach(() => { vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET); dbm.serviceDb.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe("/r/[token] layout: the shell always stands", () => {
  it("<html lang> is the token's own language, read from the signature with no database (mutation: hard-code en -> FAILS)", async () => {
    const es = await render(sealCheckinToken({ v: 1, a: ID(1), b: ID(2), l: "es", i: 1 }, SECRET));
    expect(es.type).toBe(PublicHtml);
    expect(es.props.lang).toBe("es");
    expect(es.props.children).toBe(SENTINEL);
    expect((await render(sealCheckinToken({ v: 1, a: ID(1), b: ID(2), l: "en", i: 1 }, SECRET))).props.lang).toBe("en");
    expect(dbm.serviceDb).not.toHaveBeenCalled();
  });

  it("a token that does not verify, or no secret, renders in English around the page's own both-languages message", async () => {
    expect((await render("junk")).props.lang).toBe("en");
    const token = sealCheckinToken({ v: 1, a: ID(1), b: ID(2), l: "es", i: 1 }, SECRET);
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect((await render(token)).props.lang).toBe("en");
  });

  it("carries the favicon (app/ declares none; the page sets its own title)", () => {
    expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
  });
});
