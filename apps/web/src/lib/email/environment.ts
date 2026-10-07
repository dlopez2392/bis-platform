/**
 * THE production test, shared by getEmailProvider and the email gate (which
 * refuses to send a customer email without its unsubscribe link only in
 * production). Both signals, for the reason getEmailProvider's comment gives:
 * NODE_ENV is read from the REAL process env and cannot be pulled or spoofed.
 */
export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
}
