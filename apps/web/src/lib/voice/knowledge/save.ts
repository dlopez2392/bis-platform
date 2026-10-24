// S-47c (spec 4.1, 5.7; C9, SD10): every Voice page knowledge save. Server only: the one file under knowledge/
// that imports @bis/db values, and never imported by the prompt. The caller passes the service client (the
// actions call serviceDb() behind their agency check); this file only ever names its TYPE.
import {
  getVoiceProfile, listVoiceServices, readAccountTimezone, getLatestKnowledgeVersion, saveVoiceKnowledge,
  listClosedDaysFrom,
  type KnowledgeParts, type serviceDb,
} from "@bis/db";
import { buildKnowledgePayload } from "./payload";
import { keepStoredInsurancePrices } from "./validate";
import { dayKey } from "../../business-status/status";

type Db = ReturnType<typeof serviceDb>;
export type SaveOutcome = { ok: true; version: number } | { ok: false; reason: "stale" | "no_profile" | "invalid" | "failed" };

/** Two attempts: the second only after `stale` (someone saved, or a call started on changed knowledge, in between). */
const ATTEMPTS = 2;

/**
 * Saves `parts` (only the card's own part) with a snapshot of everything she will then know. Each attempt reads
 * the stored state afresh and lays `parts` over it, so the payload's other parts are always the STORED ones and a
 * retry never writes back another card's stale copy. `baseVersion` is the latest version read in the same
 * attempt, immediately before the payload is built (SD10), never what the page loaded.
 */
export async function saveKnowledgeParts(db: Db, accountId: string, actor: string, parts: KnowledgeParts): Promise<SaveOutcome> {
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const [profile, rows, timezone, baseVersion] = await Promise.all([
        getVoiceProfile(db, accountId), listVoiceServices(db, accountId),
        readAccountTimezone(db, accountId), getLatestKnowledgeVersion(db, accountId),
      ]);
      if (!profile || !timezone) return { ok: false, reason: "no_profile" };
      // S-47d: read fresh every attempt, same as the other four — a stale `closed_days` recorded here is a
      // snapshot the NEXT call would contradict, so a failed read FAILS the save (the outer catch below)
      // rather than recording one with none planned.
      const today = dayKey(new Date(), timezone);
      const closedDays = await listClosedDaysFrom(db, accountId, today);
      // C13, C21: on insurance a services part keeps a price only on an unchanged row of the list read in THIS
      // attempt; every other priced row is saved as after_visit. Built from the caller's `parts` every attempt.
      const sent: KnowledgeParts = parts.services && profile.trade_module === "insurance_pc"
        ? { ...parts, services: keepStoredInsurancePrices(parts.services, rows) }
        : parts;
      const payload = buildKnowledgePayload({
        facts: sent.facts ?? profile.facts,
        servicesText: sent.services_text ?? profile.services,
        timezone,
        businessHours: "business_hours" in sent ? sent.business_hours : profile.business_hours,
        services: sent.services ?? rows,
        closedDays, today,
      });
      const r = await saveVoiceKnowledge(db, accountId, { actor, parts: sent, payload, baseVersion });
      if (r.status === "ok") return { ok: true, version: r.version };
      if (r.status !== "stale") return { ok: false, reason: r.status };
    }
    return { ok: false, reason: "stale" };
  } catch (e) {
    // Ids and the failing step only: an error message can carry a fact, a price or a name.
    const step = e instanceof Error ? e.message.split(":")[0]!.slice(0, 60) : "unknown";
    console.error(`saveKnowledgeParts: failed for account ${accountId} at ${step}`);
    return { ok: false, reason: "failed" };
  }
}
