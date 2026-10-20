// `withTestAccount` yields `serviceDb()`, which bypasses RLS and every grant: nothing in this file
// touches either. Who may read and write `proposals` (the member read, the Technician fence, no client
// write grant) is proved in `proposals-schema.test.ts`, which runs as `authenticated` through
// `withRollback` + `actAs`. This file is the accessors' contract: the account filter, the
// compare-and-swaps, the read boundary and the never-throws insert (item 8b-1, plan Task 4; carried
// over from the deleted call-proposals.test.ts, every case kept and retargeted).
import { describe, it, expect, vi } from "vitest";
import type { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { withRollback, actAsMember } from "./db";
import {
  insertProposal, listProposalsForCall, listPendingProposals, getProposal, listPendingProposalsForAgency,
  listPendingProposalsForContact,
  listPendingSiblings, decideProposal, revertProposalDecision, setAppliedRef, expireProposals,
  undoProposalDecision, expireAfterUndoCollision, restoreSiblings,
} from "../proposals";
import { effectiveStatus, type EvidenceRef } from "../proposal-rules";
import { listAccountWork, listAgencyWork } from "../work-queue";
import { addTask, deleteTaskForUndo } from "../activities";
import { fillContactBlanks, fillContactBlanksReport } from "../contacts";

/** Far enough ahead that no read in this file sees it as aged; typed out, never computed. */
const FUTURE = "2031-03-04T05:06:07.000Z";
const NOW = new Date("2026-10-19T10:00:00.000Z");
const T = "2026-10-19T10:00:00.000Z";
const T_PLUS_1MS = "2026-10-19T10:00:00.001Z";
const NO_REF: EvidenceRef = {};

/** The account's one active number (phone_numbers_one_active_per_account), made on first use. */
const numberOf = new Map<string, string>();
async function seedCall(db: SupabaseClient, accountId: string): Promise<string> {
  if (!numberOf.has(accountId)) {
    const num = await db.from("phone_numbers")
      .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
    expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();
    numberOf.set(accountId, num.data!.id as string);
  }
  const call = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: numberOf.get(accountId)!, caller_e164: "+19562921696" })
    .select("id").single();
  expect(call.error, `calls insert failed: ${call.error?.message}`).toBeNull();
  return call.data!.id as string;
}

async function seedContact(db: SupabaseClient, accountId: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: "Sam", last_name: "Rivera", ...over }).select("id").single();
  expect(error, `contacts insert failed: ${error?.message}`).toBeNull();
  return data!.id as string;
}

/** One pending task suggestion; returns its id (the insert must land). */
async function taskOn(
  db: SupabaseClient, accountId: string, callId: string,
  o: { contactId?: string | null; title?: string; evidence?: string; expiresAt?: string } = {},
): Promise<string> {
  const created = await insertProposal(db, accountId, {
    callId, contactId: o.contactId ?? null, kind: "task", evidence: o.evidence ?? "call me Tuesday",
    evidenceRef: NO_REF, evidenceLang: "en", expiresAt: o.expiresAt ?? FUTURE,
    payload: { title: o.title ?? "Call back Tuesday", dueAt: null },
  });
  expect(created, "insertProposal returned null").not.toBeNull();
  return created!.id;
}

async function raw(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("proposals").select("*").eq("id", id).maybeSingle();
  expect(error, `proposals read failed: ${error?.message}`).toBeNull();
  return data as Record<string, unknown> | null;
}

/** Accepted by `by` (through the function under test elsewhere; here only to set a row up). */
async function acceptAs(db: SupabaseClient, accountId: string, id: string, by: string) {
  const row = await getProposal(db, accountId, id);
  expect(await decideProposal(db, accountId, id, { to: "accepted", decidedBy: by, appliedPayload: row!.payload, now: NOW })).toBe(true);
}

