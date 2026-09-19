/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-built fake
   SupabaseClient (`fakeDb`) needs loose typing to stand in for the real
   client's `.from().insert().select().single()` chain; this file is not
   part of the shipped module and typing the fake strictly would fight it
   for no safety gained (same rationale as embed-script.test.ts). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateProposals } from "./generate";
import type { TranscriptEvent } from "@bis/db";

// Matches summary-service.test.ts's own pattern: generateProposals reads
// OPENAI_API_KEY inside the function body (never at module scope), so tests
// exercising the model path must set it themselves — a missing key is its
// own no-op branch (`generate.ts`'s `if (!apiKey) return 0;`), not something
// these tests are checking.
beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });

// Minor 5 of the fix-wave: several tests below install
// `vi.spyOn(console, "error")` inline and restore it on their own last
// line. `apps/web/vitest.config.ts` sets no `restoreMocks`, so a spy whose
// OWN assertion throws never reaches that last line and leaks into every
// test that runs after it in the same file — a single failing assertion can
// then read as several unrelated failures. This is a backstop, not a
// replacement for each test's own restore.
afterEach(() => { vi.restoreAllMocks(); });

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

const transcript: TranscriptEvent[] = [
  t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
  t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
];

// SOURCE DEVIATION (source wins over the brief, per this task's own rule):
// the brief's contact_field test block reused `transcript` above with the
// evidence "my email is sam at example dot com" — a phrase that transcript
// never contains. `groundedEvidence` (grounding.ts) requires the quote to
// appear in an actual CALLER turn, so every one of those tests would return
// 0 regardless of the blankFields/allow-list logic under test — not
// unfalsifiable in the sense of always passing, but wrong for the reason:
// a mutation to the guard under test would be MASKED by the unrelated
// grounding failure. This transcript actually carries the quote, so the
// tests below isolate the guard they name.
const emailTranscript: TranscriptEvent[] = [
  t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
  t("caller", "My email is sam at example dot com."),
];

function modelReturning(content: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200 })) as unknown as typeof fetch;
}

const DEFAULT_CONTACT_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * Enforces the LIVE partial unique index
 * (`call_proposals_one_pending_unique`, 0040_call_proposals.sql):
 * `(call_id, kind, coalesce(contact_id, sentinel)) where status='pending'`.
 * The original fake had no such thing and let every insert "succeed",
 * which is exactly why `generate.test.ts:138`'s old cap test asserted a
 * count (3) that cannot happen in production — see Task 4 fix-wave finding
 * 2. `rows` records what actually landed; `attempts` records every call
 * made to `.insert()`, landed or refused, so a test can tell the two apart.
 */
function fakeDb() {
  const rows: any[] = [];
  const attempts: any[] = [];
  // Fix-wave finding 1: the spec's sharpest assertion — "generating
  // proposals writes nothing to `tasks`, `contacts` or `opportunities`" —
  // had NOTHING checking it, because the original `from: () => ({ … })`
  // ignored the table-name argument entirely and could not tell
  // `from("call_proposals")` from `from("tasks")`. `tablesTouched` records
  // every table name the generator ever asks `db.from()` for, in call
  // order, so a test can assert the whole list rather than trust that only
  // the one branch it's looking at ran.
  const tablesTouched: string[] = [];
  const seen = new Set<string>();
  const db: any = {
    rows, attempts, tablesTouched,
    from: (table: string) => {
      tablesTouched.push(table);
      return {
        insert: (row: any) => {
          attempts.push(row);
          const key = `${row.call_id}|${row.kind}|${row.contact_id ?? DEFAULT_CONTACT_SENTINEL}`;
          if (seen.has(key)) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate key value violates unique constraint" },
                }),
              }),
            };
          }
          seen.add(key);
          return {
            select: () => ({
              single: async () => {
                rows.push(row);
                return { data: { id: `p${rows.length}` }, error: null };
              },
            }),
          };
        },
      };
    },
  };
  return db;
}

/** Every insert refused, unconditionally — for proving the loop's cap is on
 *  attempts, independent of the (also real) unique-index collision above. */
function fakeDbAlwaysRefusing() {
  const attempts: any[] = [];
  const db: any = {
    attempts, rows: [] as any[],
    from: () => ({
      insert: (row: any) => {
        attempts.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            }),
          }),
        };
      },
    }),
  };
  return db;
}

