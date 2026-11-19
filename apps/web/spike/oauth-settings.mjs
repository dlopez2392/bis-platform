// usage: node --env-file=<path to apps/web/.env.local> oauth-settings.mjs [get|enable]
const sk = process.env.CLERK_SECRET_KEY ?? "";
const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
let host = "";
try { host = Buffer.from(pk.replace(/^pk_test_/, ""), "base64").toString("utf8"); } catch { host = ""; }
if (!sk.startsWith("sk_test_") || !pk.startsWith("pk_test_") || !host.startsWith("topical-redfish-40.clerk.accounts.dev")) {
  console.log("REFUSED: env is not the BIS Clerk development instance"); process.exit(2);
}
const mode = process.argv[2] ?? "get";
const url = "https://api.clerk.com/v1/instance/oauth_application_settings";
const init = { method: mode === "enable" ? "PATCH" : "GET", headers: { authorization: `Bearer ${sk}`, "content-type": "application/json" } };
if (mode === "enable") init.body = JSON.stringify({ dynamic_oauth_client_registration: true });
const res = await fetch(url, init);
console.log(init.method, res.status, await res.text());