describe("proposals accessors", () => {
  it("round-trips a task proposal", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      await taskOn(db, accountId, callId);
      const rows = await listProposalsForCall(db, accountId, callId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe("task");
      expect(rows[0]!.status).toBe("pending");
      expect(rows[0]!.evidence).toBe("call me Tuesday");
    });
  });

  it("insertProposal stores source, evidence_ref, evidence_lang and the given expires_at; a row read back has every field (mutation: drop expires_at from the insert -> null and an UNEXPECTED fault 23502, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const contactId = await seedContact(db, accountId);
      const created = await insertProposal(db, accountId, {
        callId, contactId, kind: "contact_field", evidence: "My email is sam at example dot com.",
        evidenceRef: { turn: 3, at: "2026-10-19T09:58:00.000Z" }, evidenceLang: "es",
        expiresAt: "2026-11-18T10:00:00.000Z",
        payload: { field: "email", value: "sam@example.com" },
      });
      expect(created).not.toBeNull();
      const back = await getProposal(db, accountId, created!.id);
      expect(back).toEqual({
        id: created!.id, accountId, source: "call", callId, contactId,
        kind: "contact_field", payload: { field: "email", value: "sam@example.com" },
        evidence: "My email is sam at example dot com.",
        evidenceRef: { turn: 3, at: "2026-10-19T09:58:00.000Z" }, evidenceLang: "es",
        status: "pending", expiredReason: null, appliedPayload: null, appliedRef: null,
        decidedAt: null, decidedBy: null, undoneAt: null, undoneBy: null,
        expiresAt: "2026-11-18T10:00:00+00:00",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });
  });

  it("refuses a SECOND pending proposal of the same kind on the same call, INCLUDING when contact_id is null (mutation: drop the coalesce from the unique index -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      await taskOn(db, accountId, callId);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const second = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "call me Tuesday", evidenceRef: NO_REF, evidenceLang: "en", expiresAt: FUTURE,
          payload: { title: "Call back Tuesday again", dueAt: null },
        });
        // Swallowed as null, not thrown: a duplicate is a non-event for a
        // best-effort pass, never a reason to fail a call's finish.
        expect(second).toBeNull();
      } finally {
        spy.mockRestore();
      }
      expect(await listProposalsForCall(db, accountId, callId)).toHaveLength(1);
    });
  });

  it("allows a new pending proposal once the previous one is decided", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const first = await taskOn(db, accountId, callId);
      expect(await decideProposal(db, accountId, first, { to: "dismissed", decidedBy: "user_x", now: NOW })).toBe(true);
      const second = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Wednesday", evidenceRef: NO_REF, evidenceLang: "en", expiresAt: FUTURE,
        payload: { title: "Call back Wednesday", dueAt: null },
      });
      expect(second).not.toBeNull();
    });
  });

  // A SANCTIONED REFUSAL (the evidence CHECK) reaches the "refused" line and stays OFF the fault line;
  // the case below proves the converse for a real fault.
  it("rejects an empty evidence string and logs it as a REFUSAL, not a fault (mutation: drop proposals_evidence_nonempty -> FAILS; mutation: route 23514 to the fault branch -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const callId = await seedCall(db, accountId);
        const created = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "   ", evidenceRef: NO_REF, evidenceLang: "en", expiresAt: FUTURE,
          payload: { title: "Ungrounded", dueAt: null },
        });
        expect(created).toBeNull();
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.some((m) => m.includes("refused"))).toBe(true);
        expect(messages.some((m) => m.includes("unexpected fault"))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("decideProposal stamps status, decided_at and decided_by, and returns false for an unknown id", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await taskOn(db, accountId, callId);
      await acceptAs(db, accountId, p, "user_abc");
      const after = await getProposal(db, accountId, p);
      expect(after!.status).toBe("accepted");
      expect(after!.decidedBy).toBe("user_abc");
      expect(after!.decidedAt).toBe("2026-10-19T10:00:00+00:00");
      expect(await listPendingProposals(db, accountId)).toHaveLength(0);
      expect(await decideProposal(db, accountId, "00000000-0000-0000-0000-000000000001",
        { to: "dismissed", decidedBy: "user_abc", now: NOW })).toBe(false);
    });
  });

  // Plan Task 4 case 4. With `.eq("status", "pending")` dropped, the second decide overwrites the row
  // instead of matching nothing: `second` is true and decidedBy reads "user_second".
  it("decideProposal is a compare-and-swap: a second decide by a DIFFERENT user is refused and decidedBy stays the FIRST user's; accepted and edited carry applied_payload; an edited equal to the proposal is the CHECK's refusal, thrown by name (mutation: drop .eq(\"status\", \"pending\") -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const p = await taskOn(db, accountId, await seedCall(db, accountId));
      expect(await decideProposal(db, accountId, p,
        { to: "accepted", decidedBy: "user_first", appliedPayload: { title: "Call back Tuesday", dueAt: null }, now: NOW })).toBe(true);
      const second = await decideProposal(db, accountId, p,
        { to: "accepted", decidedBy: "user_second", appliedPayload: { title: "Call back Tuesday", dueAt: null }, now: NOW });
      expect(second).toBe(false);
      const after = await getProposal(db, accountId, p);
      expect(after!.decidedBy).toBe("user_first");
      expect(after!.status).toBe("accepted");
      expect(after!.appliedPayload).toEqual({ title: "Call back Tuesday", dueAt: null });

      const e = await taskOn(db, accountId, await seedCall(db, accountId));
      expect(await decideProposal(db, accountId, e,
        { to: "edited", decidedBy: "user_first", appliedPayload: { title: "Call back Wednesday", dueAt: null }, now: NOW })).toBe(true);
      expect(await raw(db, e)).toMatchObject({
        status: "edited", decided_by: "user_first", applied_payload: { title: "Call back Wednesday", dueAt: null },
      });

      const same = await taskOn(db, accountId, await seedCall(db, accountId));
      await expect(decideProposal(db, accountId, same,
        { to: "edited", decidedBy: "user_first", appliedPayload: { title: "Call back Tuesday", dueAt: null }, now: NOW }))
        .rejects.toThrow(/proposals_edited_changes/);
      expect((await raw(db, same))!.status).toBe("pending");
    });
  });

  it("decideProposal to expired writes decided_by 'system' and the reason (mutation: write decided_by null -> 23514, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const p = await taskOn(db, accountId, await seedCall(db, accountId));
      expect(await decideProposal(db, accountId, p, { to: "expired", reason: "field_filled", now: NOW })).toBe(true);
      expect(await raw(db, p)).toMatchObject({
        status: "expired", expired_reason: "field_filled", decided_by: "system",
        decided_at: "2026-10-19T10:00:00+00:00", applied_payload: null,
      });
    });
  });

  it("dismissed writes no applied_payload", async () => {
    await withTestAccount(async (db, accountId) => {
      const p = await taskOn(db, accountId, await seedCall(db, accountId));
      expect(await decideProposal(db, accountId, p, { to: "dismissed", decidedBy: "user_x", now: NOW })).toBe(true);
      expect(await raw(db, p)).toMatchObject({ status: "dismissed", decided_by: "user_x", applied_payload: null });
    });
  });

  // `listPendingProposals` is otherwise only ever asserted AFTER a decide, where the table is
  // legitimately empty: a stub `return []` would pass that. Hard-coding it fails `toHaveLength(1)`.
  it("listPendingProposals returns the pending proposal before it is decided, and none after", async () => {
    await withTestAccount(async (db, accountId) => {
      const p = await taskOn(db, accountId, await seedCall(db, accountId));
      const before = await listPendingProposals(db, accountId);
      expect(before).toHaveLength(1);
      expect(before[0]!.id).toBe(p);
      expect(before[0]!.status).toBe("pending");
      await acceptAs(db, accountId, p, "user_x");
      expect(await listPendingProposals(db, accountId)).toHaveLength(0);
    });
  });

  it("listPendingProposals leaves out a row past expires_at, and stops at 201 (mutation: drop .gt(\"expires_at\", now) -> the expired row appears, FAILS; .limit(500) -> 202, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      expect(num.error).toBeNull();
      const calls = await db.from("calls")
        .insert(Array.from({ length: 203 }, () => ({ account_id: accountId, phone_number_id: num.data!.id, caller_e164: "+19562921696" })))
        .select("id");
      expect(calls.error).toBeNull();
      const callIds = (calls.data ?? []).map((c) => c.id as string);
      expect(callIds).toHaveLength(203);
      const base = Date.parse("2026-10-01T00:00:00.000Z");
      // The expired row is the NEWEST, so only the expires_at filter (never the cap) keeps it out.
      const rows = callIds.map((callId, i) => ({
        account_id: accountId, source: "call", call_id: callId, kind: "task",
        payload: { title: `Call ${i}`, dueAt: null }, evidence: "call me Tuesday",
        expires_at: i === 202 ? "2026-10-02T00:00:00.000Z" : FUTURE,
        created_at: new Date(base + i * 1000).toISOString(),
      }));
      const ins = await db.from("proposals").insert(rows).select("id, call_id");
      expect(ins.error, ins.error?.message).toBeNull();
      const expiredId = (ins.data ?? []).find((r) => r.call_id === callIds[202])!.id as string;
      const pending = await listPendingProposals(db, accountId, NOW);
      expect(pending).toHaveLength(201);
      expect(pending.map((p) => p.id)).not.toContain(expiredId);
    });
  });

  it("parse at the read boundary: a row whose payload does not fit its kind is skipped and logged by id, never returned (mutation: return the row unparsed -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const good = await taskOn(db, accountId, callId);
      // A task row carrying a contact field's payload (its own customer, so the one-pending index lets it in).
      const bad = await db.from("proposals").insert({
        account_id: accountId, source: "call", call_id: callId, contact_id: await seedContact(db, accountId), kind: "task",
        payload: { field: "phone", value: "SECRET-PAYLOAD-TEXT" }, evidence: "call me Tuesday", expires_at: FUTURE,
      }).select("id").single();
      expect(bad.error, bad.error?.message).toBeNull();
      const badId = bad.data!.id as string;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const rows = await listProposalsForCall(db, accountId, callId);
        expect(rows.map((r) => r.id)).toEqual([good]);
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.some((m) => m.includes(badId))).toBe(true);
        expect(messages.some((m) => m.includes("SECRET-PAYLOAD-TEXT"))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // A due date that is a string but not a date ("next week") fits the shape and would reach a screen as an
  // Invalid Date, where formatting it throws a RangeError and takes the whole section down (final review
  // M-1). The read boundary refuses it like any other row that does not fit, by id and never the payload.
  it("parse at the read boundary: a to-do whose dueAt is not a date is skipped and logged by id (mutation: drop parseTaskPayload's Date.parse check -> the row is returned -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const good = await taskOn(db, accountId, callId);
      const bad = await db.from("proposals").insert({
        account_id: accountId, source: "call", call_id: callId, contact_id: await seedContact(db, accountId), kind: "task",
        payload: { title: "SECRET-TITLE-TEXT", dueAt: "next week" }, evidence: "call me next week", expires_at: FUTURE,
      }).select("id").single();
      expect(bad.error, bad.error?.message).toBeNull();
      const badId = bad.data!.id as string;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect((await listProposalsForCall(db, accountId, callId)).map((r) => r.id)).toEqual([good]);
        expect((await listPendingProposals(db, accountId)).map((r) => r.id)).toEqual([good]);
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.filter((m) => m.includes(badId))).toHaveLength(2);
        expect(messages.some((m) => m.includes("SECRET-TITLE-TEXT") || m.includes("next week"))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("round-trips each kind with its own payload shape", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const common = { callId, evidenceRef: NO_REF, evidenceLang: "en" as const, expiresAt: FUTURE };
      expect(await insertProposal(db, accountId, {
        ...common, kind: "task", evidence: "the caller asked to be called back Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      })).not.toBeNull();
      expect(await insertProposal(db, accountId, {
        ...common, kind: "contact_field", evidence: "the caller spelled her email out loud",
        payload: { field: "email", value: "dan@example.com" },
      })).not.toBeNull();
      expect(await insertProposal(db, accountId, {
        ...common, kind: "opportunity_stage", evidence: "the caller agreed to move forward",
        payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      })).not.toBeNull();

      const rows = await listProposalsForCall(db, accountId, callId);
      const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
      expect(byKind.task!.payload).toEqual({ title: "Call back Tuesday", dueAt: null });
      expect(byKind.contact_field!.payload).toEqual({ field: "email", value: "dan@example.com" });
      expect(byKind.opportunity_stage!.payload).toEqual({
        opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2",
      });
      const proposal = byKind.contact_field!;
      if (proposal.kind === "contact_field") {
        expect(proposal.payload.field).toBe("email");
      } else {
        throw new Error("expected the contact_field row to narrow to contact_field");
      }
    });
  });

  // A foreign key violation (23503, an unknown call_id) is neither sanctioned refusal, so it must land
  // on the "unexpected fault" branch, named by code.
  it("insertProposal logs an UNEXPECTED fault differently from a sanctioned refusal (mutation: collapse the two branches back into one -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await insertProposal(db, accountId, {
          callId: "00000000-0000-0000-0000-0000000000fe", kind: "task", evidence: "call me Tuesday",
          evidenceRef: NO_REF, evidenceLang: "en", expiresAt: FUTURE,
          payload: { title: "Call back Tuesday", dueAt: null },
        });
        expect(result).toBeNull();
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.some((m) => m.includes("unexpected fault"))).toBe(true);
        expect(messages.some((m) => m.includes("23503"))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("listPendingSiblings reads the contact's other pending rows of the kind, never the excepted one, never an aged one", async () => {
    await withTestAccount(async (db, accountId) => {
      const contactId = await seedContact(db, accountId);
      const other = await seedContact(db, accountId, { first_name: "Ana" });
      const self = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      const sib = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      await taskOn(db, accountId, await seedCall(db, accountId), { contactId, expiresAt: "2026-10-02T00:00:00.000Z" });
      await taskOn(db, accountId, await seedCall(db, accountId), { contactId: other });
      const decided = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      expect(await decideProposal(db, accountId, decided, { to: "dismissed", decidedBy: "u", now: NOW })).toBe(true);
      const rows = await listPendingSiblings(db, accountId, { kind: "task", contactId, exceptId: self });
      expect(rows.map((r) => r.id)).toEqual([sib]);
      expect(await listPendingSiblings(db, accountId, { kind: "contact_field", contactId, exceptId: self })).toEqual([]);
    });
  });

  it("revertProposalDecision reverts accepted AND edited, clearing applied_payload and applied_ref; 'missed' when another decider holds it; 'collision' on the one-pending index (mutation: .eq(\"status\",\"accepted\") only -> the edited case FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const a = await taskOn(db, accountId, await seedCall(db, accountId));
        await acceptAs(db, accountId, a, "user_a");
        expect(await setAppliedRef(db, accountId, a, { taskId: "t1" })).toBe(true);
        expect(await revertProposalDecision(db, accountId, a, "user_a")).toBe("reverted");
        expect(await raw(db, a)).toMatchObject({
          status: "pending", decided_at: null, decided_by: null, applied_payload: null, applied_ref: null,
        });

        const e = await taskOn(db, accountId, await seedCall(db, accountId));
        expect(await decideProposal(db, accountId, e,
          { to: "edited", decidedBy: "user_a", appliedPayload: { title: "Edited", dueAt: null }, now: NOW })).toBe(true);
        expect(await setAppliedRef(db, accountId, e, { taskId: "t2" })).toBe(true);
        expect(await revertProposalDecision(db, accountId, e, "user_a")).toBe("reverted");
        expect(await raw(db, e)).toMatchObject({ status: "pending", applied_payload: null, applied_ref: null });

        const m = await taskOn(db, accountId, await seedCall(db, accountId));
        await acceptAs(db, accountId, m, "user_a");
        expect(await revertProposalDecision(db, accountId, m, "user_b")).toBe("missed");
        expect((await raw(db, m))!.status).toBe("accepted");

        const callC = await seedCall(db, accountId);
        const c = await taskOn(db, accountId, callC);
        await acceptAs(db, accountId, c, "user_a");
        await taskOn(db, accountId, callC, { title: "A fresh one" });
        expect(await revertProposalDecision(db, accountId, c, "user_a")).toBe("collision");
        expect((await raw(db, c))!.status).toBe("accepted");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("undoProposalDecision returns the row to pending, clears decided_*, applied_*, expired_reason, stamps undone_*; only for the decider; 'collision' on the one-pending index (mutation: drop .eq(\"decided_by\", u.decidedBy) -> the other-person case FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const a = await taskOn(db, accountId, await seedCall(db, accountId));
        await acceptAs(db, accountId, a, "user_a");
        expect(await setAppliedRef(db, accountId, a, { taskId: "t1" })).toBe(true);

        expect(await undoProposalDecision(db, accountId, a, { decidedBy: "user_b", from: ["accepted", "edited"], now: NOW })).toBe("missed");
        expect(await raw(db, a)).toMatchObject({ status: "accepted", decided_by: "user_a", undone_at: null });

        expect(await undoProposalDecision(db, accountId, a, { decidedBy: "user_a", from: ["accepted", "edited"], now: NOW })).toBe("undone");
        expect(await raw(db, a)).toMatchObject({
          status: "pending", decided_at: null, decided_by: null, applied_payload: null, applied_ref: null,
          expired_reason: null, undone_at: "2026-10-19T10:00:00+00:00", undone_by: "user_a",
        });

        const x = await taskOn(db, accountId, await seedCall(db, accountId));
        expect(await decideProposal(db, accountId, x, { to: "expired", reason: "superseded", now: NOW })).toBe(true);
        expect(await undoProposalDecision(db, accountId, x, { decidedBy: "system", from: ["expired"], now: NOW })).toBe("undone");
        expect(await raw(db, x)).toMatchObject({ status: "pending", expired_reason: null, decided_by: null });

        const callC = await seedCall(db, accountId);
        const c = await taskOn(db, accountId, callC);
        await acceptAs(db, accountId, c, "user_a");
        await taskOn(db, accountId, callC, { title: "A fresh one" });
        expect(await undoProposalDecision(db, accountId, c, { decidedBy: "user_a", from: ["accepted"], now: NOW })).toBe("collision");
        expect((await raw(db, c))!.status).toBe("accepted");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("expireAfterUndoCollision moves the decider's Accept to expired/superseded, clears applied_*; another decider's row stays", async () => {
    await withTestAccount(async (db, accountId) => {
      const a = await taskOn(db, accountId, await seedCall(db, accountId));
      await acceptAs(db, accountId, a, "user_a");
      expect(await setAppliedRef(db, accountId, a, { taskId: "t1" })).toBe(true);
      expect(await expireAfterUndoCollision(db, accountId, a, "user_b", NOW)).toBe(false);
      expect((await raw(db, a))!.status).toBe("accepted");
      expect(await expireAfterUndoCollision(db, accountId, a, "user_a", NOW)).toBe(true);
      expect(await raw(db, a)).toMatchObject({
        status: "expired", expired_reason: "superseded", decided_by: "system",
        decided_at: "2026-10-19T10:00:00+00:00", applied_payload: null, applied_ref: null,
      });
    });
  });

  it("expireProposals moves only pending ids and answers the ids it moved, stamped with the given decided_at (mutation: drop .eq(\"status\",\"pending\") -> answers three, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const p1 = await taskOn(db, accountId, await seedCall(db, accountId));
      const p2 = await taskOn(db, accountId, await seedCall(db, accountId));
      const d = await taskOn(db, accountId, await seedCall(db, accountId));
      expect(await decideProposal(db, accountId, d, { to: "dismissed", decidedBy: "user_x", now: NOW })).toBe(true);
      const moved = await expireProposals(db, accountId, [p1, p2, d], "superseded", T);
      expect([...moved].sort()).toEqual([p1, p2].sort());
      expect(await raw(db, p1)).toMatchObject({
        status: "expired", expired_reason: "superseded", decided_by: "system", decided_at: "2026-10-19T10:00:00+00:00",
      });
      expect(await raw(db, d)).toMatchObject({ status: "dismissed", decided_by: "user_x" });
      expect(await expireProposals(db, accountId, [], "superseded", T)).toEqual([]);
    });
  });

  it("restoreSiblings gives back siblings superseded at exactly this decided_at; a sibling expired at another instant, or since restored and re-decided, stays; a sibling whose call has a new pending row stays expired and is reported collided (mutation: drop .eq(\"decided_at\", decidedAt) -> S2 is restored, FAILS; treat 23505 as thrown -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const contactId = await seedContact(db, accountId);
      const s1 = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      const s2 = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      const call3 = await seedCall(db, accountId);
      const s3 = await taskOn(db, accountId, call3, { contactId });
      const s4 = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      expect((await expireProposals(db, accountId, [s1, s3, s4], "superseded", T)).sort()).toEqual([s1, s3, s4].sort());
      expect(await expireProposals(db, accountId, [s2], "superseded", T_PLUS_1MS)).toEqual([s2]);
      // S4: restored once, then dismissed by a person: no longer the Accept's to give back.
      expect(await restoreSiblings(db, accountId, [s4], T)).toEqual({ restored: [s4], collided: [] });
      expect(await decideProposal(db, accountId, s4, { to: "dismissed", decidedBy: "user_x", now: NOW })).toBe(true);
      // S3's call meets a re-delivered webhook: a new pending row for the same call, kind and customer.
      await taskOn(db, accountId, call3, { contactId, title: "A fresh one" });

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await restoreSiblings(db, accountId, [s1, s2, s3, s4], T)).toEqual({ restored: [s1], collided: [s3] });
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.some((m) => m.includes(s3))).toBe(true);
      } finally {
        spy.mockRestore();
      }
      expect(await raw(db, s1)).toMatchObject({ status: "pending", decided_at: null, decided_by: null, expired_reason: null });
      expect(await raw(db, s2)).toMatchObject({ status: "expired", expired_reason: "superseded" });
      expect(await raw(db, s3)).toMatchObject({ status: "expired", expired_reason: "superseded" });
      expect(await raw(db, s4)).toMatchObject({ status: "dismissed", decided_by: "user_x" });
    });
  });

  it("setAppliedRef writes applied_ref and answers whether it matched", async () => {
    await withTestAccount(async (db, accountId) => {
      const a = await taskOn(db, accountId, await seedCall(db, accountId));
      await acceptAs(db, accountId, a, "user_a");
      expect(await setAppliedRef(db, accountId, a, { taskId: "t9" })).toBe(true);
      expect((await raw(db, a))!.applied_ref).toEqual({ taskId: "t9" });
      expect(await setAppliedRef(db, accountId, "00000000-0000-0000-0000-000000000002", { taskId: "t9" })).toBe(false);
    });
  });

  it("setAppliedRef writes only on an accepted or edited row: pending and dismissed answer false and keep applied_ref null (mutation: drop .in(\"status\", [\"accepted\",\"edited\"]) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const pending = await taskOn(db, accountId, await seedCall(db, accountId));
      const dismissed = await taskOn(db, accountId, await seedCall(db, accountId));
      expect(await decideProposal(db, accountId, dismissed, { to: "dismissed", decidedBy: "user_a", now: NOW })).toBe(true);
      expect(await setAppliedRef(db, accountId, pending, { taskId: "t1" })).toBe(false);
      expect(await setAppliedRef(db, accountId, dismissed, { taskId: "t1" })).toBe(false);
      expect((await raw(db, pending))!.applied_ref).toBeNull();
      expect((await raw(db, dismissed))!.applied_ref).toBeNull();
    });
  });

  it("listPendingSiblings reads against the injected now (mutation: ignore it and read the clock -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const contactId = await seedContact(db, accountId);
      const self = await taskOn(db, accountId, await seedCall(db, accountId), { contactId });
      const sib = await taskOn(db, accountId, await seedCall(db, accountId), { contactId, expiresAt: "2030-01-01T00:00:00.000Z" });
      const q = { kind: "task" as const, contactId, exceptId: self };
      expect((await listPendingSiblings(db, accountId, q, new Date("2029-12-31T23:59:59.000Z"))).map((r) => r.id)).toEqual([sib]);
      expect(await listPendingSiblings(db, accountId, q, new Date("2030-06-01T00:00:00.000Z"))).toEqual([]);
    });
  });
});

