import type { JobContext, JobHandler } from "./types";

/**
 * The one handler that ships with the runner (spec section 8). It is the
 * rollout check (spec section 12): proving enqueue -> claim -> complete on
 * the real database before any real recipe uses the queue. Does nothing.
 */
// `satisfies`, not a `: JobHandler<...>` annotation: an annotation would widen
// `kind` to plain `string`, and the registry's `[platformPing.kind]` computed
// key needs the literal "platform.ping" to keep JOB_HANDLERS's keys (and
// JobKind) literal rather than collapsing to an index signature.
export const platformPing = {
  kind: "platform.ping",
  maxAttempts: 1,
  timeoutMs: 5_000,

  parse(payload: unknown): Record<string, never> {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("platform.ping takes an empty object");
    }
    return {};
  },

  async run(ctx: JobContext, payload: Record<string, never>): Promise<void> {
    // Proves the pipe works. Nothing to do — the parameters exist only so
    // this handler's own call signature matches every other JobHandler's
    // (no argsIgnorePattern in this eslint config, so an unused parameter
    // must be read, not just underscored).
    void ctx;
    void payload;
  },
} as const satisfies JobHandler<Record<string, never>>;
