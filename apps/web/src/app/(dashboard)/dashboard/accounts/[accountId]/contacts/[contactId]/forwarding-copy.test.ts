import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { copyForwardingAddress } from "./forwarding-copy";

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
