import { describe, it, expect } from "vitest";
import { contactSourceHint } from "./lead-source";

/**
 * F-157's drawer line. `contactSourceHint` is the READ-ONLY half shown next
 * to the editable `source` field — the system's own fact, never something
 * the owner types over. Priority, each strictly more specific than the
 * next: a word-of-mouth referral the source question captured
 * (`custom.referred_by`), then the attribution channel (AI assistant named
 * specifically, else the Website section's own bucket, "Direct" excluded as
 * uninformative), then — only once `source` itself is also empty — "Source
 * unknown" in plain words. A `source` that is already something (a form
 * name, "voice", "booking", an owner's own note) and no richer fact beyond
 * it needs no caption at all: null.
 */
describe("contactSourceHint", () => {
  it("names the specific AI assistant from the first-touch referrer (mutation: use channelOf's generic bucket here too → 'AI assistants' !== 'ChatGPT', FAILS)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://chat.openai.com/c/abc" } },
    });
    expect(hint).toBe("Found through ChatGPT");
  });

  it("gemini.google.com reads as Gemini, never Google (the exact miscount the plan names)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://gemini.google.com/app" } },
    });
    expect(hint).toBe("Found through Gemini");
  });

  it("falls back to the generic channel for a non-assistant referrer", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://www.google.com/search?q=roofing" } },
    });
    expect(hint).toBe("Found through Google");
  });

  it("a Direct referrer (no ref at all, or an empty one) is uninformative and caps nothing (mutation: treat Direct as a real channel → FAILS, this would say 'Found through Direct')", () => {
    // "Yelp" deliberately, not "booking"/"voice": those are now RECOGNIZED
    // machine values (m3, below) and would get their own caption, muddying
    // what this test is actually about.
    expect(contactSourceHint({ source: "Yelp", custom: null, attribution: { first: { ref: "" } } })).toBeNull();
    expect(contactSourceHint({ source: "Yelp", custom: null, attribution: {} })).toBeNull();
    expect(contactSourceHint({ source: "Yelp", custom: null, attribution: null })).toBeNull();
  });

  // Review round 1, I3b: none of the three cases above reach `channelOf`
  // with a non-empty `ref` at all — `""` and a missing `first`/`attribution`
  // all return before `channelOf` is ever called, so a mutant that replaced
  // the ternary on lead-source.ts's own "Direct" line with a bare
  // `return channel;` passed every test above. `about:` has no authority
  // component at all, so its hostname is genuinely "" — channelOf("")
  // itself answers "Direct" the normal way, exercising the real branch.
  it("a non-empty ref that itself resolves to Direct (an opaque URL with no host) is still uninformative (mutation: 'return channel;' instead of the Direct check → FAILS)", () => {
    const hint = contactSourceHint({
      source: "Yelp", custom: null, attribution: { first: { ref: "about:blank" } },
    });
    expect(hint).toBeNull();
  });

  // Review round 1, I2: a referrer on the CLIENT'S OWN site — the visitor
  // merely clicked from one of the client's own pages onto the one
  // carrying the embedded form (embed-script.ts's document.referrer is the
  // HOST page's own referrer, not the widget's) — states nothing about
  // where the LEAD came from and must read as no signal, never as a real
  // channel ("Other websites").
  it("a referrer on the SAME site as the page carrying the form is no signal, not 'Other websites' (mutation: drop the same-site check → FAILS)", () => {
    const hint = contactSourceHint({
      source: "Yelp", custom: null,
      attribution: { first: { ref: "https://rioroofing.com/services", page: "https://rioroofing.com/contact" } },
    });
    expect(hint).toBeNull();
  });

  it("the same-site check normalises a leading www. on either side", () => {
    const hint = contactSourceHint({
      source: "Yelp", custom: null,
      attribution: { first: { ref: "https://www.rioroofing.com/services", page: "https://rioroofing.com/contact" } },
    });
    expect(hint).toBeNull();
  });

  it("a genuinely different site still counts, even with a page recorded (mutation: compare only ref, ignore page → still passes this one, but see the same-site test above)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: null,
      attribution: { first: { ref: "https://www.google.com/search", page: "https://rioroofing.com/contact" } },
    });
    expect(hint).toBe("Found through Google");
  });

  it("a referred-by answer outranks the attribution channel (mutation: swap the priority → FAILS)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us",
      custom: { referred_by: "Jane Smith" },
      attribution: { first: { ref: "https://chat.openai.com/" } },
    });
    expect(hint).toBe("Referred by Jane Smith");
  });

  it("nothing captured at all says so in plain words, never guessed (mutation: return null here → the drawer shows a blank indistinguishable from 'not built yet', FAILS)", () => {
    expect(contactSourceHint({ source: null, custom: null, attribution: null })).toBe("Source unknown");
  });

  it("an owner-typed source with no richer fact and no recognized machine shape needs no caption (mutation: always return a string → FAILS, the line would double up with the editable value)", () => {
    expect(contactSourceHint({ source: "Yelp", custom: null, attribution: null })).toBeNull();
  });

  it("malformed custom/attribution (never trusted jsonb) are read as absent, not thrown (mutation: cast instead of check → throws on a string custom, FAILS)", () => {
    expect(() => contactSourceHint({ source: null, custom: "not an object", attribution: "also not an object" }))
      .not.toThrow();
    expect(contactSourceHint({ source: null, custom: "not an object", attribution: "also not an object" }))
      .toBe("Source unknown");
  });

  // Review round 1, m1: `String.prototype.replace` with a STRING
  // replacement treats `$&`/`$1`/`$$` etc specially — a referral answer
  // containing a literal "$&" would have it swapped for the MATCHED
  // pattern ("{name}") rather than kept as typed. A function replacement
  // has no such special-casing.
  it("a referred-by answer containing a literal $& is not swapped for the matched placeholder (mutation: .replace(\"{name}\", referredBy) → FAILS)", () => {
    const hint = contactSourceHint({
      source: "form: Contact us", custom: { referred_by: "ask $& about it" }, attribution: null,
    });
    expect(hint).toBe("Referred by ask $& about it");
  });

  it("a blank referred_by (whitespace only) is treated as not answered", () => {
    const hint = contactSourceHint({
      source: "Yelp", custom: { referred_by: "   " }, attribution: null,
    });
    expect(hint).toBeNull();
  });

  // Review round 1, m3: the raw `source` column's known machine values get a
  // humanized caption beside the (still raw, still editable) value — never
  // replacing it, same relationship the channel hint already has.
  describe("a humanized caption for the raw machine values 'source' stores (m3)", () => {
    it("voice (mutation: drop the voice case → FAILS)", () => {
      expect(contactSourceHint({ source: "voice", custom: null, attribution: null })).toBe("They called in");
    });
    it("booking", () => {
      expect(contactSourceHint({ source: "booking", custom: null, attribution: null })).toBe("They booked online");
    });
    // Review round 2, item 1: `source: "form: {name}"` is written by
    // enrich.ts for EVERY intake that calls it — a typed-in web form
    // submission, a web-chat lead (lib/concierge/lead.ts:168 calls the
    // SAME enrich()), and the retired shared-secret machine intake, all
    // against the owner's destination form. "They filled out the form" is
    // false for a chat lead, who never filled out anything.
    it("form: X names the form with wording true for a typed form, a web-chat lead and the (retired) machine intake alike (mutation: drop the {name} substitution → FAILS)", () => {
      expect(contactSourceHint({ source: "form: Contact us", custom: null, attribution: null }))
        .toBe("Came in through your “Contact us” form");
    });
    it("an owner's own typed note (anything else) gets no caption — nothing machine-made to translate (mutation: caption every non-empty source → FAILS)", () => {
      expect(contactSourceHint({ source: "Met at the Valley Expo", custom: null, attribution: null })).toBeNull();
      expect(contactSourceHint({ source: "Yelp", custom: null, attribution: null })).toBeNull();
    });
    it("the channel hint still outranks the machine-value caption when both exist", () => {
      const hint = contactSourceHint({
        source: "booking", custom: null, attribution: { first: { ref: "https://chat.openai.com/" } },
      });
      expect(hint).toBe("Found through ChatGPT");
    });
  });

  // Review round 1, m7 (ASSUMPTION: some AI assistants are commonly
  // reported to append utm_source to shared links — e.g. utm_source=chatgpt.com
  // — unverified against any real traffic in this repo; the hostnames/utm
  // values recognised here are the same list channel.ts already carries for
  // F-157's rider, not independently confirmed). Checked ONLY when `ref`
  // itself gives no signal at all.
  describe("utm_source names an AI assistant when ref gives no signal (m7, ASSUMPTION)", () => {
    it("recognises utm_source=chatgpt.com with no ref at all (mutation: ignore utm_source → FAILS)", () => {
      const hint = contactSourceHint({
        source: "form: Contact us", custom: null, attribution: { first: { utm_source: "chatgpt.com" } },
      });
      expect(hint).toBe("Found through ChatGPT");
    });

    // Review round 2, item 2: "newsletter" is never recognised by
    // aiAssistantNameOf either way, so the ORIGINAL version of this test
    // passed regardless of which signal was tried first — swapping
    // channelFromRef(first) ?? channelFromUtmSource(first) to the other
    // order left it green. utm_source="chatgpt.com" IS recognised, so the
    // swap now actually changes the answer.
    it("ref is tried FIRST — a real Google ref wins even with a RECOGNISED utm_source present (mutation: swap the ?? order → 'Found through ChatGPT', FAILS)", () => {
      const hint = contactSourceHint({
        source: "form: Contact us", custom: null,
        attribution: { first: { ref: "https://www.google.com/search", utm_source: "chatgpt.com" } },
      });
      expect(hint).toBe("Found through Google");
    });

    it("an unrecognised utm_source is not guessed as an assistant", () => {
      const hint = contactSourceHint({
        source: "Yelp", custom: null, attribution: { first: { utm_source: "newsletter" } },
      });
      expect(hint).toBeNull();
    });

    it("a same-site ref still falls through to utm_source (the same-site rule is about ref's OWN signal, not about silencing a real utm tag)", () => {
      const hint = contactSourceHint({
        source: "form: Contact us", custom: null,
        attribution: {
          first: {
            ref: "https://rioroofing.com/services", page: "https://rioroofing.com/contact",
            utm_source: "chatgpt.com",
          },
        },
      });
      expect(hint).toBe("Found through ChatGPT");
    });
  });
});

// Review round 1, m2 added a `clampHint` here (a JS-side slice to 120
// chars, tested in this spot). Review round 2, minor 4: removed — it cut
// by UTF-16 code unit (a surrogate pair could split) and its only caller,
// source-field.tsx, now clamps the FULL, unsliced hint visually with CSS
// (`truncate`) instead. See that file's own test for the new behaviour.
