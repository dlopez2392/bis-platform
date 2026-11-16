"use client";

// The form and the call. The browser asks for the microphone first (inside the click, so the browser lets
// it), then the server action mints a secret for the typed business, then this page talks to OpenAI
// directly over WebRTC, as the website's "Talk to Sofía" does. Once the audio channel opens it asks for the
// opening line the server built, so the prospect hears their own business's name first.
//
// The length is ADVISORY (web-demo.ts): the timer below ends a well-behaved session at maxSeconds. Esc and
// End the demo end it sooner, while it is still connecting too; leaving the page ends it. The start
// sequence itself (run-demo-start.ts) checks for a cancel after every await and releases what it holds.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TradeFields, type TradeSetup } from "@/components/vetting/trade-fields";
import { m } from "@/lib/messages";
import type { ProspectDemoForm } from "@/lib/voice/prospect-demo";
import type { ProspectDemoStart } from "./actions";
import { runDemoStart } from "./run-demo-start";

type Started = Extract<ProspectDemoStart, { ok: true }>;
type Phase = "idle" | "starting" | "live" | "ended";
type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement };

const HOURS_ROWS = [
  { key: "weekdays", label: m["prospectDemo.hours.weekdays"], open: true, from: "08:00", to: "17:00" },
  { key: "saturday", label: m["prospectDemo.hours.saturday"], open: true, from: "08:00", to: "12:00" },
  { key: "sunday", label: m["prospectDemo.hours.sunday"], open: false, from: "09:00", to: "13:00" },
] as const;
const SERVICE_ROWS = [0, 1, 2, 3, 4, 5];
const LANGUAGES = [
  ["en", m["prospectDemo.lang.english"]], ["es", m["prospectDemo.lang.spanish"]], ["both", m["prospectDemo.lang.both"]],
] as const;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** The form's fields as the action's argument. The server re-checks every one of them. */
function readForm(fd: FormData): ProspectDemoForm {
  const row = (k: string) => ({ open: fd.get(`${k}.open`) === "on", from: str(fd, `${k}.from`), to: str(fd, `${k}.to`) });
  return {
    businessName: str(fd, "businessName"), trade: str(fd, "trade"), tradeOther: str(fd, "tradeOther"),
    languages: str(fd, "languages") as ProspectDemoForm["languages"],
    hours: { weekdays: row("weekdays"), saturday: row("saturday"), sunday: row("sunday") },
    services: SERVICE_ROWS.map((i) => ({
      name: str(fd, `service.${i}.name`), price: str(fd, `service.${i}.price`), minutes: str(fd, `service.${i}.minutes`),
    })),
  };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const stopMic = (mic: MediaStream) => mic.getTracks().forEach((t) => t.stop());
/** Safe twice: close() on a closed peer does nothing, and the audio is simply silenced again. */
function closePeer(p: Peer) {
  p.pc.close();
  p.audio.pause();
  p.audio.srcObject = null;
}

/** The peer, its audio and the events channel; the greeting is asked for once the channel opens. */
function openPeer(s: Started, mic: MediaStream): Peer {
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (ev) => { audio.srcObject = ev.streams[0] ?? null; };
  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
  const dc = pc.createDataChannel("oai-events");
  dc.onopen = () => dc.send(JSON.stringify({ type: "response.create", response: { instructions: s.greeting } }));
  return { pc, audio };
}

async function negotiate({ pc }: Peer, s: Started) {
  await pc.setLocalDescription(await pc.createOffer());
  const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST", body: pc.localDescription?.sdp,
    headers: { Authorization: `Bearer ${s.secret}`, "Content-Type": "application/sdp" },
  });
  if (!answer.ok) throw new Error(`answer ${answer.status}`);
  await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
}

