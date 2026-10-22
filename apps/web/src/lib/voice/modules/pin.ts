// S-47b (spec section 5.1, SD8): the text-hash pin. Server and tests only (node:crypto). The corpus runner
// prints moduleTextSha256 into every results sheet, so a graded sheet is bound to exact words.
import { createHash } from "node:crypto";
import type { TradeModule, TradeModuleContext, TradeModuleId } from "./index";

/** Every context a block can see: 3 media x handoff x canBook = 12. businessName is fixed: it is data. */
export const PIN_CONTEXTS: readonly TradeModuleContext[] = (["phone", "web", "web_voice"] as const).flatMap(
  (medium) => [false, true].flatMap((handoffAvailable) => [false, true].map((canBook) => ({
    businessName: "Pin Test Co", medium, handoffAvailable, canBook,
  }))),
);

export function moduleTextSha256(mod: Pick<TradeModule, "heading" | "block">): string {
  const h = createHash("sha256");
  h.update(mod.heading);
  for (const ctx of PIN_CONTEXTS) h.update(`\u0000${JSON.stringify(ctx)}\n${mod.block(ctx).join("\n")}`);
  return h.digest("hex");
}

/**
 * APPEND-ONLY. Index N-1 is the sha256 of VERSION N's words. Changing a module's words means: bump its
 * VERSION, APPEND the new hash here, re-run the corpus for the new version. Never edit an existing entry:
 * once a version is graded, its results sheet records this hash and corpus.test.ts fails if they differ.
 */
export const SHA256_HISTORY: Readonly<Record<TradeModuleId, readonly string[]>> = {
  insurance_pc: ["871d340f7626489ca98cd0dedf643da136a43e5e6520198fa30f35c349799874"],
  events: ["e9db9a25be740d84931d3e7ce645b2426eada6c0808abc72e1f7eee6439c697a"],
};
