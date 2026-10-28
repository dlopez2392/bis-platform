import type { JobHandler } from "./types";
import { platformPing } from "./platform-ping";

/**
 * Every job kind the drain can claim, typed like PASSES: one line per kind.
 * Adding a job = one handler file plus one entry here.
 */
export const JOB_HANDLERS = {
  [platformPing.kind]: platformPing,
} as const satisfies Record<string, JobHandler<unknown>>;

export type JobKind = keyof typeof JOB_HANDLERS;
export type JobPayload<K extends JobKind> = ReturnType<(typeof JOB_HANDLERS)[K]["parse"]>;

/** The handler map's own keys — what the drain claims against. */
export const JOB_KINDS: readonly string[] = Object.keys(JOB_HANDLERS);

/** A registered kind's handler, or null for one the registry does not know. */
export function handlerFor(kind: string): JobHandler<unknown> | null {
  return (JOB_HANDLERS as Record<string, JobHandler<unknown>>)[kind] ?? null;
}
