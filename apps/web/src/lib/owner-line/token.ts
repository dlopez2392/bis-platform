// apps/web/src/lib/owner-line/token.ts
// Decision T (docs/superpowers/specs/2026-11-09-owner-line-spike.md): a short-lived token PostgREST accepts as the
// person, so RLS decides exactly as in the app (spec §5, preferred path). The claims RLS reads are sub (Clerk user),
// org_id (Clerk org) and role; app_role is NEVER minted, so this can never mint the agency. If the spike chose an
// imported asymmetric key instead of the legacy secret, this file is the one that changes (algorithm and env name);
// its test pins the claims, which do not.
import { createHmac } from "node:crypto";

export const OWNER_LINE_TOKEN_TTL_SECONDS = 120;

export function mintOwnerLineToken(
  p: { clerkUserId: string; clerkOrgId: string }, nowMs: number, env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.SUPABASE_JWT_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("owner line: SUPABASE_JWT_SECRET is not set");
  const iat = Math.floor(nowMs / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "authenticated", aud: "authenticated", sub: p.clerkUserId, org_id: p.clerkOrgId,
    iat, exp: iat + OWNER_LINE_TOKEN_TTL_SECONDS });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