/**
 * Task 4 fix round (I2): the status half of each Undo-side compare-and-swap. The row is THIS same
 * decider's, but dismissed: only the status condition stands between it and the write.
 */
describe("the status condition of the Undo-side writes (a row this decider dismissed)", () => {
  async function dismissedBy(db: SupabaseClient, accountId: string, by: string) {
    const id = await taskOn(db, accountId, await seedCall(db, accountId));
    expect(await decideProposal(db, accountId, id, { to: "dismissed", decidedBy: by, now: NOW })).toBe(true);
    return id;
  }

  it("revertProposalDecision answers missed and the row stays dismissed (mutation: drop .in(\"status\", [\"accepted\",\"edited\"]) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const id = await dismissedBy(db, accountId, "user_a");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await revertProposalDecision(db, accountId, id, "user_a")).toBe("missed");
      } finally {
        spy.mockRestore();
      }
      expect(await raw(db, id)).toMatchObject({ status: "dismissed", decided_by: "user_a" });
    });
  });

  it("undoProposalDecision with from [accepted, edited] answers missed and the row stays dismissed (mutation: drop .in(\"status\", u.from) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const id = await dismissedBy(db, accountId, "user_a");
      expect(await undoProposalDecision(db, accountId, id, { decidedBy: "user_a", from: ["accepted", "edited"], now: NOW })).toBe("missed");
      expect(await raw(db, id)).toMatchObject({ status: "dismissed", decided_by: "user_a", undone_at: null });
    });
  });

  it("expireAfterUndoCollision answers false and the row stays dismissed (mutation: drop .in(\"status\", [\"accepted\",\"edited\"]) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const id = await dismissedBy(db, accountId, "user_a");
      expect(await expireAfterUndoCollision(db, accountId, id, "user_a", NOW)).toBe(false);
      expect(await raw(db, id)).toMatchObject({ status: "dismissed", decided_by: "user_a", expired_reason: null });
    });
  });
});

