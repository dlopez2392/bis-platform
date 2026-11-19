// SPIKE (PR 0, not merged): the MCP OAuth flow end to end with no human.
// Run from apps/web with the env loaded into the process (never a .env file in the tree):
//   node <scratch>/with-env.mjs <main checkout>/apps/web/.env.local node spike/oauth-e2e.mjs [baseUrl]
import crypto from "node:crypto";
import http from "node:http";
import { chromium } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken, clerk } from "@clerk/testing/playwright";
import { createRequire } from "node:module";
const { createClerkClient } = createRequire(import.meta.url)("@clerk/nextjs/server");

const BASE = process.argv[2] ?? "http://localhost:3100";
const MCP = `${BASE}/api/mcp`;
const REDIRECT = "http://localhost:3999/callback";
const out = (label, v) => console.log(`[spike] ${label}:`, typeof v === "string" ? v : JSON.stringify(v));
const where = (u) => { const x = new URL(u); return x.host + x.pathname; };

const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
if (!(process.env.CLERK_SECRET_KEY ?? "").startsWith("sk_test_") || !Buffer.from(pk.slice(8), "base64").toString().startsWith("topical-redfish-40.")) {
  console.error("REFUSED: not the BIS Clerk development instance");
  process.exit(2);
}
const clerkApi = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodeJwt = (t) => { try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()); } catch { return null; } };

async function mcp(token, body) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(MCP, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, wwwAuth: res.headers.get("www-authenticate"), body: text.slice(0, 700) };
}
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "spike", version: "0" } } };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const CALL = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } };

