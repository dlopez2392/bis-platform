/**
 * WHY EVERY SPEC'S BROWSER HOLDS BACK A DEV-BROWSER COOKIE DELETION FOR ONE TICK.
 *
 * CI run 36885435767 (PR #162), blueprints.spec.ts: a spec that had been
 * signed in for several page loads navigated to /dashboard/blueprints and
 * landed on /sign-in. The trace's cookie headers show why. Every request up
 * to 15:48:07.092 carried `__clerk_db_jwt` (and its instance-suffixed twin);
 * the navigation GET at 07.134 carried neither. Clerk's middleware answered
 * `x-clerk-auth-reason: dev-browser-missing`, the handshake came back for a
 * browser Clerk had never seen, and that browser is signed out.
 *
 * Who removed them: clerk-js itself (@clerk/clerk-js 6.36.0, the version the
 * dev instance served). Its dev-browser cookie handler's `set()` first
 * REMOVES both cookies, under several attribute variants, and only then
 * writes them again — and it runs that on every Frontend API response that
 * carries a `Clerk-Db-Jwt` header. After the spec's page.reload(), clerk-js
 * booted and fetched /v1/environment and /v1/client at 07.006; the
 * environment response landed at about 07.128, and the spec's page.goto went
 * out six milliseconds later.
 *
 * In-page JavaScript runs those writes in one synchronous block, but Chromium
 * applies each `document.cookie` write to the cookie store as its own message
 * to the network service. A navigation Playwright starts from OUTSIDE the
 * page reads the store directly, so it can land between the delete and the
 * write. Any spec that navigates while clerk-js is booting or refreshing is
 * exposed; which one loses depends only on timing, so it presents as a flake.
 *
 * THE GUARD makes clerk-js's remove-then-write atomic from the store's point
 * of view. A deletion of a dev-browser cookie is held until the end of the
 * current JavaScript task; if the same task writes that same cookie (same
 * name, domain and path) again, the held deletion is dropped, because the
 * write replaces the cookie anyway. Otherwise the deletion goes through one
 * microtask later.
 *
 * It masks nothing. The cookie's final state is exactly what clerk-js asked
 * for; only the intermediate "no cookie" state, which nothing should ever
 * observe, is gone. A real removal — a sign-out, or clerk-js resetting a dev
 * browser the instance rejected — has no rewrite after it, so it still
 * happens, and a spec that is genuinely signed out still lands on /sign-in.
 * Partitioned deletions address a different cookie jar from the cookie being
 * rewritten, so they are never held. No other cookie is touched.
 *
 * This function is serialised by Playwright's addInitScript and runs inside
 * the page, so it must stay self-contained: no imports, nothing from module
 * scope.
 */
export function guardClerkDevBrowserCookie(): void {
  const native = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (!native?.get || !native.set) return;
  const nativeGet = native.get;
  const nativeSet = native.set;

  const DEV_BROWSER = /^__clerk_db_jwt(?:_[A-Za-z0-9_-]+)?$/;
  /** Deletions not yet applied, in the order they were asked for. */
  const held: { id: string; cookie: string }[] = [];
  let flushQueued = false;
  const release = (entries: { cookie: string }[]) => {
    for (const e of entries) nativeSet.call(document, e.cookie);
  };

  /**
   * name|domain|path — the identity the browser keys a cookie on, so two
   * writes with the same id address the same cookie. A missing Path resolves
   * to the document's default path (RFC 6265 §5.1.4), as the browser does; a
   * missing Domain means host-only, a different cookie from Domain=<host>.
   */
  const parse = (cookie: string) => {
    const [pair = "", ...attrs] = cookie.split(";");
    const name = pair.includes("=") ? pair.slice(0, pair.indexOf("=")).trim() : "";
    let domain = "";
    let path = "";
    let expired = false;
    let partitioned = false;
    for (const attr of attrs) {
      const eq = attr.indexOf("=");
      const key = (eq < 0 ? attr : attr.slice(0, eq)).trim().toLowerCase();
      const val = eq < 0 ? "" : attr.slice(eq + 1).trim();
      if (key === "domain") domain = "." + val.toLowerCase().replace(/^\./, "");
      else if (key === "path") path = val;
      else if (key === "max-age" && val !== "" && Number(val) <= 0) expired = true;
      else if (key === "expires" && Date.parse(val) <= Date.now()) expired = true;
      else if (key === "partitioned") partitioned = true;
    }
    if (!path.startsWith("/")) {
      const dir = location.pathname.slice(0, location.pathname.lastIndexOf("/"));
      path = dir === "" ? "/" : dir;
    }
    return { name, id: `${name}|${domain}|${path}`, expired, partitioned };
  };

  Object.defineProperty(document, "cookie", {
    configurable: true,
    enumerable: true,
    get() {
      return nativeGet.call(document);
    },
    set(value: string) {
      const cookie = String(value);
      const c = parse(cookie);
      if (DEV_BROWSER.test(c.name)) {
        if (c.expired && !c.partitioned) {
          held.push({ id: c.id, cookie });
          if (!flushQueued) {
            flushQueued = true;
            queueMicrotask(() => {
              flushQueued = false;
              release(held.splice(0));
            });
          }
          return;
        }
        if (!c.expired) {
          // A held deletion of THIS cookie is superseded by the write, so it
          // is dropped: applying it would only reopen the gap. A held
          // deletion of any OTHER cookie stays held — it addresses a
          // different cookie, so applying it after this write leaves the same
          // final state. (clerk-js removes the suffixed AND the plain cookie
          // before writing either; releasing the plain one's deletion here
          // would reopen the gap for the plain cookie.)
          for (let i = held.length - 1; i >= 0; i--) if (held[i]!.id === c.id) held.splice(i, 1);
        }
      }
      nativeSet.call(document, cookie);
    },
  });
}