/**
 * The decision instant the Undo read (Task 4 review minor 4, Task 6 review I1). Each Undo-side write is
 * scoped by it when given: one Undo's read-to-write gap cannot land on a decision made after its read.
 * The row is accepted at NOW; an Undo that read a decision 1 s earlier matches nothing.
 */
describe("the decided_at scope of the Undo-side writes", () => {
  const ONE_SECOND_OFF = "2026-10-19T09:59:59.000Z";

  it("undoProposalDecision with a decidedAt 1 s off answers missed and the row stays decided; with the exact one, undone " +
    "(mutation: drop .eq(\"decided_at\", u.decidedAt) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const id = await taskOn(db, accountId, await seedCall(db, accountId));
      await acceptAs(db, accountId, id, "user_a");
      const u = { decidedBy: "user_a", from: ["accepted", "edited"] as ("accepted" | "edited")[], now: NOW };
      expect(await undoProposalDecision(db, accountId, id, { ...u, decidedAt: ONE_SECOND_OFF })).toBe("missed");
      expect(await raw(db, id)).toMatchObject({ status: "accepted", decided_by: "user_a", decided_at: "2026-10-19T10:00:00+00:00", undone_at: null });
      expect(await undoProposalDecision(db, accountId, id, { ...u, decidedAt: T })).toBe("undone");
    });
  });

  it("expireAfterUndoCollision with a decidedAt 1 s off answers false and the row stays decided; with the exact one, true " +
    "(mutation: drop .eq(\"decided_at\", decidedAt) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const id = await taskOn(db, accountId, await seedCall(db, accountId));
      await acceptAs(db, accountId, id, "user_a");
      expect(await expireAfterUndoCollision(db, accountId, id, "user_a", NOW, ONE_SECOND_OFF)).toBe(false);
      expect(await raw(db, id)).toMatchObject({ status: "accepted", decided_by: "user_a", expired_reason: null });
      expect(await expireAfterUndoCollision(db, accountId, id, "user_a", NOW, T)).toBe(true);
    });
  });
});

/**
 * Plan Task 4 case 6: the account filter is the tenant barrier on every accessor. Account A and
 * account B each hold matching rows; every B-scoped call answers nothing of A's and moves nothing of
 * A's, while B's own row is there to be found. Each `it` is one function, so dropping
 * `.eq("account_id", accountId)` from any one of them fails that one case by name.
 */
