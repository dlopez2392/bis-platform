/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-built fake
   SupabaseClient (`fakeDb`) needs loose typing to stand in for the real
   client's `.from().insert().select().single()` chain; this file is not
   part of the shipped module and typing the fake strictly would fight it
   for no safety gained (same rationale as embed-script.test.ts). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateProposals } from "./generate";
import type { TranscriptEvent } from "@bis/db";

// Matches summary-service.test.ts's own pattern: generateProposals reads
// OPENAI_API_KEY inside the function body (never at module scope), so tests
// exercising the model path must set it themselves — a missing key is its
// own no-op branch (`generate.ts`'s `if (!apiKey) return 0;`), not something
// these tests are checking.
beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

const transcript: TranscriptEvent[] = [
  t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
  t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
];

function modelReturning(content: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200 })) as unknown as typeof fetch;
}

function fakeDb() {
  const inserted: any[] = [];
  const db: any = {
    inserted,
    from: () => ({
      insert: (row: any) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }) };
      },
    }),
  };
  return db;
}

const base = {
  accountId: "acct", callId: "call1", contactId: null,
  outcome: "lead" as const, transcript, handoffRequested: false,
};

describe("generateProposals", () => {
  it("writes a grounded task proposal", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Send a dining table quote",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].kind).toBe("task");
    // NOT the model's excerpt ("Call me Tuesday morning") — groundedEvidence
    // returns the caller's WHOLE TURN (grounding.ts's own contract, pinned
    // by grounding.test.ts's "returns the transcript's own text, not the
    // normalised needle"). Storing the excerpt instead of the turn is
    // exactly the defect this task exists to prevent: a negation or
    // qualifier outside the excerpt would be invisible to the reviewer.
    expect(db.inserted[0].evidence).toBe(
      "I need a quote for a dining table. Call me Tuesday morning.",
    );
  });

  // THE CENTRAL SAFETY PROPERTY. A model that invents a quote must produce
  // NOTHING, not a proposal a human might believe.
  it("DROPS a proposal whose evidence is not in the transcript (mutation: skip the groundedEvidence check -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Call Thursday",
                      dueAt: null, evidence: "Call me Thursday morning" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("proposes nothing for an ineligible call, and does NOT call the model at all (mutation: move the eligibility check after the fetch -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    const n = await generateProposals({ ...base, db, outcome: "spam", fetchImpl });
    expect(n).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.inserted).toEqual([]);
  });

  it("returns 0 and writes nothing when the model returns unparseable content", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "I'm afraid I can't help with that." } }],
    }), { status: 200 })) as unknown as typeof fetch;
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("returns 0 when the model call fails outright, and never throws", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await expect(generateProposals({ ...base, db, fetchImpl })).resolves.toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("caps the number of proposals per call (mutation: raise or drop MAX_PER_CALL -> FAILS)", async () => {
    const db = fakeDb();
    const many = Array.from({ length: 9 }, (_, i) => ({
      kind: "task", title: `Task ${i}`, dueAt: null,
      evidence: "Call me Tuesday morning",
    }));
    const n = await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: many }) });
    expect(n).toBe(3);
    expect(db.inserted).toHaveLength(3);
  });

  it("ignores a kind it does not know (mutation: drop the kind allow-list -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "delete_contact", title: "Remove them",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("drops a proposal with a blank title even when the evidence is real", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "   ", dueAt: null,
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(0);
  });

  // Step 4b: the spec names "a wrong number" as a case that must propose
  // nothing, and no guard in eligibility.ts covers it — a wrong-number
  // caller for whom Sofía took a message is classified `message` and is
  // fully eligible under callIsEligible. Only the transcript can say the
  // caller never wanted this business at all, so this has to live in the
  // instructions sent to the model, not in a guard this test could call
  // directly. A test that fed a wrong-number transcript through a MOCKED
  // fetchImpl would prove nothing about the prompt — the mock decides the
  // output regardless of what SYSTEM says. So instead this inspects the
  // actual request body generateProposals sends, and fails BY NAME if the
  // wrong-number instruction is removed from SYSTEM.
  it("tells the model to withhold on a wrong-number call (mutation: delete the wrong-number line from SYSTEM -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as any).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const system = body.messages.find((m: { role: string }) => m.role === "system")?.content ?? "";
    expect(system.toLowerCase()).toContain("wrong number");
  });
});