export function ProspectDemo({ trade, start }: { trade: TradeSetup; start: (raw: unknown) => Promise<ProspectDemoStart> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ business: string; remaining: number } | null>(null);
  /** Bumped by every start and every end: an attempt whose number is no longer current is cancelled. */
  const attempt = useRef(0);
  /** What the current attempt holds, so a cancel releases it AT ONCE, not only at the sequence's next await. */
  const held = useRef<{ mic?: MediaStream; peer?: Peer; timer?: number }>({});

  const end = useCallback(() => {
    attempt.current += 1;
    const h = held.current;
    held.current = {};
    if (h.timer !== undefined) window.clearInterval(h.timer);
    if (h.peer) closePeer(h.peer);
    if (h.mic) stopMic(h.mic);
    setLive(null);
    setPhase((p) => (p === "live" ? "ended" : "idle"));
  }, []);

  // Leaving the page ends the call, or the attempt to start one: no microphone or session stays open
  // behind a page nobody can see.
  useEffect(() => end, [end]);
  useEffect(() => {
    if (phase !== "live" && phase !== "starting") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, end]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase === "starting" || phase === "live") return;
    const raw = readForm(new FormData(e.currentTarget));
    const mine = ++attempt.current;
    const cancelled = () => attempt.current !== mine;
    setError(null);
    setPhase("starting");
    const r = await runDemoStart<MediaStream, Peer>({
      cancelled,
      getMic: async () => {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!cancelled()) held.current.mic = mic;
        return mic;
      },
      stopMic,
      start: () => start(raw),
      openPeer: (s, mic) => (held.current.peer = openPeer(s, mic)),
      negotiate,
      closePeer,
    });
    // A cancelled attempt has already been released and its phase set by whoever cancelled it.
    if (r.kind === "cancelled") return;
    if (r.kind === "error") {
      held.current = {};
      setError(r.error);
      setPhase("idle");
      return;
    }
    const startedAt = Date.now();
    const { maxSeconds, businessName } = r.started;
    setLive({ business: businessName, remaining: maxSeconds });
    setPhase("live");
    held.current.timer = window.setInterval(() => {
      const left = maxSeconds - Math.floor((Date.now() - startedAt) / 1000);
      if (left <= 0) end();
      else setLive((l) => (l ? { ...l, remaining: left } : l));
    }, 1000);
  }

  const busy = phase === "starting" || phase === "live";
  return (
    <Card className="max-w-3xl">
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <fieldset disabled={busy} className="space-y-6">
            <div className="space-y-1.5">
              <Label htmlFor="demo-business">{m["prospectDemo.field.businessName"]}</Label>
              <Input id="demo-business" name="businessName" required maxLength={80} autoComplete="off" />
            </div>
            <TradeFields idPrefix="demo" {...trade} />
            <div className="space-y-1.5">
              <Label htmlFor="demo-languages">{m["prospectDemo.field.languages"]}</Label>
              <Select name="languages" defaultValue="both">
                <SelectTrigger id="demo-languages" className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                <SelectContent lang="en">
                  {LANGUAGES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">{m["prospectDemo.hours.legend"]}</legend>
              {HOURS_ROWS.map((r) => (
                <div key={r.key} className="grid grid-cols-[minmax(0,10rem)_auto_1fr_1fr] items-center gap-3">
                  <span className="text-sm">{r.label}</span>
                  <Label className="gap-2 text-sm font-normal">
                    <Checkbox name={`${r.key}.open`} defaultChecked={r.open} />
                    {m["prospectDemo.hours.open"]}
                  </Label>
                  <Input type="time" name={`${r.key}.from`} defaultValue={r.from} aria-label={`${r.label}: ${m["prospectDemo.hours.from"]}`} />
                  <Input type="time" name={`${r.key}.to`} defaultValue={r.to} aria-label={`${r.label}: ${m["prospectDemo.hours.to"]}`} />
                </div>
              ))}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{m["prospectDemo.services.legend"]}</legend>
              <p className="text-xs text-muted-foreground">{m["prospectDemo.services.hint"]}</p>
              {SERVICE_ROWS.map((i) => (
                <div key={i} className="grid grid-cols-[1fr_7rem_6rem] gap-3">
                  <Input name={`service.${i}.name`} maxLength={60} aria-label={`${m["prospectDemo.services.name"]} ${i + 1}`} placeholder={i === 0 ? m["prospectDemo.services.name"] : undefined} />
                  <Input name={`service.${i}.price`} inputMode="decimal" aria-label={`${m["prospectDemo.services.price"]} ${i + 1}`} placeholder={i === 0 ? m["prospectDemo.services.price"] : undefined} />
                  <Input name={`service.${i}.minutes`} inputMode="numeric" aria-label={`${m["prospectDemo.services.minutes"]} ${i + 1}`} placeholder={i === 0 ? m["prospectDemo.services.minutes"] : undefined} />
                </div>
              ))}
            </fieldset>
          </fieldset>
          {error ? <Notice tone="crit" className="text-foreground">{error}</Notice> : null}
          {phase === "ended" && !error ? <p className="text-sm text-muted-foreground">{m["prospectDemo.ended"]}</p> : null}
          {live ? (
            <div className="flex flex-wrap items-center gap-4">
              {/* The live region is the status line alone: a per-second countdown inside it would be read
                  out every second. */}
              <p className="text-sm font-medium" aria-live="polite">
                <span aria-hidden className="mr-2 inline-block size-2 animate-pulse rounded-full bg-[var(--good)] motion-reduce:animate-none" />
                {m["prospectDemo.live"].replace("{business}", live.business)}
              </p>
              <p className="font-mono text-sm tabular-nums">{m["prospectDemo.remaining"].replace("{time}", clock(live.remaining))}</p>
              {/* The one primary while a call is up (rule 8): the form's Start is gone. */}
              <Button type="button" onClick={end}>{m["prospectDemo.end"]}</Button>
              <p className="w-full text-xs text-muted-foreground">{m["prospectDemo.endHint"]}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={phase === "starting"}>
                {phase === "starting" ? m["prospectDemo.starting"] : m["prospectDemo.start"]}
              </Button>
              {/* While connecting, a way out that is not only Esc (a phone has no Esc key). */}
              {phase === "starting" ? (
                <Button type="button" variant="ghost" onClick={end}>{m["prospectDemo.end"]}</Button>
              ) : null}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
