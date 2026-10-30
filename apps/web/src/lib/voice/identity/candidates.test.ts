import { describe, it, expect, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ listContactsOnNumber: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { realCandidates, isShared, readCandidates } from "./candidates";
import type { NumberContactRow } from "@bis/db";

const E164 = "+19562921696";

function row(over: Partial<NumberContactRow>): NumberContactRow {
  return {
    id: "id", first_name: "Ana", last_name: "Prueba", phone: E164, email_key: null,
    holds_shared_number: false, ...over,
  };
}

describe("realCandidates", () => {
  it("keeps the caller-ID contacts, drops the holding record, a different-country twin and a blank phone", () => {
    const rows: NumberContactRow[] = [
      row({ id: "e164", phone: "+19562921696" }),                 // in: exact E.164
      row({ id: "legacy", phone: "(956) 292-1696" }),              // in: legacy US format, same number
      row({ id: "holding", holds_shared_number: true, phone: "+19562921696", first_name: "Caller", last_name: null }), // out: holding record
      row({ id: "mx-twin", phone: "+529562921696" }),              // out: same ten digits, Mexican reading
      row({ id: "no-phone", phone: null }),                        // out: no phone
    ];
    const out = realCandidates(rows, E164);
    expect(out.map((c) => c.id)).toEqual(["e164", "legacy"]);
  });
});

describe("isShared", () => {
  it("one real contact -> false", () => {
    expect(isShared({ candidates: [{ id: "a", words: ["a"], emailKey: null }], truncated: false })).toBe(false);
  });

  it("0106 (owner ruling D8): a kept record and its own tombstone on one number read as ONE person, not shared; two UNRESOLVED rows naming the same number (the control listContactsOnNumber must never hand realCandidates) would", () => {
    const resolved: NumberContactRow[] = [row({ id: "K", phone: E164 })];
    expect(isShared({ candidates: realCandidates(resolved, E164), truncated: false })).toBe(false);

    const unresolved: NumberContactRow[] = [row({ id: "K", phone: E164 }), row({ id: "T", phone: E164 })];
    expect(isShared({ candidates: realCandidates(unresolved, E164), truncated: false })).toBe(true);
  });
  it("two real contacts -> true", () => {
    expect(isShared({
      candidates: [{ id: "a", words: ["a"], emailKey: null }, { id: "b", words: ["b"], emailKey: null }],
      truncated: false,
    })).toBe(true);
  });
  it("one real contact but truncated -> true", () => {
    expect(isShared({ candidates: [{ id: "a", words: ["a"], emailKey: null }], truncated: true })).toBe(true);
  });
});

describe("readCandidates", () => {
  it("passes its OWN accountId and e164 through to listContactsOnNumber (mutation: a fixed id -> FAILS)", async () => {
    dbMocks.listContactsOnNumber.mockReset();
    dbMocks.listContactsOnNumber.mockResolvedValue({
      rows: [row({ id: "e164", phone: E164 })], truncated: false,
    });
    const db = {} as never;
    const out = await readCandidates(db, "a2", E164);
    expect(dbMocks.listContactsOnNumber).toHaveBeenCalledWith(db, "a2", E164);
    expect(out.candidates.map((c) => c.id)).toEqual(["e164"]);
    expect(out.truncated).toBe(false);
  });
});
