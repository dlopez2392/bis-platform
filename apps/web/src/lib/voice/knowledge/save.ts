// S-47c (spec 4.1, 5.7; C9, SD10): every Voice page knowledge save. Server only: the one file under knowledge/
// that imports @bis/db values, and never imported by the prompt. The caller passes the service client (the
// actions call serviceDb() behind their agency check); this file only ever names its TYPE.
import {
  getVoiceProfile, listVoiceServices, readAccountTimezone, getLatestKnowledgeVersion, saveVoiceKnowledge,
  type KnowledgeParts, type serviceDb,
} from "@bis/db";
import { buildKnowledgePayload } from "./payload";
import { insurancePricesKept } from "./validate";

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
      // C13: on insurance a services part may carry only prices already on the list read in THIS attempt.
      if (parts.services && profile.trade_module === "insurance_pc" && !insurancePricesKept(parts.services, rows)) {
        return { ok: false, reason: "invalid" };
      }
      const payload = buildKnowledgePayload({
        facts: parts.facts ?? profile.facts,
        servicesText: parts.services_text ?? profile.services,
        timezone,
        businessHours: "business_hours" in parts ? parts.business_hours : profile.business_hours,
        services: parts.services ?? rows,
      });
      const r = await saveVoiceKnowledge(db, accountId, { actor, parts, payload, baseVersion });
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
