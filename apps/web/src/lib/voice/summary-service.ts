import type { CallState } from "./call-state";
import { buildSummaryInput, composeSummary } from "./summarize";

/**
 * Generates the staff-facing call summary. The caller holds `CallState` — this
 * function does not load or save anything. `OPENAI_API_KEY` is read inside the
 * function body (not at module scope) so a missing key at build time never
 * breaks the import; at runtime, a missing key skips the fetch and the fact
 * line still stands via `composeSummary("", state)`.
 *
 * A failed request (network throw, or a non-ok response) is swallowed the same
 * way — prose becomes "" and the recorded facts are still what's shown.
 */
export async function generateSummary(
  state: CallState,
  opts?: { timezone?: string; fetchImpl?: typeof fetch },
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  let prose = "";

  if (apiKey) {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    try {
      const systemRules = [
        "Summarize this front-desk call for staff in 3-4 sentences.",
        "The BOOKED and INTAKE sections are the system's own records and are authoritative.",
        "Only state that an appointment was booked if BOOKED lists one; if BOOKED is (none), say plainly that no appointment was recorded.",
        "Only state that contact details were captured if INTAKE lists them; if INTAKE is (none), say plainly that none were captured.",
        "If the caller asked for something the records do not show, say what they asked for and that it was not completed — do not describe it as done.",
        "Never invent names, phone numbers, email addresses or times that do not appear in the input.",
        "Always write the summary in English (it is staff-facing), regardless of the language spoken on the call.",
      ];
      // BOOKED times in the input are raw UTC (see summarize.ts's fact line,
      // which stays that way deliberately). Left alone, the prose model
      // renders that UTC instant as if it were already local — a booking at
      // 14:00 UTC became "2:00 PM" in a production summary when the account's
      // actual local time was 9:00 AM Central. Only added when a timezone is
      // known; with none, there is nothing correct to convert to.
      if (opts?.timezone) {
        systemRules.push(
          `State all dates and times in the ${opts.timezone} timezone in natural local form (e.g. 9:00 AM Central). Never present a UTC time as if it were local.`,
        );
      }
      const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: systemRules.join(" "),
            },
            { role: "user", content: buildSummaryInput(state) },
          ],
        }),
        // A hung connection (never rejects, never resolves) would otherwise
        // stall `finishCall` until Vercel kills the invocation outright — the
        // row stays open, no staff alert, and the call never even logs as
        // lost. 10s is generous for a 3-4 sentence completion; the catch
        // below already converts any rejection (including this timeout's
        // AbortError/TimeoutError) into `prose = ""`.
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        const data = await r.json();
        prose = data?.choices?.[0]?.message?.content ?? "";
      }
    } catch {
      prose = "";
    }
  }

  // The returned summary leads with what the system actually recorded, and
  // flags the prose when it disagrees. A model that claims a booking nobody
  // made is the failure this guards, and it reached production three times.
  return composeSummary(prose, state);
}
