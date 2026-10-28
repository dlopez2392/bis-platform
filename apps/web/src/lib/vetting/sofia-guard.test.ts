import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ getAccountTrade: vi.fn() }));
const serviceDbInstance = vi.hoisted(() => ({ __serviceDb: true }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => serviceDbInstance,
}));

import { m } from "@/lib/messages";
import { sofiaSwitchOnRefusal } from "./sofia-guard";

// Braced (plan review I2): a bare arrow would RETURN the mock, and vitest runs a function returned from
// beforeEach as a teardown.
beforeEach(() => { dbMocks.getAccountTrade.mockReset(); });

describe("sofiaSwitchOnRefusal", () => {
  it("lets an allowed trade switch on, reading the company's own trade on the service client", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "hvac", tradeOther: null });
    expect(await sofiaSwitchOnRefusal("a1")).toBeNull();
    expect(dbMocks.getAccountTrade).toHaveBeenCalledWith(serviceDbInstance, "a1");
  });
  it("lets Other (allowed, with its description) switch on", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "other", tradeOther: "Marketing agency" });
    expect(await sofiaSwitchOnRefusal("a1")).toBeNull();
  });
  it("refuses a crm_only trade, naming it", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    expect(await sofiaSwitchOnRefusal("a1")).toBe("Sofía and the web chat aren't available for restaurant businesses yet.");
    expect(await sofiaSwitchOnRefusal("a1", "es")).toBe("Sofía y el chat del sitio web aún no están disponibles para el giro restaurante.");
  });
  it("refuses no trade", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: null, tradeOther: null });
    expect(await sofiaSwitchOnRefusal("a1")).toBe(m["vetting.sofia.noTrade"]);
    expect(await sofiaSwitchOnRefusal("a1", "es")).toBe(m["vetting.sofia.noTrade.es"]);
  });
  it("fails CLOSED when the trade cannot be read (mutation: return null in the catch -> FAILS)", async () => {
    dbMocks.getAccountTrade.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sofiaSwitchOnRefusal("a1")).toBe(m["vetting.readFailed"]);
    expect(await sofiaSwitchOnRefusal("a1", "es")).toBe(m["vetting.readFailed.es"]);
    errSpy.mockRestore();
  });
});
