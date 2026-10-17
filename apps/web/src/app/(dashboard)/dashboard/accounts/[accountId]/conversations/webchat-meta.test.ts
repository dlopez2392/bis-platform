import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWebchatMeta, firstWebchatRows } from "./webchat-meta";

const CHAT = "11111111-1111-4111-8111-111111111111";
const meta = (index: number, extra: Record<string, unknown> = {}) => ({ webchat: { chat_id: CHAT, index, locale: "es", submission_id: "s1", matched_existing: true, ...extra } });

describe("readWebchatMeta (S-06 part 3, spec §2, §5a)", () => {
  it("reads what the sync wrote; any other language reads as English (mutation: pass the locale through → 'fr', FAILS)", () => {
    expect(readWebchatMeta(meta(3))).toEqual({ chatId: CHAT, index: 3, locale: "es", matchedExisting: true });
    expect(readWebchatMeta(meta(0, { locale: "fr", matched_existing: "yes" }))).toEqual({ chatId: CHAT, index: 0, locale: "en", matchedExisting: false });
  });
  it("anything else is not a chat row's meta (mutation: accept a string index → FAILS)", () => {
    for (const bad of [null, {}, { webchat: null }, { webchat: { chat_id: CHAT, index: "0" } }, { webchat: { chat_id: "", index: 0 } }, { webchat: { chat_id: CHAT, index: -1 } }, { webchat: { chat_id: CHAT, index: 1.5 } }]) {
      expect(readWebchatMeta(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("firstWebchatRows: where each chat's one line sits (spec §5a)", () => {
  it("the row with each chat's LOWEST index on this thread, whatever the order it arrives in (mutation: first in array order → m3, FAILS)", () => {
    const rows = [
      { id: "m3", channel: "webchat", meta: meta(3) }, { id: "m1", channel: "webchat", meta: meta(1) },
      { id: "x0", channel: "webchat", meta: { webchat: { chat_id: "22222222-2222-4222-8222-222222222222", index: 0 } } },
      { id: "e1", channel: "email", meta: meta(0) },
    ];
    expect([...firstWebchatRows(rows)].sort()).toEqual(["m1", "x0"]);
  });
});

describe("import sites (the client/server boundary, part 1 Task 11b)", () => {
  it("the thread, a server component, imports the reader from this plain module, and this module has no directive (mutation: move readWebchatMeta into a 'use client' file → FAILS)", () => {
    const thread = readFileSync(path.join(__dirname, "message-thread.tsx"), "utf8");
    expect(thread).toMatch(/import \{ readWebchatMeta, firstWebchatRows \} from "\.\/webchat-meta";/);
    expect(readFileSync(path.join(__dirname, "webchat-meta.ts"), "utf8")).not.toMatch(/^["']use (client|server)["']/m);
  });
});
