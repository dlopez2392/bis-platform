// The positives here are VERBATIM from production — nine calls to 956
// Woodworks on 2026-09-17, the only real client on the platform. Every one was
// recorded as `abandoned`, which told the owner he had lost nine customers in
// one day.
//
// The negatives matter more than the positives. A false positive hangs up on a
// paying customer and leaves no trace they ever called, which is strictly worse
// than a robocall getting through — so the negatives are written to be hostile:
// real callers who mention Google, who ramble at length, who read out a number,
// who talk about pressing things.
import { describe, it, expect } from "vitest";
import { looksLikeRecordedMessage } from "./recorded-message";

/** The exact text the robot delivered, from `calls.transcript`. */
const REAL_ROBOCALL =
  "Hello, please don't hang up the phone. This is an important message regarding " +
  "your Google business account. Our system shows a new search for your business " +
  "via Google, and Google Voice clients are currently having trouble finding you. " +
  "Press 0 to speak with an agent immediately and verify your Google listings. " +
  "Again, your business is not showing correctly on Google and Google Voice " +
  "search. Press 0 to speak to an agent, press 9 to opt out, or call " +
  "877-556-9255. Thank you.";

describe("looksLikeRecordedMessage — the positives, verbatim from production", () => {
  it("catches the Google-listing robocall that hit 956 Woodworks nine times", () => {
    expect(looksLikeRecordedMessage(REAL_ROBOCALL)).toBe(true);
  });

  it("catches it when the transcriber punctuates differently", () => {
    // Whisper is not deterministic about commas, casing or the digit form, and
    // a guard that only matches one transcription of one recording is a guard
    // that stops working the next time the same robot calls.
    expect(looksLikeRecordedMessage(
      "hello please dont hang up the phone this is an important message regarding " +
      "your google business account press zero to speak with an agent press nine " +
      "to opt out",
    )).toBe(true);
  });

  it("catches an IVR instruction with no opt-out clause at all", () => {
    // BOTH HALVES OF THE `||` HAVE TO EARN THEIR PLACE. Every positive above
    // happens to contain the press-instruction AND the opt-out, so with only
    // those, changing `||` to `&&` — or deleting either regex — would leave
    // this file green. Broadcasters are not obliged to offer an opt-out.
    expect(looksLikeRecordedMessage(
      "This is an urgent notice concerning the warranty on your vehicle, which " +
      "our records show is about to expire. Press 1 to speak with a warranty " +
      "specialist about renewing your coverage today.",
    )).toBe(true);
  });

  it("catches an opt-out clause with no press instruction at all", () => {
    // The other half. Some recordings say "reply" or give a callback number
    // instead of a keypad instruction, but still read out the opt-out because
    // somebody's compliance team made them.
    expect(looksLikeRecordedMessage(
      "Good afternoon, this message is regarding an important update to your " +
      "business listing that requires your attention before the end of the " +
      "month. Call us back on 877-555-0100, or reply to this message to be " +
      "removed from our list.",
    )).toBe(true);
  });

  it("catches the shape without the Google pretext at all", () => {
    // The pretext is whatever the scam of the month is. The IVR instruction is
    // the part that makes it a recording rather than a person, so that is what
    // this keys on — a different script with the same shape must still be
    // caught.
    expect(looksLikeRecordedMessage(
      "This is a final notice about your vehicle warranty. Press 1 to speak " +
      "with a specialist, or press 9 to be removed from our list.",
    )).toBe(true);
  });
});

describe("looksLikeRecordedMessage — the negatives, which cost more to get wrong", () => {
  it("a customer who found them on Google is NOT a robocall", () => {
    // THE most important negative, and it has to be LONG ENOUGH TO BE JUDGED.
    // The first version of this test was 66 characters, so the length floor
    // rejected it before any keyword could matter — which meant the claim
    // "never keyed on Google" was untested, and a mutation adding a Google
    // rule passed. Now it is past the floor, so only the ABSENCE of that rule
    // keeps it false.
    //
    // Keying on "Google" was the obvious heuristic: the word appears five
    // times in the real robocall. It would hang up on this caller — a real
    // lead — silently, with the owner never learning they rang.
    expect(looksLikeRecordedMessage(
      "Hi there, I found you on Google when I was searching for custom furniture " +
      "makers around McAllen, and your photos looked great. I wanted to ask about " +
      "getting a dining table made for eight people, in oak if you have it.",
    )).toBe(false);
  });

  it("a customer reading out their phone number is not a robocall", () => {
    expect(looksLikeRecordedMessage(
      "Sure, my number is 956-555-0134, you can reach me any time after five.",
    )).toBe(false);
  });

  it("a customer who talks about pressing something is not a robocall", () => {
    // "press" alone is a word people use, and this negative has to use it as a
    // WHOLE WORD past the length floor to prove anything. The first version
    // said "presses", which \bpress\b does not match either way — so a
    // mutation keying on the bare verb passed, and the instruction-shape
    // requirement went untested.
    expect(looksLikeRecordedMessage(
      "So the veneer work — do you press it yourself in the shop, or does that go " +
      "out somewhere? My father-in-law used to press his own and swore the glue " +
      "line was better that way. Either is fine by me, I just wondered.",
    )).toBe(false);
  });

  it("a long rambling customer is not a robocall", () => {
    // Length alone is not the signal. Plenty of real callers monologue,
    // especially older ones and especially on a first call.
    expect(looksLikeRecordedMessage(
      "Hi there, so my wife and I have been talking about redoing the kitchen for " +
      "about two years now and we finally decided to go ahead with it, and someone " +
      "at church mentioned that you all do custom cabinets, so I wanted to call and " +
      "see whether you could come out and take a look and give us some idea of what " +
      "something like that would run, because we have no idea what to expect really.",
    )).toBe(false);
  });

  it("a Spanish-speaking customer is not a robocall", () => {
    expect(looksLikeRecordedMessage(
      "Buenos días, quería preguntar por una mesa de comedor de madera.",
    )).toBe(false);
  });

  it("an empty or whitespace turn is not a robocall", () => {
    // The silence guard owns that case and classifies it `spam` already. This
    // guard must not also claim it, or two guards write the same outcome for
    // different reasons and neither log explains the other.
    expect(looksLikeRecordedMessage("")).toBe(false);
    expect(looksLikeRecordedMessage("   ")).toBe(false);
  });

  it("a short answer is never a robocall, whatever words it contains", () => {
    // These carry a COMPLETE instruction and a COMPLETE opt-out clause, so the
    // LENGTH FLOOR is the only thing that can reject them. That is the point:
    // the first version of this test used "press 1", which the instruction
    // regex rejects on its own, so dropping the floor entirely left this file
    // green and the floor was protecting nothing anybody checked.
    //
    // Why a fragment must not be judged: the transcriber cuts turns, and a
    // caller repeating an instruction back ("press 9 to opt out — is that what
    // you mean?") is a person asking a question, not a broadcast.
    expect(looksLikeRecordedMessage("press 9 to opt out")).toBe(false);
    expect(looksLikeRecordedMessage("Press 1 to speak with someone")).toBe(false);
    expect(looksLikeRecordedMessage("press 1")).toBe(false);
    expect(looksLikeRecordedMessage("yes please")).toBe(false);
  });
});