describe("the account filter, function by function (A and B each hold matching rows)", () => {
  type Pair = {
    dbA: SupabaseClient; a: string; dbB: SupabaseClient; b: string;
    contactA: string; callA: string; pendingA: string; acceptedA: string; expiredA: string;
    contactB: string; callB: string; pendingB: string; acceptedB: string; expiredB: string;
  };
  async function withPair(fn: (p: Pair) => Promise<void>) {
    await withTestAccount(async (dbA, a) => {
      await withTestAccount(async (dbB, b) => {
        const side = async (db: SupabaseClient, acct: string) => {
          const contact = await seedContact(db, acct);
          const call = await seedCall(db, acct);
          const pending = await taskOn(db, acct, call, { contactId: contact });
          const accepted = await taskOn(db, acct, await seedCall(db, acct), { contactId: contact });
          await acceptAs(db, acct, accepted, "user_same");
          const expired = await taskOn(db, acct, await seedCall(db, acct), { contactId: contact });
          expect(await expireProposals(db, acct, [expired], "superseded", T)).toEqual([expired]);
          return { contact, call, pending, accepted, expired };
        };
        const A = await side(dbA, a);
        const B = await side(dbB, b);
        await fn({
          dbA, a, dbB, b,
          contactA: A.contact, callA: A.call, pendingA: A.pending, acceptedA: A.accepted, expiredA: A.expired,
          contactB: B.contact, callB: B.call, pendingB: B.pending, acceptedB: B.accepted, expiredB: B.expired,
        });
      });
    });
  }

  it("getProposal", () => withPair(async (p) => {
    expect(await getProposal(p.dbB, p.b, p.pendingA)).toBeNull();
    expect((await getProposal(p.dbB, p.b, p.pendingB))!.id).toBe(p.pendingB);
  }));

  it("listProposalsForCall", () => withPair(async (p) => {
    expect(await listProposalsForCall(p.dbB, p.b, p.callA)).toEqual([]);
    expect((await listProposalsForCall(p.dbB, p.b, p.callB)).map((r) => r.id)).toEqual([p.pendingB]);
  }));

  it("listPendingProposals", () => withPair(async (p) => {
    expect((await listPendingProposals(p.dbB, p.b)).map((r) => r.id)).toEqual([p.pendingB]);
  }));

  it("listPendingSiblings", () => withPair(async (p) => {
    // A pending sibling of B's own, so B's read has something to find.
    const sibB = await taskOn(p.dbB, p.b, await seedCall(p.dbB, p.b), { contactId: p.contactB });
    expect(await listPendingSiblings(p.dbB, p.b, { kind: "task", contactId: p.contactA, exceptId: p.acceptedA })).toEqual([]);
    expect((await listPendingSiblings(p.dbB, p.b, { kind: "task", contactId: p.contactB, exceptId: p.pendingB })).map((r) => r.id))
      .toEqual([sibB]);
  }));

  it("decideProposal", () => withPair(async (p) => {
    expect(await decideProposal(p.dbB, p.b, p.pendingA, { to: "dismissed", decidedBy: "user_same", now: NOW })).toBe(false);
    expect((await raw(p.dbA, p.pendingA))!.status).toBe("pending");
  }));

  it("revertProposalDecision", () => withPair(async (p) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await revertProposalDecision(p.dbB, p.b, p.acceptedA, "user_same")).toBe("missed");
    } finally {
      spy.mockRestore();
    }
    expect((await raw(p.dbA, p.acceptedA))!.status).toBe("accepted");
  }));

  it("undoProposalDecision", () => withPair(async (p) => {
    expect(await undoProposalDecision(p.dbB, p.b, p.acceptedA, { decidedBy: "user_same", from: ["accepted"], now: NOW })).toBe("missed");
    expect(await raw(p.dbA, p.acceptedA)).toMatchObject({ status: "accepted", undone_at: null });
  }));

  it("setAppliedRef", () => withPair(async (p) => {
    expect(await setAppliedRef(p.dbB, p.b, p.acceptedA, { taskId: "x" })).toBe(false);
    expect((await raw(p.dbA, p.acceptedA))!.applied_ref).toBeNull();
  }));

  it("expireProposals", () => withPair(async (p) => {
    expect(await expireProposals(p.dbB, p.b, [p.pendingA], "superseded", T)).toEqual([]);
    expect((await raw(p.dbA, p.pendingA))!.status).toBe("pending");
  }));

  it("restoreSiblings", () => withPair(async (p) => {
    expect(await restoreSiblings(p.dbB, p.b, [p.expiredA], T)).toEqual({ restored: [], collided: [] });
    expect((await raw(p.dbA, p.expiredA))!.status).toBe("expired");
  }));

  it("expireAfterUndoCollision", () => withPair(async (p) => {
    expect(await expireAfterUndoCollision(p.dbB, p.b, p.acceptedA, "user_same", NOW)).toBe(false);
    expect((await raw(p.dbA, p.acceptedA))!.status).toBe("accepted");
  }));
});

describe("the writes throw on a database error (contract: setAppliedRef and expireProposals throw, never answer false/[])", () => {
  it("setAppliedRef throws when the database refuses", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(setAppliedRef(db, accountId, "not-a-uuid", { taskId: "x" })).rejects.toThrow(/setAppliedRef failed/);
    });
  });
  it("expireProposals throws when the database refuses", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(expireProposals(db, accountId, ["not-a-uuid"], "superseded", T)).rejects.toThrow(/expireProposals failed/);
    });
  });
  // Task 4 fix round (Minor 5): only 23505 is an answer ("collision"); any other database error throws.
  it("revertProposalDecision throws on an error other than 23505", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(revertProposalDecision(db, accountId, "not-a-uuid", "user_a")).rejects.toThrow(/revertProposalDecision failed/);
    });
  });
  it("undoProposalDecision throws on an error other than 23505", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(undoProposalDecision(db, accountId, "not-a-uuid", { decidedBy: "user_a", from: ["accepted"], now: NOW }))
        .rejects.toThrow(/undoProposalDecision failed/);
    });
  });
  it("restoreSiblings throws on an error other than 23505", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(restoreSiblings(db, accountId, ["not-a-uuid"], T)).rejects.toThrow(/restoreSiblings failed/);
    });
  });
});

// Work Queue Task 10: the agency-wide screen reads EVERY account's pending proposals in one pass, with
// each account's brand name through `brandDisplayName` (never `accounts.name`) and its own zone.
describe("listPendingProposalsForAgency", () => {
  it("carries each account's own brand name, across two different accounts, and excludes a decided proposal", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        await dbA.from("accounts").update({ brand_name: "Acme HVAC" }).eq("id", accountA);
        await dbB.from("accounts").update({ brand_name: "Rio Roofing" }).eq("id", accountB);
        const pendingA = await taskOn(dbA, accountA, await seedCall(dbA, accountA));
        const callB = await seedCall(dbB, accountB);
        const pendingB = await taskOn(dbB, accountB, callB);
        const decidedB = await insertProposal(dbB, accountB, {
          callId: callB, kind: "contact_field", evidence: "B's caller spelled her email",
          evidenceRef: NO_REF, evidenceLang: "en", expiresAt: FUTURE,
          payload: { field: "email", value: "b@example.com" },
        });
        await acceptAs(dbB, accountB, decidedB!.id, "user_x");
        // Cross-tenant by design and the suite may share a project: assert on these fixtures' own rows only.
        const byId = new Map((await listPendingProposalsForAgency(dbA)).map((r) => [r.id, r]));
        expect(byId.get(pendingA)?.brandName).toBe("Acme HVAC");
        expect(byId.get(pendingB)?.brandName).toBe("Rio Roofing");
        expect(byId.has(decidedB!.id)).toBe(false);
      });
    });
  });

  it("carries each account's own timezone, across two different accounts (mutation: drop the timezone field, or always fall back to UTC -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        await dbA.from("accounts").update({ timezone: "America/Chicago" }).eq("id", accountA);
        await dbB.from("accounts").update({ timezone: "America/Los_Angeles" }).eq("id", accountB);
        const pendingA = await taskOn(dbA, accountA, await seedCall(dbA, accountA));
        const pendingB = await taskOn(dbB, accountB, await seedCall(dbB, accountB));
        const byId = new Map((await listPendingProposalsForAgency(dbA)).map((r) => [r.id, r]));
        expect(byId.get(pendingA)?.timezone).toBe("America/Chicago");
        expect(byId.get(pendingB)?.timezone).toBe("America/Los_Angeles");
      });
    });
  });

  it("returns a blank brand name, never the account's internal label, when brand_name is null (mutation: fall back to accounts.name -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await db.from("accounts").update({ brand_name: null, name: "Fixture Co — internal" }).eq("id", accountId);
      const created = await taskOn(db, accountId, await seedCall(db, accountId));
      const mine = (await listPendingProposalsForAgency(db)).find((r) => r.id === created);
      expect(mine?.brandName).toBe("");
      expect(mine?.brandName).not.toContain("Fixture Co");
    });
  });

  it("leaves out a row past expires_at, through the 0089 read on the replica's PostgREST (A2: rpc + select)", async () => {
    await withTestAccount(async (db, accountId) => {
      const live = await taskOn(db, accountId, await seedCall(db, accountId));
      const aged = await taskOn(db, accountId, await seedCall(db, accountId), { expiresAt: "2026-10-02T00:00:00.000Z" });
      const mine = (await listPendingProposalsForAgency(db, NOW)).filter((r) => r.accountId === accountId);
      expect(mine.map((r) => r.id)).toEqual([live]);
      expect(mine[0]!.accountCapped).toBe(false);
      expect(mine.map((r) => r.id)).not.toContain(aged);
    });
  });
});

