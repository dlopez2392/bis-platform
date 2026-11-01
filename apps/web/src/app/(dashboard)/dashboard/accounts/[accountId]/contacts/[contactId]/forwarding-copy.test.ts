import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { copyForwardingAddress, getForwardingAddress } from "./forwarding-copy";

const ADDRESS = "r-0123456789abcdef01234567@reply.bis-rgv.com";
const toasts = () => ({ success: vi.fn(), error: vi.fn() });

describe("copyForwardingAddress (spec §1: Copy toasts Copied, no Undo; plan G12: a refused clipboard says how by hand)", () => {
  it("a clipboard that takes it: the address is written and the toast says Copied (mutation: write the label instead → FAILS)", async () => {
    const clipboard = { writeText: vi.fn(async () => {}) };
    const toast = toasts();
    expect(await copyForwardingAddress(ADDRESS, clipboard, toast, "en")).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith(ADDRESS);
    expect(toast.success).toHaveBeenCalledWith("Copied");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Spanish: Copiado (mutation: drop the locale → English, FAILS)", async () => {
    const toast = toasts();
    await copyForwardingAddress(ADDRESS, { writeText: vi.fn(async () => {}) }, toast, "es");
    expect(toast.success).toHaveBeenCalledWith("Copiado");
  });

  it("a refused clipboard is a toast that says how to copy by hand, never a rejection (mutation: no catch → rejects, FAILS)", async () => {
    const toast = toasts();
    const refused = { writeText: vi.fn(async () => { throw new Error("NotAllowedError"); }) };
    await expect(copyForwardingAddress(ADDRESS, refused, toast, "en")).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy. Select the address and copy it by hand.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("no clipboard at all (an insecure page, an old browser): the same by-hand toast, in Spanish too", async () => {
    const en = toasts();
    await expect(copyForwardingAddress(ADDRESS, undefined, en, "en")).resolves.toBe(false);
    expect(en.error).toHaveBeenCalledWith("Couldn't copy. Select the address and copy it by hand.");
    expect(en.success).not.toHaveBeenCalled();
    const es = toasts();
    await copyForwardingAddress(ADDRESS, undefined, es, "es");
    expect(es.error).toHaveBeenCalledWith("No se pudo copiar. Seleccione la dirección y cópiela a mano.");
  });

  it("the toast carries no Undo (Copy changes nothing; mutation: pass an action → FAILS)", async () => {
    const toast = toasts();
    await copyForwardingAddress(ADDRESS, { writeText: vi.fn(async () => {}) }, toast, "en");
    expect(toast.success.mock.calls[0]).toHaveLength(1);
  });

  it("the handler is a plain module (constraints §13; mutation: add a directive → FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./forwarding-copy.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use (client|server)["'];?/m);
  });
});

describe("getForwardingAddress (owner ruling 2026-10-17: the address is made on click; constraints §13: a thrown action toasts common.actionCrashed)", () => {
  it("ok: answers the address, no error toast (mutation: answer null on ok -> FAILS)", async () => {
    const toast = toasts();
    expect(await getForwardingAddress(async () => ({ ok: true as const, address: ADDRESS }), toast, "en")).toBe(ADDRESS);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ok:false: null and a plain toast in both languages (mutation: toast the crash line here -> FAILS)", async () => {
    const en = toasts();
    expect(await getForwardingAddress(async () => ({ ok: false as const }), en, "en")).toBeNull();
    expect(en.error).toHaveBeenCalledWith("We couldn't make the forwarding address. Try again.");
    const es = toasts();
    await getForwardingAddress(async () => ({ ok: false as const }), es, "es");
    expect(es.error).toHaveBeenCalledWith("No pudimos crear la dirección para reenviar. Inténtelo de nuevo.");
  });

  it("a thrown action (a stale page, a dropped connection): null and the crash toast, never a rejection (mutation: no catch -> rejects, FAILS)", async () => {
    const toast = toasts();
    await expect(getForwardingAddress(async () => { throw new Error("Failed to find Server Action"); }, toast, "en")).resolves.toBeNull();
    expect(toast.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
    const es = toasts();
    await getForwardingAddress(async () => { throw new Error("x"); }, es, "es");
    expect(es.error).toHaveBeenCalledWith("Eso no se completó: puede que esta página esté desactualizada. Recárguela e inténtelo de nuevo.");
  });
});
