import { describe, it, expect } from "vitest";
import { conciergeStrings } from "./strings";

const EN = conciergeStrings("en");
const ES = conciergeStrings("es");

describe("the copy shown when a conversation has ended", () => {
  /**
   * The composer DISABLES itself the moment the route answers `ended: true`
   * (`c/[publicId]/concierge-chat.tsx`), so copy that asks the visitor to
   * leave a name and a number asks for something the UI refuses to accept.
   * The ask now happens earlier, in the prompt's budget notice, while they
   * can still type; this line is a close.
   */
  const ASKS_IN_ENGLISH = /\b(leave|send|reply|tell us|type|give us)\b/i;
  const ASKS_IN_SPANISH = /\b(d[ée]janos|d[ée]jenos|escr[íi]benos|env[íi]a|cu[ée]ntanos)\b/i;

  it("does not ask the visitor for anything, in either language", () => {
    expect(EN.ended).not.toMatch(ASKS_IN_ENGLISH);
    expect(ES.ended).not.toMatch(ASKS_IN_SPANISH);
  });

  it("says the chat is closed and what happens next", () => {
    expect(EN.ended.toLowerCase()).toContain("closed");
    expect(EN.ended.toLowerCase()).toContain("follow up");
    expect(ES.ended.toLowerCase()).toContain("cerrada");
  });
});

describe("the copy shown when a render token has expired (Minor, review of commit 129b43f)", () => {
  /**
   * A visitor who opens the page and comes back to type more than
   * MAX_TOKEN_AGE_MS (30 minutes) later is not a spammer and never opened a
   * conversation — `strings.ended` ("This chat is closed…") describes a chat
   * that ran and reached a limit, which is a different situation and the
   * wrong instruction (there is no "someone will follow up" to promise, and
   * no recovery but a reload).
   */
  it("tells the visitor to refresh, distinct from the closed-chat copy", () => {
    expect(EN.expired.toLowerCase()).toContain("refresh");
    expect(EN.expired).not.toBe(EN.ended);
    expect(ES.expired).not.toBe(ES.ended);
    expect(ES.expired).toBeTruthy();
  });
});

describe("the copy shown when a turn produced a lead and no words", () => {
  /**
   * A chat-completions turn that calls a tool routinely comes back with
   * `content: null`. Without a line of its own the visitor would read
   * "Something went wrong" on the exact turn their details were filed.
   */
  it("thanks them rather than reporting a failure", () => {
    expect(EN.captured).toBeTruthy();
    expect(ES.captured).toBeTruthy();
    expect(EN.captured.toLowerCase()).not.toContain("wrong");
    expect(ES.captured.toLowerCase()).not.toContain("error");
  });
});

describe("every concierge string", () => {
  it("carries no milestone codes, template syntax, or vendor jargon", () => {
    for (const strings of [EN, ES]) {
      for (const [key, value] of Object.entries(strings)) {
        expect(value, key).not.toMatch(/\bM[0-9][a-z]?\b/);
        expect(value, key).not.toMatch(/\{\{|\}\}/);
        expect(value, key).not.toMatch(/telnyx|openai|webhook|\bsip\b/i);
      }
    }
  });
});
