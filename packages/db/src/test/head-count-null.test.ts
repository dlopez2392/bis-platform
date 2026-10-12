import { describe, it, expect } from "vitest";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation } from "../messaging";
import { countRecentAlertPhoneVerifications } from "../alert-phone-verification";
import { countAutomationUsage } from "../automation-log";
import {
  countReviewRequestsSince, countNoShowNudgesSince, countReferralAsksSince, conversationQuietSince,
  countReactivationsSince, countQuoteFollowupsSince, countInstantRepliesSince,
} from "../automations";
import { countRecentBookings } from "../booking";
import { countConciergeConversationsByIp, countConciergeConversationsForAccount } from "../concierge";
import { countContacts } from "../contacts";
import { countRecentSubmissions, countFormsMissingNotify } from "../forms";
import { addPlace, addEquipment, removePlace, getPlace } from "../places";
import { countScreenedCalls, countMisconfiguredScreenedCalls } from "../screened-calls";
import { countTrafficDays } from "../sites";
import { countExpiredUsage } from "../usage";
import { countWebSessionsByIp, countWebSessionsForAccount } from "../voice-web-sessions";
import {
  countCallsSince, countAnsweredCallsSince, hasActiveCallSince, countCallsByCallerSince,
  countCallerHistorySince, callerInTouchSince,
} from "../voice";

/**
 * A HEAD count read that FAILS can come back as `{ count: null, error: null }`:
 * postgrest-js 2.110.8 (dist/index.cjs, processResponse) reads a HEAD
 * request's empty 404 body as "204 No Content" and leaves `error` null, and it
 * only ever sets `count` on an OK response. Read as `count ?? 0`, that failure
 * becomes a real-looking zero: a rate limiter that lets everything through, a
 * daily cap that never fills, a "not in touch" that sends a held text-back.
 *
 * Every function below must REJECT on that shape instead. The client is wrapped
 * so `.from(<table>)`'s `select(cols, opts)` drops `opts` — PostgREST then
 * really answers with no count (a plain GET, `count` null, `error` null), the
 * same observable shape as the failure. Each test's name carries its probe:
 * restoring `count ?? 0` in that function makes it resolve, so it FAILS.
 */
function noCount(db: SupabaseClient, table: string): SupabaseClient {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (t: string) => {
        const q = target.from(t);
        if (t !== table) return q;
        return { select: (cols: string) => q.select(cols) };
      };
    },
  }) as SupabaseClient;
}

const ACTOR = "user_test";
const SINCE = new Date(Date.now() - 24 * 3600_000).toISOString();
const noCountReturned = (fn: string) => new RegExp(`${fn}[^:]*failed: no count returned`);

