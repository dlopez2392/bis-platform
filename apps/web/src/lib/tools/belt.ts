// apps/web/src/lib/tools/belt.ts
// One tool belt for every assistant (F-023, plan §3.1): the transport-neutral tool contract, its two transport
// shapes, and the ONE guard every runner goes through. No handlers live here: each assistant keeps its own (§3.3).
import type { AiTool } from "@/lib/ai/gateway";

/** Who a tool is for. A customer session (the phone, the web chat) and a staff session (the owner line) are built
 *  from ONE audience's catalogue each, and the two catalogues share no name (catalogues.test.ts). */
export type Audience = "customer" | "staff";

/** A JSON-schema object, as both transports send it. */
export type ToolParameters = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties?: boolean;
};

/** A tool's contract, transport-neutral. Catalogues are written `as const satisfies readonly ToolSpec<A>[]`, so the
 *  name union derived from them stays narrow. */
export type ToolSpec<A extends Audience = Audience> = {
  readonly audience: A;
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameters;
};

export type RealtimeTool<S extends ToolSpec = ToolSpec> = {
  type: "function"; name: S["name"]; description: S["description"]; parameters: S["parameters"];
};

/** The flat GA Realtime format (lib/voice/tools/schemas.ts:1-3): type/name/description/parameters at the top level,
 *  in THAT key order, no `function` wrapper and no audience. A voice session's accept body carries these as they are,
 *  so the order is part of the contract (owner-line/tools/owner-tool-schemas.fixture.json pins it). */
export function realtimeShape<S extends ToolSpec>(spec: S): RealtimeTool<S> {
  return { type: "function", name: spec.name, description: spec.description, parameters: spec.parameters };
}

/** The chat-completions shape the gateway sends (lib/ai/gateway.ts's AiTool). */
export function chatShape(spec: ToolSpec): AiTool {
  return { type: "function", function: { name: spec.name, description: spec.description, parameters: spec.parameters } };
}

/** What a failure logs: its class, never its message, which can quote a customer's words or number (the owner line's
 *  rule since Task 9 and Task 12, lib/owner-line/finish.ts). */
export const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * The one guard (plan §3.1). In order:
 *   1. a name not in this audience's catalogue → `unknown()`;
 *   2. a catalogue name not on THIS session's offered list → `notOffered(name)`, the assistant's own refusal words;
 *   3. otherwise `run(name, args)`;
 *   4. a throw or a rejection from `run` → `onError(errorClass(e))`, which logs and returns the caller's failure
 *      result. Only the class reaches it; the message never leaves this function.
 * `offered` is typed against the catalogue's names (NoInfer), so a session cannot be offered another catalogue's tool.
 */
export async function runOffered<N extends string, R>(o: {
  catalogue: readonly N[];
  offered: readonly NoInfer<N>[];
  name: string;
  args: Record<string, unknown>;
  run: (name: N, args: Record<string, unknown>) => Promise<R>;
  notOffered: (name: N) => R;
  unknown: () => R;
  onError: (errorClass: string) => R;
}): Promise<R> {
  if (!(o.catalogue as readonly string[]).includes(o.name)) return o.unknown();
  const name = o.name as N;
  if (!o.offered.includes(name)) return o.notOffered(name);
  try {
    return await o.run(name, o.args);
  } catch (e) {
    return o.onError(errorClass(e));
  }
}
