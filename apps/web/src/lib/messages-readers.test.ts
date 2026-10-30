import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * S-06 part 3 (spec "Every reader of messages"; decision 5: nothing ever SENDS a web chat row). Every
 * source file that reads or writes `messages`, how many times, and what a web chat row does to it. A new
 * reader fails BY NAME until someone writes down what a chat row (channel 'webchat', Sofía's outbound with
 * status 'delivered') does to it — the question no sender may skip.
 *
 * This guard counts CALL SITES only: it cannot see a filter. Dropping `.neq("channel", "webchat")` from
 * the delivery webhook's read (G29), or `.eq("channel", "sms")` from the text-back cooldown or its
 * release, leaves every count here unchanged. Those regressions are pinned on the replica by
 * packages/db/src/test/webchat.test.ts, "nothing reads a chat row as a text or a send" (~274-286).
 */
const REPO = join(__dirname, "../../../..");
const ROOTS = ["apps/web/src", "packages/db/src"];
const READERS: Readonly<Record<string, { count: number; why: string }>> = {
  "apps/web/src/lib/auth/visible.ts": { count: 1, why: "one message by id, for a visibility proof: unchanged" },
  "packages/db/src/automations.ts": { count: 3, why: "reactivation (any row keeps a customer out of 'it's been a while') and quote follow-up heard-back (inbound, any channel: a visitor turn is hearing back)" },
  "packages/db/src/booking.ts": { count: 3, why: "discards a QUEUED outbound EMAIL only; a notice's status by id; re-sorts after a discard (G30)" },
  "packages/db/src/inbound-email.ts": { count: 2, why: "deletes an inbound EMAIL by its Resend id; re-sorts after an unfile (G30)" },
  "packages/db/src/messaging.ts": { count: 15, why: "createMessage/fileWebchatTurns write; status by id; delivery webhook (outbound, never webchat: G29); inbound dedupe by provider id; text-back cooldown and failed texts (sms only); preview; thread; the record's email/sms page; listContactMessages' no-page read (MESSAGE_COLS; no production caller; pinned by messaging-author-shape.test.ts); search; one message's thread for its unread bump (0106: a merge can move it)" },
  "packages/db/src/record.ts": { count: 4, why: "Last talked (email, sms, webchat) for one and for a set; the chats source's anchor and count reads" },
  "packages/db/src/voice.ts": { count: 1, why: "callerInTouchSince: inbound SMS only (G17: a chat does not release a held text-back)" },
  "packages/db/src/webchat.ts": { count: 1, why: "listWebchatKeys: one chat's own keys" },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("every reader of messages is listed with what a web chat row does to it (S-06 part 3)", () => {
  const found: Record<string, number> = {};
  for (const root of ROOTS) {
    for (const file of walk(join(REPO, root))) {
      const n = (readFileSync(file, "utf8").match(/\.from\(["']messages["']\)/g) ?? []).length;
      if (n > 0) found[relative(REPO, file).split(sep).join("/")] = n;
    }
  }

  it("the walk reaches the writer itself (a guard that finds nothing proves nothing)", () => {
    expect(found["packages/db/src/messaging.ts"]).toBeGreaterThan(0);
  });

  it("exactly these files, these many times (mutation: add a db.from(\"messages\") read anywhere → FAILS naming the file)", () => {
    expect(found).toEqual(Object.fromEntries(Object.entries(READERS).map(([k, v]) => [k, v.count])));
  });

  it("every entry says why (mutation: an empty why → FAILS)", () => {
    for (const [k, v] of Object.entries(READERS)) expect(v.why.length, k).toBeGreaterThan(20);
  });
});
