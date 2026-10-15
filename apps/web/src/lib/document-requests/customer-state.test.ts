import { describe, it, expect } from "vitest";
import type { DocumentRequestItem } from "@bis/db/document-rules";
import { m } from "@/lib/messages";
import {
  customerFileState, CUSTOMER_STATE_KEY, itemLabel, itemsSentence, nextCustomerPollMs, pollKey, formatPhone,
} from "./customer-state";

const ready = (scanStatus: string, scanSignature: string | null = null) => ({ ready: true, scanStatus, scanSignature });

describe("customerFileState: what the customer's page says about one file (spec 4.3)", () => {
  it("a file still uploading is not shown; pending reads Checking; clean reads Received (mutation: show an uploading file as checking -> FAILS)", () => {
    expect(customerFileState({ ready: false, scanStatus: "pending", scanSignature: null })).toBeNull();
    expect(customerFileState({ ready: false, scanStatus: "clean", scanSignature: null })).toBeNull();
    expect(customerFileState(ready("pending"))).toBe("checking");
    expect(customerFileState(ready("clean"))).toBe("received");
  });

  it("a removed file says why, through 2a's removedReason: a virus, a password (Heuristics.Encrypted.*), or unscannable (mutation: map unscannable-with-password to unscannable -> FAILS)", () => {
    expect(customerFileState(ready("infected", "Win.Test.EICAR_HDB-1"))).toBe("virus");
    expect(customerFileState(ready("unscannable", "Heuristics.Encrypted.PDF"))).toBe("password");
    expect(customerFileState(ready("unscannable", "Heuristics.Encrypted.Zip"))).toBe("password");
    expect(customerFileState(ready("unscannable", null))).toBe("unscannable");
    expect(customerFileState(ready("unscannable", "Heuristics.Limits.Exceeded"))).toBe("unscannable");
  });

  it("each state has its own words, in English and Spanish (mutation: received pointing at checking's key -> FAILS)", () => {
    expect(Object.fromEntries(Object.entries(CUSTOMER_STATE_KEY).map(([k, key]) => [k, [m[key], m[`${key}.es` as keyof typeof m]]]))).toEqual({
      checking: ["Checking", "Revisando"],
      received: ["Received", "Recibido"],
      virus: ["It had a virus.", "Tenía un virus."],
      password: ["It has a password: remove it and upload it again.", "Tiene contraseña: quítela y vuelva a subirlo."],
      unscannable: ["We couldn't check it. Try another copy.", "No pudimos revisarlo. Pruebe con otra copia."],
    });
  });
});

describe("itemLabel / itemsSentence: the request's items in the request's language", () => {
  const insurance: DocumentRequestItem = { key: "insurance", category: "insurance", note: null };
  const permit: DocumentRequestItem = { key: "permit", category: "permit", note: null };
  const other: DocumentRequestItem = { key: "other", category: "other", note: "Roof photos from 2019" };

  it("a category reads its catalogue words per language; 'other' reads its own note (mutation: English for a Spanish request -> FAILS; mutation: 'Other' for the other item -> FAILS)", () => {
    expect(itemLabel(insurance, "es")).toBe(m["documents.category.insurance.es"]);
    expect(itemLabel(insurance, "es")).toBe("Seguro");
    expect(itemLabel(insurance, "en")).toBe("Insurance");
    expect(itemLabel(other, "es")).toBe("Roof photos from 2019");
    expect(itemLabel(other, "en")).toBe("Roof photos from 2019");
  });

  it("the sentence joins the labels with ', ' in the request's order (mutation: join with ' and ' -> FAILS)", () => {
    expect(itemsSentence([permit, insurance, other], "es")).toBe("Permiso o licencia, Seguro, Roof photos from 2019");
    expect(itemsSentence([insurance], "en")).toBe("Insurance");
  });
});

describe("nextCustomerPollMs: re-read while a file is Checking, by the YOUNGEST Checking file's own age (plan review I9, M6)", () => {
  it("5 s in a Checking file's first minute, 15 s after it", () => {
    expect(nextCustomerPollMs([{ state: "checking", ageMs: 1_000 }])).toBe(5_000);
    expect(nextCustomerPollMs([{ state: "checking", ageMs: 60_000 }])).toBe(5_000);
    expect(nextCustomerPollMs([{ state: "checking", ageMs: 61_000 }])).toBe(15_000);
  });

  it("the YOUNGEST checking file decides (mutation: the oldest -> FAILS)", () => {
    expect(nextCustomerPollMs([{ state: "checking", ageMs: 61_000 }, { state: "checking", ageMs: 2_000 }])).toBe(5_000);
    // A received file younger than both does not count: only Checking files are waited for.
    expect(nextCustomerPollMs([{ state: "received", ageMs: 0 }, { state: "checking", ageMs: 61_000 }])).toBe(15_000);
  });

  it("stops after 15 minutes (mutation: never give up -> FAILS)", () => {
    expect(nextCustomerPollMs([{ state: "checking", ageMs: 15 * 60_000 }])).toBe(15_000);
    expect(nextCustomerPollMs([{ state: "checking", ageMs: 15 * 60_000 + 1 }])).toBeNull();
  });

  it("nothing Checking, nothing to wait for (mutation: keep polling with nothing checking -> FAILS)", () => {
    expect(nextCustomerPollMs([{ state: "received", ageMs: 0 }])).toBeNull();
    expect(nextCustomerPollMs([{ state: "virus", ageMs: 0 }, { state: "password", ageMs: 0 }, { state: "unscannable", ageMs: 0 }])).toBeNull();
    expect(nextCustomerPollMs([])).toBeNull();
  });

  it("pollKey changes on EVERY read, or the timer fires once (2a's defect; mutation: drop reads from the key -> FAILS)", () => {
    expect(pollKey(5_000, 1)).not.toBe(pollKey(5_000, 2));
    expect(pollKey(5_000, 1)).not.toBe(pollKey(15_000, 1));
    expect(pollKey(null, 1)).not.toBe(pollKey(5_000, 1));
  });
});

describe("formatPhone: the business's number as a person reads it", () => {
  it("a US/Canada number reads (956) 555-0123; any other is returned unchanged (mutation: always format -> FAILS)", () => {
    expect(formatPhone("+19565550123")).toBe("(956) 555-0123");
    expect(formatPhone("+525512345678")).toBe("+525512345678");
    expect(formatPhone("+4420794600000")).toBe("+4420794600000");
  });
});
