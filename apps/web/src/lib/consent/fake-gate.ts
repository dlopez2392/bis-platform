import { normalisePhone } from "@bis/db/phone";
import { withOptOut } from "@/lib/sms/opt-out";
import { segmentsFor } from "@/lib/sms/segments";
import { SMS_KINDS } from "./classes";
import type { SmsRequest, SmsSendResult, SmsSender } from "./gate";

/**
 * A stand-in for the send gate, FOR TESTS ONLY: scans.test.ts refuses an
 * import of this module from any file that is not a test. It clears every
 * send unless `decide` answers first, applies the kind's footer the way the
 * gate does (the registry's own `footer`), runs `prepare`, then hands the
 * text to `send` — so a pass's write-then-send, and its assertions on the
 * text as sent, keep meaning what they meant against the old provider fake.
 * The gate's own behaviour is proven in gate.test.ts, against the real
 * module; this fake proves nothing about it.
 */
export type FakeSmsGate = SmsSender & { calls: SmsRequest[] };

export function fakeSmsGate(o: {
  send?: (m: { to: string; from: string; body: string }) => Promise<{ providerMessageId: string }>;
  from?: string;
  decide?: (req: SmsRequest) => SmsSendResult | null;
  billable?: boolean;
} = {}): FakeSmsGate {
  const calls: SmsRequest[] = [];
  const gate: SmsSender = async (req, opts = {}) => {
    calls.push(req);
    const decided = o.decide?.(req) ?? null;
    if (decided) return decided;
    const to = normalisePhone(req.to)?.e164;
    if (!to) return { kind: "blocked", reason: "no_number" };
    const from = o.from ?? "+19565550000";
    const body = SMS_KINDS[req.kind].footer === "stop_line" ? withOptOut(req.body, req.language) : req.body;
    try {
      await opts.prepare?.({ body, to, from });
    } catch (e) {
      return { kind: "failed", stage: "prepare", error: e instanceof Error ? e.message : String(e), carrierBlocked: false };
    }
    try {
      const send = o.send ?? (async () => ({ providerMessageId: "fake_sms" }));
      const { providerMessageId } = await send({ to, from, body });
      return { kind: "sent", providerMessageId, to, from, body, billable: o.billable ?? false, segments: segmentsFor(body).segments };
    } catch (e) {
      return { kind: "failed", stage: "provider", error: e instanceof Error ? e.message : String(e), carrierBlocked: false };
    }
  };
  return Object.assign(gate, { calls });
}
