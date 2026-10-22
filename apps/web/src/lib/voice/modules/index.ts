// S-47b (spec section 5.1): Sofía's trade modules. The registry the prompt, the stamp, the Voice page and
// the corpus runner all read. One versioned file per module (owner decision B6): the words live in code, so
// untested wording can never reach a live client from a database row.
//
// Pure and crypto-free: system-prompt.ts imports this. The hash pin lives in ./pin.ts.
import type { TradeModuleSetting } from "@bis/db";
import * as insurancePc from "./insurance-pc";
import * as events from "./events";

/** The twin of voice_profiles_trade_module_check (0094). */
export type TradeModuleId = TradeModuleSetting;

/**
 * What a block may depend on, and nothing else:
 *  - `medium`: "phone" (the live line), "web" (the website chat), "web_voice" (the browser voice demo, which
 *    has NO tools: spec deviation SD1).
 *  - `handoffAvailable`: a transfer number is set for this call (only the phone can offer to connect).
 *  - `canBook`: a NEW booking may be made on this session (bookingMode "full", never on the web; SD2).
 */
export type TradeModuleContext = {
  businessName: string;
  medium: "phone" | "web" | "web_voice";
  handoffAvailable: boolean;
  canBook: boolean;
};

export type TradeModule = {
  id: TradeModuleId; version: number; heading: string;
  block: (ctx: TradeModuleContext) => string[];
};

/** What a call row and a chat row record: the module and the VERSION whose words ran. */
export type TradeModuleStamp = { module: TradeModuleId; version: number };

export const TRADE_MODULES: Readonly<Record<TradeModuleId, TradeModule>> = {
  insurance_pc: { id: "insurance_pc", version: insurancePc.VERSION, heading: insurancePc.HEADING, block: insurancePc.block },
  events: { id: "events", version: events.VERSION, heading: events.HEADING, block: events.block },
};

/** In the order the Voice page lists them (after "None"). */
export const TRADE_MODULE_IDS = ["insurance_pc", "events"] as const satisfies readonly TradeModuleId[];

/**
 * The lines buildSystemPrompt appends right after HARD LIMITS: a blank line, the heading, then the
 * module's own lines. No module, or an id this build does not know (a row written by a newer build, after
 * a rollback), gives NO lines at all: the general rules only, so the prompt is byte-identical to a profile
 * with none. tradeModuleStamp answers null for exactly the same ids, so the stamp never claims rules the
 * prompt did not carry.
 */
export function tradeModuleBlock(id: TradeModuleId | null | undefined, ctx: TradeModuleContext): string[] {
  if (id === null || id === undefined) return [];
  const mod = (TRADE_MODULES as Partial<Record<string, TradeModule>>)[id];
  if (!mod) return [];
  return ["", mod.heading, ...mod.block(ctx)];
}

export function tradeModuleStamp(id: TradeModuleId | null | undefined): TradeModuleStamp | null {
  if (id === null || id === undefined) return null;
  const mod = (TRADE_MODULES as Partial<Record<string, TradeModule>>)[id];
  return mod ? { module: mod.id, version: mod.version } : null;
}