let userId;
const browser = await chromium.launch();
try {
  // 1. 401 -> protected-resource metadata -> authorization-server metadata
  const first = await mcp(undefined, INIT);
  out("1 no-token status", first.status);
  out("1 www-authenticate", first.wwwAuth);
  const prmUrl = /resource_metadata="([^"]+)"/.exec(first.wwwAuth ?? "")?.[1];
  const prm = await (await fetch(prmUrl)).json();
  out("1 prm.resource", prm.resource);
  out("1 prm.authorization_servers", prm.authorization_servers);
  const as = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  out("1 as.registration_endpoint", as.registration_endpoint);

  // 2. Dynamic client registration (RFC 7591), public client
  const regRes = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "BIS MCP spike", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none", scope: "profile email" }),
  });
  const reg = await regRes.json();
  out("2 DCR status", regRes.status);
  out("2 DCR result (no secret)", { client_id: reg.client_id, scope: reg.scope, token_endpoint_auth_method: reg.token_endpoint_auth_method,
    has_secret: Boolean(reg.client_secret), error: reg.error, error_description: reg.error_description });
  if (!reg.client_id) throw new Error("DCR failed");

  // 3. Throwaway user, the e2e sweep's own shape (FIXTURE_EMAIL_RE) so a leak is swept
  const email = `e2e-client-${Date.now()}@example.com`;
  const user = await clerkApi.users.createUser({ emailAddress: [email], firstName: "E2E", lastName: "MCP Spike",
    skipPasswordRequirement: true, skipLegalChecks: true });
  userId = user.id;
  out("3 throwaway user", userId);

  // 4. Browser: testing token, sign in by ticket on the app, then authorize with PKCE
  await clerkSetup({ publishableKey: pk, secretKey: process.env.CLERK_SECRET_KEY });
  const context = await browser.newContext();
  const page = await context.newPage();
  await setupClerkTestingToken({ page });
  await page.goto(`${BASE}/sign-in`);
  const { token: ticket } = await clerkApi.signInTokens.createSignInToken({ userId, expiresInSeconds: 300 });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });
  await page.waitForFunction(() => Boolean(window.Clerk?.user));
  const sessionJwt = await page.evaluate(() => window.Clerk.session.getToken());
  out("4 signed in on app; session JWT claim keys", Object.keys(decodeJwt(sessionJwt) ?? {}));

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const authUrl = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: "profile email",
    state, code_challenge: challenge, code_challenge_method: "S256", resource: MCP })) authUrl.searchParams.set(k, v);

  let callbackUrl;
  // A real listener: Clerk's testing-token route re-fetches FAPI calls and follows the 303 itself.
  const cbServer = http.createServer((req, res) => { callbackUrl = `http://localhost:3999${req.url}`; res.end("ok"); });
  await new Promise((r) => cbServer.listen(3999, "localhost", r));
  await page.goto(authUrl.toString());
  await page.waitForLoadState("networkidle").catch(() => {});
  out("4 after authorize, at", where(page.url()));
  if (!callbackUrl && /sign-in/.test(page.url())) {
    out("4 authorize sent us to sign-in", "signing in there with a fresh ticket");
    await setupClerkTestingToken({ page });
    await page.waitForFunction(() => Boolean(window.Clerk?.loaded), null, { timeout: 30000 });
    const { token: t2 } = await clerkApi.signInTokens.createSignInToken({ userId, expiresInSeconds: 300 });
    await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: t2 } });
    await page.goto(authUrl.toString());
    await page.waitForLoadState("networkidle").catch(() => {});
    out("4 after second authorize, at", where(page.url()));
  }
  if (!callbackUrl) {
    await page.screenshot({ path: "spike/consent.png" });
    out("4 consent screen buttons", await page.getByRole("button").allTextContents());
    const allow = page.getByRole("button", { name: /allow|authorize|accept|continue/i }).first();
    await allow.click({ timeout: 15000 });
    for (let i = 0; i < 60 && !callbackUrl; i++) await page.waitForTimeout(250);
  }
  if (!callbackUrl) throw new Error(`no callback; stuck at ${where(page.url())}`);
  cbServer.close();
  const cb = new URL(callbackUrl);
  out("4 callback state matches", cb.searchParams.get("state") === state);
  out("4 callback error", cb.searchParams.get("error"));
  const code = cb.searchParams.get("code");
  if (!code) throw new Error("no code");

  // 5. Code exchange
  const tokRes = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier, resource: MCP }),
  });
  const tok = await tokRes.json();
  out("5 token status", tokRes.status);
  out("5 token response (no values)", { token_type: tok.token_type, scope: tok.scope, expires_in: tok.expires_in,
    has_refresh: Boolean(tok.refresh_token), has_id_token: Boolean(tok.id_token), error: tok.error, error_description: tok.error_description });
  const at = tok.access_token;
  const claims = decodeJwt(at);
  out("5 access token is a JWT", Boolean(claims));
  if (claims) out("5 access token claims (ids/times only)", { iss: claims.iss, sub: claims.sub, aud: claims.aud, client_id: claims.client_id,
    scope: claims.scope, scp: claims.scp, lifetime_s: claims.exp - claims.iat, keys: Object.keys(claims) });

  // 6. MCP with the access token
  out("6 initialize", await mcp(at, INIT));
  out("6 tools/list", await mcp(at, LIST));
  out("6 tools/call whoami", await mcp(at, CALL));
  out("6 expected user", userId);

  // 7. Negative cases
  out("7a session JWT as bearer", await mcp(sessionJwt, LIST));
  out("7b garbage bearer (one part)", await mcp("garbage", LIST));
  out("7b garbage bearer (three parts)", await mcp("garbage.token.value", LIST));
  out("7c no bearer", await mcp(undefined, LIST));
  if (claims) {
    const [h, , s] = at.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}.${s}`;
    out("7d expired-claim token (payload edited, signature no longer matches)", await mcp(forged, LIST));
  }
  const rv = await fetch(as.revocation_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: at, client_id: reg.client_id }),
  });
  out("7e revoke status", rv.status);
  out("7e revoke body", (await rv.text()).slice(0, 300));
  out("7e revoked token as bearer", await mcp(at, LIST));
  // A refresh: does it work for a public DCR client, and is the new access token accepted?
  const rf = await fetch(as.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }) });
  const rft = await rf.json();
  out("7f refresh status", rf.status);
  out("7f refreshed token whoami", rft.access_token ? await mcp(rft.access_token, CALL) : rft.error);
  // Deleted Clerk user: is the (24 h) JWT still accepted?
  await clerkApi.users.deleteUser(userId);
  out("7g deleted user", userId);
  const deletedId = userId;
  userId = undefined;
  out("7g token of deleted user, whoami", await mcp(at, CALL));
  out("7g refresh after delete", (await fetch(as.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rft.refresh_token ?? tok.refresh_token, client_id: reg.client_id }) })).status);
  void deletedId;
  out("result", "END");
} finally {
  await browser.close();
  if (userId) {
    await clerkApi.users.deleteUser(userId);
    out("cleanup deleted user", userId);
  }
}
