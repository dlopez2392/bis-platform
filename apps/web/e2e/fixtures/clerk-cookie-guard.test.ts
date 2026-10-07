import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { guardClerkDevBrowserCookie } from "./clerk-cookie-guard";

/**
 * The cookie store a navigation reads, modelled as the ordered list of
 * writes that reached it. The guard sits between the page's
 * `document.cookie = ...` and this list, exactly where it sits in Chromium.
 */
class FakeDocument {
  store: string[] = [];
}
Object.defineProperty(FakeDocument.prototype, "cookie", {
  configurable: true,
  get(this: FakeDocument) {
    return this.store.join("\n");
  },
  set(this: FakeDocument, v: string) {
    this.store.push(v);
  },
});

const g = globalThis as Record<string, unknown>;
let doc: FakeDocument;
const write = (v: string) => {
  (doc as unknown as { cookie: string }).cookie = v;
};
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const PAST = "Thu, 01 Jan 1970 00:00:00 GMT";
const FUTURE = "Fri, 01 Oct 2027 00:00:00 GMT";
const del = (name: string, extra = "; path=/") => `${name}=; expires=${PAST}${extra}`;
const set = (name: string, value: string, extra = "; path=/") => `${name}=${value}; expires=${FUTURE}${extra}`;

beforeEach(() => {
  doc = new FakeDocument();
  g.Document = FakeDocument;
  g.document = doc;
  g.location = { pathname: "/dashboard/accounts/abc/settings" };
  guardClerkDevBrowserCookie();
});
afterEach(() => {
  delete g.Document;
  delete g.document;
  delete g.location;
});

describe("guardClerkDevBrowserCookie — clerk-js's remove-then-write, made atomic", () => {
  it("the exact clerk-js 6.36.0 sequence never reaches the store as a deletion (mutation: drop the hold → FAILS)", async () => {
    // devBrowser cookie handler's set(): o() removes the suffixed then the
    // plain cookie, under three attribute variants each, then writes both.
    for (const name of ["__clerk_db_jwt_5lB98H6L", "__clerk_db_jwt"]) {
      write(del(name, "; path=/; SameSite=Lax"));
      write(del(name, "; path=/"));
      write(del(name, "; path=/; SameSite=None; Secure"));
    }
    write(set("__clerk_db_jwt_5lB98H6L", "dvb_new"));
    write(set("__clerk_db_jwt", "dvb_new"));
    await tick();
    expect(doc.store).toEqual([set("__clerk_db_jwt_5lB98H6L", "dvb_new"), set("__clerk_db_jwt", "dvb_new")]);
  });

  it("a deletion with nothing written after it — a sign-out — still happens, one microtask later", async () => {
    write(del("__clerk_db_jwt"));
    expect(doc.store).toEqual([]);
    await tick();
    expect(doc.store).toEqual([del("__clerk_db_jwt")]);
  });

  it("a write of a DIFFERENT cookie does not cancel a held deletion (mutation: drop on any write → FAILS)", async () => {
    write(del("__clerk_db_jwt_5lB98H6L"));
    write(set("__clerk_db_jwt", "dvb_new"));
    await tick();
    expect(doc.store).toEqual([set("__clerk_db_jwt", "dvb_new"), del("__clerk_db_jwt_5lB98H6L")]);
  });

  it("a deletion of the same name under another Domain is a different cookie, so it still goes through", async () => {
    write(del("__clerk_db_jwt", "; path=/; domain=localhost"));
    write(set("__clerk_db_jwt", "dvb_new"));
    await tick();
    expect(doc.store).toEqual([set("__clerk_db_jwt", "dvb_new"), del("__clerk_db_jwt", "; path=/; domain=localhost")]);
  });

  it("a deletion with no Path resolves to the document's default path, as the browser does", async () => {
    // Default path of /dashboard/accounts/abc/settings is /dashboard/accounts/abc:
    // a different cookie from path=/, so the write does not cancel it.
    write(del("__clerk_db_jwt", ""));
    write(set("__clerk_db_jwt", "dvb_new"));
    await tick();
    expect(doc.store).toEqual([set("__clerk_db_jwt", "dvb_new"), del("__clerk_db_jwt", "")]);

    // At the root, the default path IS /: the same cookie, so the write
    // supersedes it. Replaying it after the write would delete the new value.
    doc.store = [];
    g.location = { pathname: "/" };
    write(del("__clerk_db_jwt", ""));
    write(set("__clerk_db_jwt", "dvb_root"));
    await tick();
    expect(doc.store).toEqual([set("__clerk_db_jwt", "dvb_root")]);
  });

  it("Max-Age=0 is a deletion too", async () => {
    write("__clerk_db_jwt=; Max-Age=0; path=/");
    write(set("__clerk_db_jwt", "dvb_new"));
    await tick();
    expect(doc.store).toEqual([set("__clerk_db_jwt", "dvb_new")]);
  });

  it("a partitioned deletion addresses another cookie jar and passes straight through", () => {
    write(del("__clerk_db_jwt", "; path=/; Secure; SameSite=None; Partitioned"));
    expect(doc.store).toEqual([del("__clerk_db_jwt", "; path=/; Secure; SameSite=None; Partitioned")]);
  });

  it("every other cookie, the session token's deletion included, is untouched and in order", () => {
    write(del("__session"));
    write(set("__session_5lB98H6L", "jwt"));
    write("theme=dark; path=/");
    expect(doc.store).toEqual([del("__session"), set("__session_5lB98H6L", "jwt"), "theme=dark; path=/"]);
  });

  it("reads still see the real store", () => {
    write(set("__clerk_db_jwt", "dvb_x"));
    expect((doc as unknown as { cookie: string }).cookie).toContain("dvb_x");
  });
});

describe("every spec gets the guard", () => {
  const dir = join(__dirname, "..");
  const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));

  it("finds the specs", () => {
    expect(specs.length).toBeGreaterThan(30);
  });

  it.each(specs)("%s imports test from ./fixtures/test, never from @playwright/test", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    expect(src).not.toMatch(/from\s+["']@playwright\/test["']/);
    expect(src).toMatch(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']\.\/fixtures\/test["']/);
  });

  it("the shared test installs the guard on its own context AND on every browser.newContext()", () => {
    const src = readFileSync(join(__dirname, "test.ts"), "utf8");
    expect(src.match(/addInitScript\(guardClerkDevBrowserCookie\)/g)).toHaveLength(2);
    expect(src).toMatch(/scope:\s*"worker",\s*auto:\s*true/);
    expect(src).toMatch(/\{\s*auto:\s*true\s*\}/);
  });
});
