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

describe("the copy shown when a first message arrived before the page could have been read (Branch 2 hardening, item 4)", () => {
  /**
   * A fast typist is not a bot — this is deliberately DIFFERENT from the
   * honeypot/bad-signature copy (`ended`), which closes the chat outright.
   * The composer stays open here and the visitor can just send again.
   */
  it("is distinct from the closed-chat copy, in both languages", () => {
    expect(EN.tooFast).toBeTruthy();
    expect(ES.tooFast).toBeTruthy();
    expect(EN.tooFast).not.toBe(EN.ended);
    expect(ES.tooFast).not.toBe(ES.ended);
  });

  it("does not tell the visitor the chat is closed", () => {
    expect(EN.tooFast.toLowerCase()).not.toContain("closed");
    expect(ES.tooFast.toLowerCase()).not.toContain("cerrada");
  });
});

describe("the copy shown when this IP or account is over its conversation cap (Branch 2 hardening, item 1)", () => {
  /**
   * The spec's own stated reason for choosing 429 over the anti-oracle body:
   * a real visitor who hits one needs to know to come back later, which the
   * bare `{ error: "rate_limited" }` response cannot say on its own.
   */
  it("tells the visitor to come back later, honestly", () => {
    expect(EN.rateLimited).toBeTruthy();
    expect(ES.rateLimited).toBeTruthy();
    expect(EN.rateLimited.toLowerCase()).toMatch(/later|little while/);
    // Previously truthiness only — ES.rateLimited is "…inténtalo de nuevo
    // más tarde." (Item 3): pin the same "come back later" property in
    // Spanish rather than trusting a truthy check that any non-empty string
    // satisfies.
    expect(ES.rateLimited.toLowerCase()).toMatch(/más tarde|un rato|más adelante/);
  });
});

describe("the header close button's label (Task 6 review fold-in)", () => {
  /**
   * `concierge-chat.tsx`'s close button carried its own inline
   * `locale === "es" ? "Cerrar" : "Close"` ternary — an en/es literal this
   * catalogue exists precisely to hold, the same way `thinking`/`send`
   * already do. MUTATION: read `STRINGS.en.close` for both locales — this
   * FAILS, because a Spanish visitor would get an English label again.
   */
  it("is Close in English and Cerrar in Spanish, from the catalogue, not a literal", () => {
    expect(EN.close).toBe("Close");
    expect(ES.close).toBe("Cerrar");
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