const base = {
  accountId: "acct", callId: "call1", contactId: null,
  outcome: "lead" as const, transcript, handoffRequested: false,
  // Default is "nothing is blank" — matching `contactId: null` above, no
  // test below is exercising the contact_field boundary unless it opts in
  // by overriding this.
  blankFields: [] as ("firstName" | "lastName" | "email" | "phone")[],
};

function requestBodyOf(fetchImpl: typeof fetch): any {
  const [, init] = (fetchImpl as any).mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

function systemPromptOf(fetchImpl: typeof fetch): string {
  const body = requestBodyOf(fetchImpl);
  return (body.messages.find((m: { role: string }) => m.role === "system")?.content ?? "") as string;
}

describe("generateProposals", () => {
  it("writes a grounded task proposal with the correct row shape", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "contact-1",
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Send a dining table quote",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows).toHaveLength(1);
    // THE WHOLE ROW, not one field at a time — finding 5 of the fix-wave
    // review proved four separate account/call/contact/title mixups each
    // left a field-by-field assertion suite green. `contact_id` is a real,
    // non-null value here specifically so the field is exercised at all.
    expect(db.rows[0]).toEqual({
      account_id: "acct",
      call_id: "call1",
      contact_id: "contact-1",
      kind: "task",
      // NOT the model's excerpt ("Call me Tuesday morning") — groundedEvidence
      // returns the caller's WHOLE TURN (grounding.ts's own contract, pinned
      // by grounding.test.ts's "returns the transcript's own text, not the
      // normalised needle"). Storing the excerpt instead of the turn is
      // exactly the defect this task exists to prevent: a negation or
      // qualifier outside the excerpt would be invisible to the reviewer.
      evidence: "I need a quote for a dining table. Call me Tuesday morning.",
      payload: { title: "Send a dining table quote", dueAt: null },
    });
  });

  // THE BOUNDARY THE DESIGN SPEC NAMES ABOVE EVERY OTHER ASSERTION: "a
  // proposal must never become a record without a human action... generating
  // proposals writes nothing to `tasks`, `contacts` or `opportunities`."
  // Fix-wave finding 1 — before `tablesTouched` existed, `fakeDb()`'s
  // `from: () => ({ … })` discarded its table-name argument, so a mutation
  // that ALSO wrote a real row to `tasks` after every successful insert left
  // every test in this file green, including this one's neighbors above.
  it("touches call_proposals and NO OTHER TABLE (mutation: also insert a row into \"tasks\" after a successful proposal -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "contact-1",
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Send a dining table quote",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.tablesTouched).toEqual(["call_proposals"]);
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
    expect(db.rows).toEqual([]);
  });

  it("proposes nothing for an ineligible call, and does NOT call the model at all (mutation: move the eligibility check after the fetch -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    const n = await generateProposals({ ...base, db, outcome: "spam", fetchImpl });
    expect(n).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.rows).toEqual([]);
  });

  it("returns 0 and writes nothing when the model returns unparseable content", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "I'm afraid I can't help with that." } }],
    }), { status: 200 })) as unknown as typeof fetch;
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(db.rows).toEqual([]);
  });

  it("returns 0 when the model call fails outright, and never throws", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await expect(generateProposals({ ...base, db, fetchImpl })).resolves.toBe(0);
    expect(db.rows).toEqual([]);
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
    expect(db.rows).toEqual([]);
  });

  // RENAMED (fix-wave Important 5): this used to be named "refuses a
  // contact_field proposal — its accept path does not exist yet", which
  // Task 8 makes false in BOTH halves — the kind is no longer refused, and
  // its accept path exists. It passed only because its fixture omitted
  // `field`/`value` entirely, and nothing about that fixture named the
  // guard it was actually exercising. Retargeted at the blank-value guard
  // specifically (fix-wave Minor: "dropping !value leaves 37/37 green" had
  // no test of its own, unlike the `task` twin at line 381) — `blankFields`
  // names a REAL candidate field so the earlier blankFields/allow-list
  // guards do not mask this one, and the field chosen (`firstName`) carries
  // no format check of its own, so this isolates `!value` alone rather than
  // also exercising the phone/email normalisation added for Important 2.
  it("drops a contact_field proposal that names a field but carries no value (mutation: drop the !value guard -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["firstName"], transcript: emailTranscript,
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "firstName",
                      evidence: "my email is sam at example dot com" }],   // no `value` at all
      }),
    });
    expect(n).toBe(0);
    expect(db.rows).toEqual([]);
  });

  it("refuses an opportunity_stage proposal — its accept path does not exist yet", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "opportunity_stage", title: "Move to won",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.rows).toEqual([]);
  });

  // Task 8: a contact_field proposal for a field the model correctly names
  // as blank. THE WHOLE ROW (fix-wave Important 4), not two fields — the
  // `task` twin above already learned this lesson (finding 5 of the earlier
  // fix-wave review proved four separate account/call/contact/title mixups
  // each left a field-by-field assertion suite green); this is the same
  // argument applied to `contact_field`, which had never gotten it. `evidence`
  // in particular pins the THIRD of those mixups: it must be
  // `emailTranscript`'s own CALLER TURN verbatim, not the model's shorter
  // excerpt ("my email is sam at example dot com") — storing the excerpt is
  // exactly the defect `generate.ts`'s own comment on the `task` branch spends
  // twelve lines on, and until this test it was pinned for `task` and
  // unpinned for `contact_field`.
  it("proposes a contact field that is currently blank, with the whole row grounded in the caller's own turn", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["email"], transcript: emailTranscript,
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "email",
                      value: "sam@example.com",
                      evidence: "my email is sam at example dot com" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows[0]).toEqual({
      account_id: "acct",
      call_id: "call1",
      contact_id: "c1",
      kind: "contact_field",
      evidence: "My email is sam at example dot com.",
      payload: { field: "email", value: "sam@example.com" },
    });
  });

  // Fix-wave Important 2. PROVED against the real `fillContactBlanks`: a
  // value of "not an email at all" writes to `contacts.email` verbatim,
  // because the live schema has no CHECK on the column and nothing before
  // this generator validated it either. Dropped here exactly like an
  // unparsable `dueAt` is — a proposal a human cannot usefully accept is
  // worth nothing on the review screen.
  it("drops a contact_field email proposal whose value does not parse as an email (mutation: skip the isValidEmail check -> FAILS)", async () => {
    const db = fakeDb();
    const badEmailTranscript: TranscriptEvent[] = [
      t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
      t("caller", "My email address is not an email at all, sorry."),
    ];
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["email"], transcript: badEmailTranscript,
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "email", value: "not an email at all",
                      evidence: "not an email at all" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.rows).toEqual([]);
  });

  // Fix-wave Important 2, the phone half. PROVED against the real
  // `fillContactBlanks`: a value of "555 1234" writes verbatim too — this
  // value is a SPEECH TRANSCRIPTION ("five five five, one two three four"),
  // so a non-E.164 phone is the likely output, not the corner case, and an
  // unnormalised `contacts.phone` breaks phone dedupe plus every text-back/
  // alert path keyed on it. `toE164` refuses a 7-digit number outright
  // (`phone-number.ts`: it accepts only 10, 11-with-leading-1, or 8..15
  // digits generally — 7 fits none of those), so this is dropped rather than
  // stored short.
  it("drops a contact_field phone proposal whose value does not parse via toE164 (mutation: skip the toE164 check -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["phone"],
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "phone", value: "555 1234",
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.rows).toEqual([]);
  });

  // The positive twin: a real 10-digit number is NORMALISED to E.164 before
  // it reaches the database, not stored as the digits the model happened to
  // return (mutation target: storing `value` raw instead of `toE164(value)`).
  it("normalizes a valid phone value to E.164 before it reaches the database (mutation: store the raw value instead of toE164(value) -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["phone"],
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "phone", value: "9562921696",
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows[0].payload).toEqual({ field: "phone", value: "+19562921696" });
  });

  // Fix-wave Minor: the `task` twin above ("clamps an excessively long
  // title") clamps `title` with the comment "A title lands verbatim on a
  // review card, not a document" — `contact_field`'s `value` lands on that
  // SAME card (`proposals.tsx` interpolates it straight into the sentence),
  // so an unclamped 5,000-character value is the identical defect. Uses
  // `firstName` (no format check of its own) so this isolates the clamp
  // rather than also exercising Important 2's email/phone validation.
  it("clamps an excessively long contact_field value before it reaches a review card (mutation: remove the .slice(0, MAX_TITLE_LEN) clamp on value -> FAILS)", async () => {
    const db = fakeDb();
    const longValue = "x".repeat(5000);
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["firstName"],
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "firstName", value: longValue,
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect((db.rows[0].payload as { value: string }).value.length).toBeLessThan(5000);
  });

  // THE CONTAINMENT BOUNDARY. A wrong fill into an empty field costs a
  // correction; a wrong OVERWRITE destroys something a person typed and is
  // unrecoverable from the UI. Uses `emailTranscript` (not the file's
  // default `transcript`) so the quote actually grounds — otherwise a
  // dropped `blankFields` filter would still return 0 via the UNRELATED
  // grounding check, masking the exact mutation this test names.
  it("NEVER proposes a field that is not blank, even when the model asks (mutation: drop the blankFields filter -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: [], transcript: emailTranscript,   // nothing is blank
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "email",
                      value: "attacker@example.com",
                      evidence: "my email is sam at example dot com" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.rows).toEqual([]);
  });

  // `blankFields` carries a value ("consent") outside the real
  // firstName/lastName/email/phone union — a deliberate, cast-forced hostile
  // input, exactly like the transcript's own `as unknown as
  // TranscriptEvent[]` casts elsewhere in this file. Without it, "consent"
  // would ALSO be rejected by the blankFields check (it can't be blank if
  // it isn't a real field), so dropping the CONTACT_FIELDS allow-list alone
  // would not be observable — the blankFields gate would still return 0 and
  // silently hide the mutation this test names.
  it("refuses a field outside the allow-list (mutation: drop the field allow-list -> FAILS)", async () => {
    const db = fakeDb();
    // `custom`, tags and consent flags are out of scope by design — consent
    // in particular is a legal record, not a convenience.
    const n = await generateProposals({
      ...base, db, contactId: "c1",
      blankFields: ["consent"] as unknown as readonly ("firstName" | "lastName" | "email" | "phone")[],
      transcript: emailTranscript,
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "consent", value: "true",
                      evidence: "my email is sam at example dot com" }],
      }),
    });
    expect(n).toBe(0);
  });

  it("proposes no contact field when the call resolved no contact", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: null, blankFields: ["email"], transcript: emailTranscript,
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "email", value: "sam@example.com",
                      evidence: "my email is sam at example dot com" }],
      }),
    });
    expect(n).toBe(0);
  });

  it("still requires grounding for a contact field (mutation: skip groundedEvidence on this branch -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["email"],
      fetchImpl: modelReturning({
        proposals: [{ kind: "contact_field", field: "email", value: "sam@example.com",
                      evidence: "he gave me his email" }],   // not in the transcript
      }),
    });
    expect(n).toBe(0);
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

  it("clamps an excessively long title before it reaches a review card (mutation: remove the .slice(0, MAX_TITLE_LEN) clamp -> FAILS)", async () => {
    const db = fakeDb();
    const longTitle = "x".repeat(5000);
    const n = await generateProposals({
      ...base, db, contactId: "contact-long",
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: longTitle, dueAt: null,
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows[0].payload.title.length).toBeLessThan(5000);
  });

  it("stores dueAt as null when the model returns free text instead of an ISO instant, but keeps the proposal (mutation: drop the Date.parse guard -> stores garbage)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "contact-duedate",
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Call me back", dueAt: "next Tuesday morning",
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows[0].payload.dueAt).toBeNull();
  });

  it("keeps a valid ISO-8601 dueAt", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "contact-duedate-2",
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Call me back", dueAt: "2026-09-23T09:00:00.000Z",
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows[0].payload.dueAt).toBe("2026-09-23T09:00:00.000Z");
  });

  // THE V1 TRUTH (fix-wave finding 2): every proposal from one call shares
  // that call's id, the hard-coded `kind: "task"` and that call's one
  // contact, so they all collide on the live unique index. Only the FIRST
  // lands; the rest are refused by the database, not by MAX_PER_CALL.
  it("writes only the first of several colliding task proposals from one call; the database's own unique index refuses the rest (mutation: `written++` unconditionally instead of `if (created) written++` -> FAILS)", async () => {
    const db = fakeDb();
    const three = Array.from({ length: 3 }, (_, i) => ({
      kind: "task", title: `Task ${i}`, dueAt: null,
      evidence: "Call me Tuesday morning",
    }));
    const n = await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: three }) });
    expect(n).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it("stops after MAX_PER_CALL attempts even when every insert is refused, not after all 20 candidates (mutation: cap the loop on `written` instead of `attempts` -> FAILS)", async () => {
    const db = fakeDbAlwaysRefusing();
    const many = Array.from({ length: 20 }, (_, i) => ({
      kind: "task", title: `Task ${i}`, dueAt: null,
      evidence: "Call me Tuesday morning",
    }));
    const n = await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: many }) });
    expect(n).toBe(0);
    expect(db.attempts).toHaveLength(3);
  });

  // Fix-wave Important 6, the `contact_field` twin of the test directly
  // above. PROVED: dropping `attempts++` from the `contact_field` branch left
  // 37/37 green because nothing forced that branch to be tried 20 times —
  // this is what forces it, and `db.attempts` (recorded on every real
  // `.insert()` call regardless of outcome) is what tells 3 apart from 20.
  it("stops after MAX_PER_CALL attempts for contact_field proposals too, even when every insert is refused (mutation: drop `attempts++` from the contact_field branch -> FAILS)", async () => {
    const db = fakeDbAlwaysRefusing();
    const many = Array.from({ length: 20 }, () => ({
      kind: "contact_field", field: "email", value: "sam@example.com",
      evidence: "my email is sam at example dot com",
    }));
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["email"], transcript: emailTranscript,
      fetchImpl: modelReturning({ proposals: many }),
    });
    expect(n).toBe(0);
    expect(db.attempts).toHaveLength(3);
  });

  // MAX_PER_CALL's own doc: the budget is SHARED ACROSS KINDS, not three per
  // kind. A call that yields one real `task` and one real `contact_field`
  // must write both (they don't collide — different `kind` in the unique
  // index's own key) and spend two of the three shared attempts doing it.
  it("writes one task and one contact_field from the same call, consuming two of the three shared attempts", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "c1", blankFields: ["email"], transcript: emailTranscript,
      fetchImpl: modelReturning({
        proposals: [
          { kind: "task", title: "Send a dining table quote", dueAt: null,
            evidence: "my email is sam at example dot com" },
          { kind: "contact_field", field: "email", value: "sam@example.com",
            evidence: "my email is sam at example dot com" },
        ],
      }),
    });
    expect(n).toBe(2);
    expect(db.rows).toHaveLength(2);
    expect(db.attempts).toHaveLength(2);
  });

  // CRITICAL 1 of the fix-wave: `JSON.stringify` turns `[undefined]` into
  // `[null]`, so both a deliberate null and a trailing-comma slip produce
  // this exact one-character shape. Before the fix this threw
  // `TypeError: Cannot read properties of null (reading 'kind')` straight
  // out of generateProposals, past its own "NEVER THROWS" doc comment.
  it("skips a null proposal element and still writes the valid one after it (mutation: remove the asRawProposal guard -> the null throws and aborts the rest of the array)", async () => {
    // PROVED by the fix-wave review: `{"proposals":[null]}` threw
    // `TypeError: Cannot read properties of null (reading 'kind')` before
    // this guard existed. A single element in the array can't distinguish
    // "guard skips it" from "the outer try/catch merely swallows the
    // throw" — both return 0 for a lone null. Putting a VALID proposal
    // after the null does distinguish them: without the guard, the null's
    // throw aborts the loop entirely and the valid entry after it is never
    // reached.
    const db = fakeDb();
    const fetchImpl = modelReturning({
      proposals: [null, { kind: "task", title: "Send a dining table quote",
                           dueAt: null, evidence: "Call me Tuesday morning" }],
    });
    const n = await generateProposals({ ...base, db, fetchImpl });
    expect(n).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it("skips non-object proposal elements and still writes the valid one after them", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({
      proposals: ["oops", 42, true, { kind: "task", title: "Send a dining table quote",
                                       dueAt: null, evidence: "Call me Tuesday morning" }],
    });
    const n = await generateProposals({ ...base, db, fetchImpl });
    expect(n).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it("returns already-written count instead of 0 when a later database call throws mid-loop (mutation: `return 0` in the catch instead of `return written` -> FAILS)", async () => {
    // A purpose-built fake, not `fakeDb()`: the first `.insert()` succeeds
    // normally, and the SECOND throws synchronously (an unexpected fault —
    // a dropped connection, not a normal refusal) to prove the catch
    // preserves whatever already landed rather than reporting 0.
    let calls = 0;
    const db: any = {
      from: () => ({
        insert: () => {
          calls++;
          if (calls === 1) {
            return { select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }) };
          }
          throw new Error("connection reset");
        },
      }),
    };
    const two = [
      { kind: "task", title: "First", dueAt: null, evidence: "Call me Tuesday morning" },
      { kind: "task", title: "Second", dueAt: null, evidence: "Call me Tuesday morning" },
    ];
    const n = await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: two }) });
    expect(n).toBe(1);
  });

  it("returns 0 and logs when the model responds with a non-OK status, even though the body itself parses fine (mutation: drop the `!r.ok` check -> FAILS)", async () => {
    // A body that would otherwise parse to a perfectly valid empty result —
    // an empty or malformed body would throw inside `r.json()`/`JSON.parse`
    // regardless of this check and get caught by the outer catch anyway,
    // which would make this test pass whether or not `!r.ok` exists. Only a
    // WELL-FORMED body on a non-2xx status isolates the check.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }],
    }), { status: 500 })) as unknown as typeof fetch;
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(db.rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![0])).toContain("HTTP 500");
    errorSpy.mockRestore();
  });

  it("returns 0 and logs a specific message when the model's proposals field is not an array (mutation: drop the Array.isArray guard -> FAILS)", async () => {
    // A NUMBER, not a string: `for...of` over a string iterates its
    // characters just fine, which would make this test pass with or
    // without the guard. A number is not iterable at all, so without the
    // guard the `for...of` throws and is caught by the generic outer catch
    // instead of this branch's own, more specific log line — this
    // assertion is what tells the two apart.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: 42 });
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(db.rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![0])).toContain("no proposals array");
    errorSpy.mockRestore();
  });

  it("logs a distinct error when the model call fails outright, and logs NOTHING when it simply returns no proposals", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb();
    await generateProposals({
      ...base, db,
      fetchImpl: vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![0])).toContain("call1");
    errorSpy.mockClear();

    await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: [] }) });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs when OPENAI_API_KEY is missing (mutation: drop the console.error in the missing-key branch -> FAILS)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.OPENAI_API_KEY;
    const db = fakeDb();
    const n = await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: [] }) });
    expect(n).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  // Task 4: on the one live account, spam and abandoned calls are the
  // DOMINANT traffic — several robocalls a day, every one ineligible. If the
  // OPENAI_API_KEY check ever runs before callIsEligible again, a rotated or
  // missing key logs an error line for EACH of those, and an alert that
  // fires on the dominant path stops being read. This pins the order: an
  // ineligible call must cost nothing at all, not even the missing-key log.
  it("costs nothing at all for an ineligible call when OPENAI_API_KEY is unset — no request, no log line (mutation: move the OPENAI_API_KEY check before callIsEligible -> logs the missing-key error and FAILS)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const priorKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    const n = await generateProposals({ ...base, db, outcome: "spam", fetchImpl });
    expect(n).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    process.env.OPENAI_API_KEY = priorKey;
    errorSpy.mockRestore();
  });

  it("requests JSON output explicitly, and pins the model, url and abort signal (mutation: drop response_format -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as any).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = requestBodyOf(fetchImpl);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
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
    expect(systemPromptOf(fetchImpl).toLowerCase()).toContain("wrong number");
  });

  it("tells the model dueAt must be an ISO-8601 instant or null (mutation: delete the dueAt-format line from SYSTEM -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, fetchImpl });
    expect(systemPromptOf(fetchImpl).toLowerCase()).toContain("iso-8601");
  });

  it("tells the model to write plain, everyday titles rather than codes or template syntax (mutation: delete the plain-language line from SYSTEM -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, fetchImpl });
    expect(systemPromptOf(fetchImpl).toLowerCase()).toContain("plain");
  });

  // Fix-wave Important 3. PROVED: before this pair existed, making
  // `systemFor` never add the `contact_field` sentence at all, AND making it
  // name all four fields instead of only the blank ones, each left the whole
  // suite green — the entire prompt half of Task 8 was unpinned. This test
  // asserts the sentence names ONLY the actually-blank field(s); a model told
  // to fill `firstName`/`lastName`/`phone` here (none of which are blank on
  // this contact) would be a real containment failure the propose-time guard
  // happens to catch downstream today, but the PROMPT should not be asking
  // for them regardless.
  it("names ONLY the blank fields in the contact_field instruction, never the full set (mutation: hardcode all four CONTACT_FIELDS regardless of blankFields -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, blankFields: ["email"], fetchImpl });
    const prompt = systemPromptOf(fetchImpl);
    expect(prompt).toContain("contact_field");
    // Extracts exactly the "<one of: ...>" list `systemFor` emits, rather
    // than substring-searching the whole prompt for "phone" — the BASE
    // SYSTEM sentence itself opens with "a finished phone call", so a bare
    // `.not.toContain("phone")` would fail on that unrelated word, not on
    // whether the allow-list was actually narrowed.
    const allowed = prompt.match(/one of: ([^>]+)>/)?.[1];
    expect(allowed).toBe("email");
  });

  // The other half of the same pair: with NO blank fields at all, the
  // `contact_field` instruction must be absent entirely, not merely empty —
  // a model that is never told it may propose a contact field cannot emit
  // one, which is the whole point of computing `blankFields` before this
  // call is ever made.
  it("omits the contact_field instruction entirely when there are no blank fields (mutation: always append the contact_field sentence -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, blankFields: [], fetchImpl });
    expect(systemPromptOf(fetchImpl).toLowerCase()).not.toContain("contact_field");
  });

  // Fix-wave finding 2: `callIsEligible` ends in `eligibility.ts:58`'s
  // `e.text.trim()`, and it used to run BEFORE this function's try block —
  // so a hostile transcript threw straight out of `generateProposals`, past
  // its own "NEVER THROWS" doc comment. `TranscriptEvent.text` is typed
  // `string`, so a real caller of this function cannot construct this input
  // through the type system — this is the boundary a future untyped read
  // (a jsonb column cast back with `as unknown as CallDetailRow`, exactly
  // what Task 5 does) can still hand it.
  it("does not throw when a transcript element's text is not a string (mutation: move callIsEligible back out of the try -> throws instead of returning 0)", async () => {
    const db = fakeDb();
    const hostileTranscript = [
      { role: "caller", text: 12345, at: "2026-09-18T12:00:00.000Z" },
    ] as unknown as TranscriptEvent[];
    await expect(generateProposals({
      ...base, db, transcript: hostileTranscript,
      fetchImpl: modelReturning({ proposals: [] }),
    })).resolves.toBe(0);
  });

  it("does not throw when the transcript array contains a null element (mutation: move callIsEligible back out of the try -> throws instead of returning 0)", async () => {
    const db = fakeDb();
    const hostileTranscript = [null] as unknown as TranscriptEvent[];
    await expect(generateProposals({
      ...base, db, transcript: hostileTranscript,
      fetchImpl: modelReturning({ proposals: [] }),
    })).resolves.toBe(0);
  });

  // Fix-wave finding 3: the SYSTEM prompt's own example ("2026-09-23T09:00:00.000Z")
  // is a full instant; a bare year is not, and Postgres's `timestamptz`
  // column refuses it outright (`select '2026'::timestamptz` errors live) —
  // so a proposal that passed this function's own `Date.parse` guard would
  // still fail at a human's accept click, after the review screen already
  // showed it as fine.
  it("normalizes a dueAt Postgres would refuse into a full ISO instant instead of storing it raw (mutation: store the raw trimmed string instead of new Date(trimmed).toISOString() -> stores \"2026\")", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db, contactId: "contact-bare-year",
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Call me back", dueAt: "2026",
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.rows[0].payload.dueAt).toBe("2026-01-01T00:00:00.000Z");
    expect(db.rows[0].payload.dueAt).not.toBe("2026");
  });

  // Fix-wave finding 4: this is the branch a real OpenAI refusal takes
  // (`message.content: null` with a `refusal` field) and the one a
  // truncated completion takes too. Every other log path in this file is
  // pinned by name; this one was not.
  it("returns 0 and logs a specific message when the model returns no content, the shape of a real refusal (mutation: drop the typeof content !== \"string\" guard, or delete its console.error -> FAILS)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: null } }],
    }), { status: 200 })) as unknown as typeof fetch;
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(db.rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![0])).toContain("no content");
  });

  // Minor 6: nothing bounds how many elements the model's own completion can
  // hand back before the loop's per-attempt cap even starts counting; a
  // flood of UNGROUNDED proposals still costs a full `groundedEvidence` scan
  // each. Bounding the completion's own token budget bounds the array that
  // can come back at all.
  it("bounds the model's own completion so a runaway proposals array cannot be returned (mutation: drop max_tokens from the request body -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    await generateProposals({ ...base, db, fetchImpl });
    const body = requestBodyOf(fetchImpl);
    expect(typeof body.max_tokens).toBe("number");
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});