/**
 * item 8b-2 (plan Task 4, 1): the agency read pages the 0089 RPC under PostgREST's max_rows (1000), in an
 * order the request itself names, dedupes by id across pages and caps per account. The stub below does what
 * the SQL does for `p_per_account` (the newest N per account, ordered account_id, created_at desc, id desc)
 * and what PostgREST does for `.range()`, so the cap and the paging are the code's own, not the stub's.
 */
describe("listPendingProposalsForAgency: paging, order, dedupe and the per-account cap (stubbed client)", () => {
  type StubRow = Record<string, unknown> & { id: string; account_id: string; created_at: string };
  const acct = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const rid = (a: number, i: number) => `${a.toString(16).padStart(8, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
  /** Row `i` of account `a`; a higher `i` is newer (created_at counts up in seconds). */
  const stubRow = (a: number, i: number, over: Record<string, unknown> = {}): StubRow => ({
    id: rid(a, i), account_id: acct(a), source: "call", call_id: rid(9999, i), contact_id: null, kind: "task",
    payload: { title: `t${i}`, dueAt: null }, applied_payload: null, applied_ref: null, evidence: "x", evidence_ref: {},
    evidence_lang: "en", status: "pending", expired_reason: null, decided_at: null, decided_by: null, undone_at: null,
    undone_by: null, expires_at: FUTURE, created_at: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), ...over,
  });
  const many = (a: number, n: number) => Array.from({ length: n }, (_, i) => stubRow(a, i + 1));

  /** 0089's own semantics over `rows`: the newest `cap` per account, ordered account, newest first. */
  const sqlOrder = (rows: StubRow[], cap: number) => {
    const sorted = [...rows].sort((x, y) => (x.account_id !== y.account_id ? (x.account_id < y.account_id ? -1 : 1)
      : x.created_at !== y.created_at ? (x.created_at < y.created_at ? 1 : -1) : x.id < y.id ? 1 : -1));
    const seen = new Map<string, number>();
    return sorted.filter((r) => { const n = (seen.get(r.account_id) ?? 0) + 1; seen.set(r.account_id, n); return n <= cap; });
  };

  type Calls = unknown[][][];
  function stub(page: (args: { p_per_account: number }, from: number, to: number, call: number) => { data: unknown; error: unknown }) {
    const calls: Calls = [];
    const accountReads: string[][] = [];
    const db = {
      rpc: (fn: string, args: { p_per_account: number }) => {
        const rec: unknown[][] = [["rpc", fn, args]];
        calls.push(rec);
        const n = calls.length;
        let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
        const b = {
          select: (c: string) => { rec.push(["select", c]); return b; },
          order: (...a: unknown[]) => { rec.push(["order", ...a]); return b; },
          range: (f: number, t: number) => { rec.push(["range", f, t]); range = [f, t]; return b; },
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve(page(args, range[0], range[1], n)).then(ok, ko),
        };
        return b;
      },
      from: (table: string) => {
        if (table !== "accounts") throw new Error(`stub: unexpected table ${table}`);
        let ids: string[] = [];
        const b = {
          select: () => b,
          in: (_c: string, v: string[]) => { ids = v; accountReads.push(v); return b; },
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({
            data: ids.map((id) => ({ id, brand_name: `Brand ${id.slice(-2)}`, timezone: "America/Chicago" })), error: null,
          }).then(ok, ko),
        };
        return b;
      },
    };
    return { db: db as unknown as SupabaseClient, calls, accountReads };
  }
  /** A table the stub serves as 0089 + PostgREST would. */
  const table = (rows: StubRow[]) => stub((args, from, to) => ({ data: sqlOrder(rows, args.p_per_account).slice(from, to + 1), error: null }));

  it("names its own order on the request (account_id, created_at desc, id desc) and pages 1000 at a time (mutation: drop .order(\"account_id\") -> FAILS)", async () => {
    const { db, calls } = table(many(1, 3));
    await listPendingProposalsForAgency(db, NOW);
    expect(calls[0]!.filter((c) => c[0] !== "select")).toEqual([
      ["rpc", "list_pending_proposals_for_agency", { p_per_account: 51 }],
      ["order", "account_id"],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["range", 0, 999],
    ]);
    expect(String(calls[0]!.find((c) => c[0] === "select")![1])).toContain("evidence_ref");
  });

  it("reads every page until an EMPTY one: 1000, then 3, then none; all 1003 come back and the second page's account is there (mutation: read one page only -> FAILS)", async () => {
    // Twenty accounts of 50 fill page one exactly; the twenty-first account's three rows are page two.
    const rows = [...Array.from({ length: 20 }, (_, a) => many(a + 1, 50)).flat(), ...many(21, 3)];
    const { db, calls } = table(rows);
    const out = await listPendingProposalsForAgency(db, NOW);
    expect(out).toHaveLength(1003);
    expect(out.filter((r) => r.accountId === acct(21)).map((r) => r.id)).toEqual([rid(21, 3), rid(21, 2), rid(21, 1)]);
    expect(calls.map((c) => c.find((x) => x[0] === "range"))).toEqual([["range", 0, 999], ["range", 1000, 1999], ["range", 1003, 2002]]);
  });

  it("throws after 20 pages that never end, rather than show a partial screen as whole (mutation: return what was read -> FAILS)", async () => {
    const { db, calls } = stub((_a, from) => ({ data: Array.from({ length: 1000 }, (_, i) => stubRow(1 + Math.floor((from + i) / 50), from + i + 1)), error: null }));
    await expect(listPendingProposalsForAgency(db, NOW)).rejects.toThrow(/listPendingProposalsForAgency: no end after 20 pages/);
    expect(calls).toHaveLength(20);
  });

  it("throws when a page is refused (mutation: treat an error as an empty page -> FAILS)", async () => {
    const { db } = stub((_a, _f, _t, n) => (n === 1 ? { data: many(1, 2), error: null } : { data: null, error: { message: "boom" } }));
    await expect(listPendingProposalsForAgency(db, NOW)).rejects.toThrow(/listPendingProposalsForAgency failed: boom/);
  });

  // The repeat is in an account well under the cap: in a full account the 51st copy is cut by the cap and
  // the duplicate would hide (the first draft of this case did exactly that and could not fail).
  it("a row that repeats across two pages (offset pages are not one snapshot) is listed once (mutation: drop the dedupe -> the row twice, FAILS)", async () => {
    const first = [stubRow(1, 3), stubRow(1, 2), stubRow(1, 1)];
    const { db } = stub((_a, from) => ({
      data: from === 0 ? first : from === 3 ? [stubRow(1, 1), stubRow(2, 1)] : [], error: null,
    }));
    expect((await listPendingProposalsForAgency(db, NOW)).map((r) => r.id)).toEqual([rid(1, 3), rid(1, 2), rid(1, 1), rid(2, 1)]);
  });

  it("keeps the newest 50 per account, and says so: capped for the account that had 51, not for one with 50 (mutation: ask for AGENCY_PER_ACCOUNT, not + 1 -> FAILS)", async () => {
    const { db } = table([...many(10, 60), ...many(11, 50)]);
    const out = await listPendingProposalsForAgency(db, NOW);
    const a = out.filter((r) => r.accountId === acct(10));
    const b = out.filter((r) => r.accountId === acct(11));
    expect(a.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => rid(10, 60 - i)));
    expect(a.every((r) => r.accountCapped)).toBe(true);
    expect(b).toHaveLength(50);
    expect(b.some((r) => r.accountCapped)).toBe(false);
  });

  it("a quiet account is still listed beside a busy one (mutation: one global cap of 50 instead of per account -> FAILS)", async () => {
    const { db } = table([...many(10, 60), ...many(12, 1)]);
    const out = await listPendingProposalsForAgency(db, NOW);
    expect(out.filter((r) => r.accountId === acct(12)).map((r) => [r.id, r.accountCapped, r.brandName, r.timezone]))
      .toEqual([[rid(12, 1), false, "Brand 0c", "America/Chicago"]]);
  });

  it("leaves out a row the caller's clock already sees as aged (mutation: drop the expires_at > now check -> FAILS)", async () => {
    const { db } = table([stubRow(1, 2), stubRow(1, 1, { expires_at: "2026-10-19T09:59:59.999Z" })]);
    expect((await listPendingProposalsForAgency(db, NOW)).map((r) => r.id)).toEqual([rid(1, 2)]);
  });

  it("reads the brands of only the accounts it lists, once, with no read at all for an empty answer", async () => {
    const two = table([...many(3, 1), ...many(4, 1)]);
    await listPendingProposalsForAgency(two.db, NOW);
    expect(two.accountReads).toEqual([[acct(3), acct(4)]]);
    const none = table([]);
    expect(await listPendingProposalsForAgency(none.db, NOW)).toEqual([]);
    expect(none.accountReads).toEqual([]);
  });
});

/**
 * A read-only PostgREST stand-in over one `pg` connection, for the chain `listPendingProposalsForContact`
 * builds (select, eq, gt, order, limit). It runs on the connection's CURRENT role and claims, so a case that
 * `actAsMember`s first reads through that person's RLS exactly as their request client would (P14). It
 * understands nothing else: an unknown builder call throws.
 */
function pgReader(c: Client): SupabaseClient {
  const from = (tbl: string) => {
    let cols = "*";
    const where: string[] = [];
    const args: unknown[] = [];
    const order: string[] = [];
    let limit: number | null = null;
    const ident = (s: string) => { if (!/^[a-z_]+$/.test(s)) throw new Error(`pgReader: bad identifier ${s}`); return s; };
    const b = {
      select: (s: string) => { cols = s.split(",").map((x) => ident(x.trim())).join(", "); return b; },
      eq: (k: string, v: unknown) => { args.push(v); where.push(`${ident(k)} = $${args.length}`); return b; },
      gt: (k: string, v: unknown) => { args.push(v); where.push(`${ident(k)} > $${args.length}`); return b; },
      order: (k: string, o?: { ascending?: boolean }) => { order.push(`${ident(k)} ${o?.ascending === false ? "desc" : "asc"}`); return b; },
      limit: (n: number) => { limit = n; return b; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => c.query<{ rows: unknown[] }>(
        `select coalesce(json_agg(row_to_json(t)), '[]'::json) as rows from (select ${cols} from public.${ident(tbl)}` +
        (where.length ? ` where ${where.join(" and ")}` : "") + (order.length ? ` order by ${order.join(", ")}` : "") +
        (limit !== null ? ` limit ${limit}` : "") + ") t", args,
      ).then((r) => ({ data: r.rows[0]!.rows, error: null }), (e: Error) => ({ data: null, error: { message: e.message } })).then(ok, ko),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

/** item 8b-2 (plan Task 4, 2): the record's "Waiting for you" read, on the caller's own client. */
describe("listPendingProposalsForContact", () => {
  it("account B's id with A's customer answers nothing while B has a pending row of its own (mutation: drop .eq(\"account_id\") -> FAILS)", async () => {
    await withTestAccount(async (dbA, a) => {
      await withTestAccount(async (dbB, b) => {
        const contactA = await seedContact(dbA, a);
        await taskOn(dbA, a, await seedCall(dbA, a), { contactId: contactA });
        const contactB = await seedContact(dbB, b);
        const pendingB = await taskOn(dbB, b, await seedCall(dbB, b), { contactId: contactB });
        expect(await listPendingProposalsForContact(dbB, b, contactA, NOW)).toEqual([]);
        expect((await listPendingProposalsForContact(dbB, b, contactB, NOW)).map((r) => r.id)).toEqual([pendingB]);
      });
    });
  });

  it("leaves out an aged row, a decided one and another customer's (mutation: drop .gt(\"expires_at\", now) -> the aged row enters, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = await seedContact(db, accountId);
      const ben = await seedContact(db, accountId, { first_name: "Ben" });
      const live = await taskOn(db, accountId, await seedCall(db, accountId), { contactId: ana });
      await taskOn(db, accountId, await seedCall(db, accountId), { contactId: ana, expiresAt: "2026-10-02T00:00:00.000Z" });
      const decided = await taskOn(db, accountId, await seedCall(db, accountId), { contactId: ana });
      await acceptAs(db, accountId, decided, "user_x");
      await taskOn(db, accountId, await seedCall(db, accountId), { contactId: ben });
      expect((await listPendingProposalsForContact(db, accountId, ana, NOW)).map((r) => r.id)).toEqual([live]);
    });
  });

  it("at most 5, newest first (mutation: drop .limit(WAITING_LIMIT) -> six, FAILS; created_at ascending -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = await seedContact(db, accountId);
      // created_at is fixed once written (0088's proposals_proposed_is_fixed), so the order is the insert
      // order: one request each, so each its own now().
      const ids: string[] = [];
      for (let i = 1; i <= 6; i++) ids.push(await taskOn(db, accountId, await seedCall(db, accountId), { contactId: ana, title: `t${i}` }));
      expect((await listPendingProposalsForContact(db, accountId, ana, NOW)).map((r) => r.id))
        .toEqual([ids[5], ids[4], ids[3], ids[2], ids[1]]);
    });
  });

  it("throws on a refused read, never an empty section (mutation: return [] on error -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(listPendingProposalsForContact(db, accountId, "not-a-uuid", NOW)).rejects.toThrow(/listPendingProposalsForContact failed/);
    });
  });

  it("on a Technician's own client it reads nothing for a customer they are not assigned, while the Owner reads the row (P14 through RLS; the Owner is the control)", () =>
    withRollback(async (c) => {
      const run = Math.random().toString(36).slice(2, 10);
      const org = `org_wait_${run}`;
      const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
      const agency = await one("select id from agencies limit 1", []);
      const account = await one(
        "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Wait Co',true) returning id", [agency, org]);
      const contact = await one("insert into contacts (account_id, first_name) values ($1,'Unassigned') returning id", [account]);
      const phone = await one("insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [account, testPhoneNumber()]);
      const call = await one(
        "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [account, phone, contact]);
      const pending = await one(
        `insert into proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at)
           values ($1,'call',$2,$3,'task','{"title":"Send the quote","dueAt":null}','I need a quote',$4) returning id`,
        [account, call, contact, FUTURE]);
      await c.query("savepoint before_roles");
      await actAsMember(c, account, org, "technician");
      expect(await listPendingProposalsForContact(pgReader(c), account, contact, NOW)).toEqual([]);
      await c.query("rollback to savepoint before_roles");
      await actAsMember(c, account, org, "owner");
      expect((await listPendingProposalsForContact(pgReader(c), account, contact, NOW)).map((r) => r.id)).toEqual([pending]);
    }));
});

/**
 * A proposal is a QUESTION about work, not work: `listAccountWork` and `listAgencyWork` must never
 * learn to filter proposals out, because that is only safe if nothing ever puts one in. Realistic
 * fixtures: a real account, a real call, a real contact on one of the two. Proved live when written
 * (the deleted call-proposals.test.ts's report): folding pending proposals into `listAccountWork`
 * turns this red by name.
 */
describe("proposals cannot contaminate the work queue", () => {
  it("leaves listAccountWork's and listAgencyWork's rows byte-identical, by id, before and after realistic pending proposals are seeded", async () => {
    await withTestAccount(async (db, accountId) => {
      await addTask(db, accountId, { title: "Call Maria back" }, "user_test");
      const contactId = await seedContact(db, accountId);
      const before = await listAccountWork(db, accountId);
      const agencyBefore = (await listAgencyWork(db)).filter((r) => r.accountId === accountId);
      expect(before.length).toBeGreaterThan(0);

      const callId = await seedCall(db, accountId);
      await taskOn(db, accountId, callId, { contactId, evidence: "the caller asked to be called back Tuesday" });
      expect(await insertProposal(db, accountId, {
        callId, kind: "contact_field", evidence: "the caller spelled her email out loud",
        evidenceRef: NO_REF, evidenceLang: "en", expiresAt: FUTURE,
        payload: { field: "email", value: "sam@example.com" },
      })).not.toBeNull();

      const after = await listAccountWork(db, accountId);
      const agencyAfter = (await listAgencyWork(db)).filter((r) => r.accountId === accountId);
      expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
      expect(agencyAfter.map((r) => r.id).sort()).toEqual(agencyBefore.map((r) => r.id).sort());
    });
  });
});

describe("fillContactBlanksReport (Undo's toast must know whether the fill raised a duplicate flag)", () => {
  it("says when the fill raised a duplicate flag; fillContactBlanks still answers the fields (mutation: flagged: false hard-coded -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await seedContact(db, accountId, { first_name: "Holder", email: "dup@example.com" });
      const filler = await seedContact(db, accountId, { first_name: "Filler" });
      expect(await fillContactBlanksReport(db, accountId, filler, { email: "dup@example.com" }, "user_x"))
        .toEqual({ fields: ["email"], flagged: true });
      const fresh = await seedContact(db, accountId, { first_name: "Fresh" });
      expect(await fillContactBlanksReport(db, accountId, fresh, { email: "fresh@example.com" }, "user_x"))
        .toEqual({ fields: ["email"], flagged: false });
      const plain = await seedContact(db, accountId, { first_name: "Plain" });
      expect(await fillContactBlanks(db, accountId, plain, { email: "plain@example.com" }, "user_x")).toEqual(["email"]);
      expect(await fillContactBlanksReport(db, accountId, plain, { email: "other@example.com" }, "user_x"))
        .toEqual({ fields: [], flagged: false });
    });
  });

  it("another account holding the same email raises no flag", async () => {
    await withTestAccount(async (dbA, a) => {
      await withTestAccount(async (dbB, b) => {
        await seedContact(dbB, b, { first_name: "Holder", email: "shared@example.com" });
        const filler = await seedContact(dbA, a, { first_name: "Filler" });
        expect(await fillContactBlanksReport(dbA, a, filler, { email: "shared@example.com" }, "user_x"))
          .toEqual({ fields: ["email"], flagged: false });
      });
    });
  });
});

describe("deleteTaskForUndo", () => {
  const DUE = "2026-10-21T15:00:00.000Z";
  const expectAna = { title: "Call Ana back", dueAt: DUE };
  const exists = async (db: SupabaseClient, id: string) =>
    ((await db.from("tasks").select("id").eq("id", id)).data ?? []).length === 1;

  it("deletes only an open task with the same title and due date, and emits task.deleted with the person as actor (mutation: drop .is(\"completed_at\", null) -> the completed task is deleted, FAILS; drop the title condition -> the retitled task is deleted, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const match = (await addTask(db, accountId, { title: "Call Ana back", dueAt: DUE }, "user_x")).id;
      const retitled = (await addTask(db, accountId, { title: "Call Ana back about the deck", dueAt: DUE }, "user_x")).id;
      const completed = (await addTask(db, accountId, { title: "Call Ana back", dueAt: DUE }, "user_x")).id;
      expect((await db.from("tasks").update({ completed_at: "2026-10-20T00:00:00.000Z" }).eq("id", completed)).error).toBeNull();
      const otherDue = (await addTask(db, accountId, { title: "Call Ana back", dueAt: "2026-10-22T15:00:00.000Z" }, "user_x")).id;
      const noDue = (await addTask(db, accountId, { title: "Call Ana back" }, "user_x")).id;

      expect(await deleteTaskForUndo(db, accountId, retitled, "user_undo", expectAna)).toBe(false);
      expect(await deleteTaskForUndo(db, accountId, completed, "user_undo", expectAna)).toBe(false);
      expect(await deleteTaskForUndo(db, accountId, otherDue, "user_undo", expectAna)).toBe(false);
      expect(await deleteTaskForUndo(db, accountId, noDue, "user_undo", expectAna)).toBe(false);
      expect(await deleteTaskForUndo(db, accountId, match, "user_undo", expectAna)).toBe(true);
      expect(await exists(db, match)).toBe(false);
      for (const kept of [retitled, completed, otherDue, noDue]) expect(await exists(db, kept)).toBe(true);
      expect(await deleteTaskForUndo(db, accountId, noDue, "user_undo", { title: "Call Ana back", dueAt: null })).toBe(true);

      const { data: events, error } = await db.from("events").select("actor_type, actor_id, payload")
        .eq("account_id", accountId).eq("type", "task.deleted");
      expect(error).toBeNull();
      const seen = (events ?? []).map((e) => `${e.actor_type}|${e.actor_id}|${(e.payload as { taskId: string }).taskId}`).sort();
      expect(seen).toEqual([`user|user_undo|${match}`, `user|user_undo|${noDue}`].sort());
    });
  });

  it("account B's id with A's task deletes nothing, while B holds a matching task of its own", async () => {
    await withTestAccount(async (dbA, a) => {
      await withTestAccount(async (dbB, b) => {
        const taskA = (await addTask(dbA, a, { title: "Call Ana back", dueAt: DUE }, "user_x")).id;
        const taskB = (await addTask(dbB, b, { title: "Call Ana back", dueAt: DUE }, "user_x")).id;
        expect(await deleteTaskForUndo(dbB, b, taskA, "user_undo", expectAna)).toBe(false);
        expect(await exists(dbA, taskA)).toBe(true);
        expect(await deleteTaskForUndo(dbB, b, taskB, "user_undo", expectAna)).toBe(true);
      });
    });
  });
});

describe("effectiveStatus (P10: a pending row past expires_at is out of date to every reader)", () => {
  const now = new Date("2026-10-19T10:00:00.000Z");
  it("pending 1 ms before expiry is pending; exactly at expiry is expired/aged (mutation: > for >= -> FAILS)", () => {
    expect(effectiveStatus({ status: "pending", expiresAt: "2026-10-19T10:00:00.001Z" }, now)).toEqual({ status: "pending", reason: null });
    expect(effectiveStatus({ status: "pending", expiresAt: "2026-10-19T10:00:00.000Z" }, now)).toEqual({ status: "expired", reason: "aged" });
    expect(effectiveStatus({ status: "pending", expiresAt: "2026-10-01T00:00:00.000Z" }, now)).toEqual({ status: "expired", reason: "aged" });
  });
  it("a decided status is unchanged whatever the date", () => {
    for (const status of ["accepted", "edited", "dismissed", "expired"] as const) {
      expect(effectiveStatus({ status, expiresAt: "2026-10-01T00:00:00.000Z" }, now)).toEqual({ status, reason: null });
    }
  });
});

// Compile-time half: a mismatched kind/payload pair cannot be constructed at `insertProposal`'s own
// call site. Never called; `tsc --noEmit` reports TS2578 on the directive if the parameter is widened
// back to a bare `{ kind: ProposalKind; payload: ProposalPayload }`.
function _typeOnly_taskCannotCarryAnOpportunityStagePayload(
  db: SupabaseClient, accountId: string,
): void {
  void insertProposal(db, accountId, {
    callId: "unused", evidence: "unused", evidenceRef: {}, evidenceLang: "en", expiresAt: FUTURE, kind: "task",
    // @ts-expect-error kind "task" cannot carry an OpportunityStagePayload
    payload: { opportunityId: "x", fromStageId: "y", toStageId: "z" },
  });
}