describe("HEAD count reads fail closed on a count-less answer, never read it as 0", () => {
  // No fixture rows needed: a random account matches nothing, and a count-less
  // answer is what is under test, not the number.
  const db = serviceDb();
  const account = randomUUID();
  const caller = "+19995550123";

  it("countRecentAlertPhoneVerifications (alert code send limit; mutation: restore `count ?? 0` -> resolves 0, FAILS)", async () => {
    await expect(countRecentAlertPhoneVerifications(noCount(db, "alert_phone_verifications"), account, caller))
      .rejects.toThrow(noCountReturned("countRecentAlertPhoneVerifications"));
  });

  it("countAutomationUsage (Activity page usage card; mutation: restore `n ?? 0` -> resolves zeros, FAILS)", async () => {
    await expect(countAutomationUsage(noCount(db, "automation_log"), account, SINCE, new Date().toISOString()))
      .rejects.toThrow(noCountReturned("countAutomationUsage"));
  });

  it("countReviewRequestsSince (daily cap; mutation: restore `count ?? 0` -> cap never fills, FAILS)", async () => {
    await expect(countReviewRequestsSince(noCount(db, "bookings"), account, SINCE))
      .rejects.toThrow(noCountReturned("countReviewRequestsSince"));
  });

  it("countNoShowNudgesSince (daily cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countNoShowNudgesSince(noCount(db, "bookings"), account, SINCE))
      .rejects.toThrow(noCountReturned("countNoShowNudgesSince"));
  });

  it("countReferralAsksSince (daily cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countReferralAsksSince(noCount(db, "bookings"), account, SINCE))
      .rejects.toThrow(noCountReturned("countReferralAsksSince"));
  });

  it("countReactivationsSince (daily cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countReactivationsSince(noCount(db, "contacts"), account, SINCE))
      .rejects.toThrow(noCountReturned("countReactivationsSince"));
  });

  it("countQuoteFollowupsSince (daily cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countQuoteFollowupsSince(noCount(db, "opportunities"), account, SINCE))
      .rejects.toThrow(noCountReturned("countQuoteFollowupsSince"));
  });

  it("countInstantRepliesSince (daily cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countInstantRepliesSince(noCount(db, "form_submissions"), account, SINCE))
      .rejects.toThrow(noCountReturned("countInstantRepliesSince"));
  });

  it("countRecentBookings (public booking rate limit; mutation: restore `count ?? 0` -> limiter open, FAILS)", async () => {
    await expect(countRecentBookings(noCount(db, "bookings"), randomUUID(), "iphash", SINCE))
      .rejects.toThrow(noCountReturned("countRecentBookings"));
  });

  it("countConciergeConversationsByIp (concierge per-IP cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countConciergeConversationsByIp(noCount(db, "concierge_conversations"), "iphash", SINCE))
      .rejects.toThrow(noCountReturned("countConciergeConversationsByIp"));
  });

  it("countConciergeConversationsForAccount (concierge per-account cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countConciergeConversationsForAccount(noCount(db, "concierge_conversations"), account, SINCE))
      .rejects.toThrow(noCountReturned("countConciergeConversationsForAccount"));
  });

  it("countContacts (contacts total; mutation: restore `count ?? 0` -> '0 contacts', FAILS)", async () => {
    await expect(countContacts(noCount(db, "contacts"), account))
      .rejects.toThrow(noCountReturned("countContacts"));
  });

  it("countRecentSubmissions (public form rate limit; mutation: restore `count ?? 0` -> limiter open, FAILS)", async () => {
    await expect(countRecentSubmissions(noCount(db, "form_submissions"), randomUUID(), "iphash", SINCE))
      .rejects.toThrow(noCountReturned("countRecentSubmissions"));
  });

  it("countFormsMissingNotify (checklist warning; mutation: restore `count ?? 0` -> warning hidden, FAILS)", async () => {
    await expect(countFormsMissingNotify(noCount(db, "forms"), account))
      .rejects.toThrow(noCountReturned("countFormsMissingNotify"));
  });

  it("countScreenedCalls (mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countScreenedCalls(noCount(db, "screened_calls"), { accountId: account }))
      .rejects.toThrow(noCountReturned("countScreenedCalls"));
  });

  it("countMisconfiguredScreenedCalls (mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countMisconfiguredScreenedCalls(noCount(db, "screened_calls"), account))
      .rejects.toThrow(noCountReturned("countMisconfiguredScreenedCalls"));
  });

  it("countTrafficDays (the unlink confirmation's number; mutation: restore `count ?? 0` -> '0 days', FAILS)", async () => {
    await expect(countTrafficDays(noCount(db, "site_traffic_daily"), account))
      .rejects.toThrow(noCountReturned("countTrafficDays"));
  });

  it("countExpiredUsage (never-billed alarm; mutation: restore `total += count ?? 0` -> 0, FAILS)", async () => {
    const billed = [{ accountId: account, stripeCustomerId: "cus_test", billingStartedAt: "2020-01-01T00:00:00.000Z" }];
    await expect(countExpiredUsage(noCount(db, "usage_events"), billed, new Date()))
      .rejects.toThrow(noCountReturned("countExpiredUsage"));
  });

  it("countWebSessionsByIp (web demo per-IP cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countWebSessionsByIp(noCount(db, "voice_web_sessions"), "iphash", SINCE))
      .rejects.toThrow(noCountReturned("countWebSessionsByIp"));
  });

  it("countWebSessionsForAccount (web demo per-account cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countWebSessionsForAccount(noCount(db, "voice_web_sessions"), account, SINCE))
      .rejects.toThrow(noCountReturned("countWebSessionsForAccount"));
  });

  it("countCallsSince (call cap, calls meter; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countCallsSince(noCount(db, "calls"), account, SINCE))
      .rejects.toThrow(noCountReturned("countCallsSince"));
  });

  it("countAnsweredCallsSince (setup test-call step; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countAnsweredCallsSince(noCount(db, "calls"), account, SINCE))
      .rejects.toThrow(noCountReturned("countAnsweredCallsSince"));
  });

  it("hasActiveCallSince (presence indicator; mutation: restore `(count ?? 0) > 0` -> false, FAILS)", async () => {
    await expect(hasActiveCallSince(noCount(db, "calls"), account, SINCE))
      .rejects.toThrow(noCountReturned("hasActiveCallSince"));
  });

  it("countCallsByCallerSince (per-number call cap; mutation: restore `count ?? 0` -> FAILS)", async () => {
    await expect(countCallsByCallerSince(noCount(db, "calls"), account, caller, SINCE))
      .rejects.toThrow(noCountReturned("countCallsByCallerSince"));
  });

  it("countCallerHistorySince (repeat-spam guard; mutation: restore the three `?? 0` -> resolves all zeros, FAILS)", async () => {
    await expect(countCallerHistorySince(noCount(db, "calls"), account, caller, SINCE))
      .rejects.toThrow(noCountReturned("countCallerHistorySince"));
  });

  it("callerInTouchSince, the calls read (held text-back gate; mutation: restore `(calls ?? 0) > 0` -> falls through to 'not in touch', FAILS)", async () => {
    await expect(callerInTouchSince(noCount(db, "calls"), account, caller, randomUUID(), SINCE))
      .rejects.toThrow(/callerInTouchSince calls read failed: no count returned/);
  });

  it("callerInTouchSince, the texts read (held text-back gate; mutation: restore `(texts ?? 0) > 0` -> resolves false and the held text SENDS, FAILS)", async () => {
    // The calls read is real here and finds none, so the texts read decides.
    await expect(callerInTouchSince(noCount(db, "messages"), account, caller, randomUUID(), SINCE))
      .rejects.toThrow(/callerInTouchSince messages read failed: no count returned/);
  });

  it("conversationQuietSince (reactivation's quiet check; mutation: restore `(count ?? 0) === 0` -> 'quiet', talks over a live thread, FAILS)", () =>
    withTestAccount(async (sdb, accountId) => {
      // A real conversation, so the read reaches the messages count rather
      // than answering "no conversation at all" first.
      const { id: ana } = await createContact(sdb, accountId, { firstName: "Ana" }, ACTOR);
      await ensureConversation(sdb, accountId, ana, ACTOR);
      await expect(conversationQuietSince(noCount(sdb, "messages"), accountId, ana, SINCE))
        .rejects.toThrow(/conversationQuietSince messages read failed: no count returned/);
    }));

  it("removePlace keeps a place that has units when the unit count comes back empty (mutation: restore `(count ?? 0) === 0` -> the service client deletes the place and cascades its unit, FAILS)", () =>
    withTestAccount(async (sdb, accountId) => {
      const { id: ana } = await createContact(sdb, accountId, { firstName: "Ana" }, ACTOR);
      const ctx = { subjectId: ana, actorId: ACTOR };
      const place = await addPlace(sdb, accountId, { contactId: ana, groupId: null }, {
        label: null, address: "1204 Nolana Ave", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null,
      }, ctx);
      await addEquipment(sdb, accountId, place.id, {
        name: "AC upstairs", make: null, model: null, serial: null, notes: null, installed_on: null, warranty_until: null,
      }, ctx);
      await expect(removePlace(noCount(sdb, "equipment"), accountId, place.id, ctx))
        .rejects.toThrow(/removePlace unit count failed: no count returned/);
      // Nothing was removed: the place is still there, not archived, and its unit with it.
      expect(await getPlace(sdb, accountId, place.id)).toMatchObject({ id: place.id, archived_at: null });
      const { count } = await sdb.from("equipment").select("id", { count: "exact", head: true }).eq("place_id", place.id);
      expect(count).toBe(1);
    }));
});
