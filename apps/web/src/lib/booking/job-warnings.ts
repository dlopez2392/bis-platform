import { closedOut, fitsOpenHours, type SlotConfig } from "./slots";

/** F-046 (spec 5.4, 6.1): what a staff job breaks. Staff may break every rule but the past (R3); the page
 *  shows each warning once and saves only when nothing new appeared. No buffer: the buffer is a customer rule. */
export type LiveRange = { id: string; startsAt: Date; endsAt: Date };
export type JobWarning =
  | { kind: "outside_hours" } | { kind: "notice" } | { kind: "closed" }
  | { kind: "overlaps"; ids: string[]; firstStart: Date };
export type JobCheck = { refused: "past" | "invalid" | null; warnings: JobWarning[] };

export function jobWarnings(i: {
  config: SlotConfig; liveRanges: readonly LiveRange[]; now: Date;
  range: { startsAt: Date; endsAt: Date }; excludeId?: string | null;
}): JobCheck {
  const s = i.range.startsAt.getTime();
  const e = i.range.endsAt.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return { refused: "invalid", warnings: [] };
  if (s < i.now.getTime()) return { refused: "past", warnings: [] };
  const warnings: JobWarning[] = [];
  if (!fitsOpenHours(i.config.openHours, i.range.startsAt, i.range.endsAt, i.config.timezone)) warnings.push({ kind: "outside_hours" });
  // Fails closed: a NaN notice reads as "inside notice".
  if (!(s >= i.now.getTime() + i.config.minNoticeHours * 3_600_000)) warnings.push({ kind: "notice" });
  // Running late is not "closed" (plan correction 8).
  if (i.config.closures && closedOut(i.range.startsAt, { ...i.config.closures, lateBefore: null }, i.config.timezone)) {
    warnings.push({ kind: "closed" });
  }
  // [) bounds, as bookings_no_overlap: back-to-back is no overlap. An unreadable range fails CLOSED (it overlaps).
  const hits = i.liveRanges
    .filter((r) => r.id !== i.excludeId)
    .filter((r) => {
      const rs = r.startsAt.getTime();
      const re = r.endsAt.getTime();
      return !Number.isFinite(rs) || !Number.isFinite(re) || (rs < e && s < re);
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (hits.length > 0) warnings.push({ kind: "overlaps", ids: hits.map((h) => h.id).sort(), firstStart: hits[0]!.startsAt });
  return { refused: null, warnings };
}

/** The identity of a warning the page has shown: an overlap's names its job ids, so a job someone else added
 *  in between is a NEW warning, never one already accepted. */
export function warningKey(w: JobWarning): string {
  return w.kind === "overlaps" ? `overlaps:${[...w.ids].sort().join(",")}` : w.kind;
}

export function unseenWarnings(warnings: readonly JobWarning[], seen: readonly string[]): JobWarning[] {
  const known = new Set(seen);
  return warnings.filter((w) => !known.has(warningKey(w)));
}
