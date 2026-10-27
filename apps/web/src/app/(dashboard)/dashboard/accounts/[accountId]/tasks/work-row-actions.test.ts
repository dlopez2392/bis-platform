import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

const { failureText } = await import("./work-row-actions");
const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "work-row-actions.tsx"), "utf8");
const cat = m as Record<string, string>;

// F-085 follow-ups (final M4): the To do's failures read the reader's
// language. The server names the failure by key; this renders it with the
// same useLocale() the success toasts use. A failure with no key (the
// calendar's own close-out error, forwarded verbatim) is shown as it came.
describe("failureText", () => {
  it("renders a keyed failure in the reader's language (mutation: return r.error regardless -> FAILS)", () => {
    const r = { ok: false as const, error: m["work.actionFailed"], errorKey: "work.actionFailed" as const };
    expect(failureText(r, "es")).toBe("No se pudo actualizar ahora. Vuelva a intentarlo en un momento.");
    expect(failureText(r, "en")).toBe(m["work.actionFailed"]);
  });

  it("a stale tab's decide-first refusal reads Spanish too, naming the two buttons by their Spanish words", () => {
    const r = { ok: false as const, error: m["todo.consent.decideFirst"], errorKey: "todo.consent.decideFirst" as const };
    expect(failureText(r, "es")).toBe(
      `Decídalo con “${cat["contact.texts.confirmStop.es"]}” o “${cat["contact.texts.notAStop.es"]}”.`,
    );
  });

  it("a failure with no key is shown exactly as it came (mutation: t(m, undefined) -> FAILS)", () => {
    const forwarded: { ok: false; error: string } = { ok: false, error: "Could not update this booking." };
    expect(failureText(forwarded, "es")).toBe("Could not update this booking.");
  });

  it("every failure toast in the file goes through it (mutation: toast.error(result.error) on any path -> FAILS)", () => {
    const all = SRC.match(/toast\.error\(/g) ?? [];
    const routed = SRC.match(/toast\.error\(failureText\(/g) ?? [];
    expect(all.length).toBe(5);
    expect(routed.length).toBe(all.length);
  });
});

// F-085 follow-ups (design m4): plain Spanish for "Moved to tomorrow."
describe("the Not now toast", () => {
  it("reads \"Lo pasamos a mañana.\" (mutation: restore \"Pasado a mañana.\" -> FAILS)", () => {
    expect(t(m, "work.notNow.toast", "es")).toBe("Lo pasamos a mañana.");
  });
});

// F-085 follow-ups (final M3): the To do's close-out and the Calendar's
// bookings list record the same write, so they use the same Spanish words for
// it: the Calendar's status words "Terminada" and "No llegó". The completed
// button keeps "Se realizó", the answer to its own row's question ("¿Se
// realizó este trabajo?"); the toasts name the status the Calendar will show.
describe("the To do's close-out speaks the Calendar's words", () => {
  const done = cat["calendar.bookings.status.completed.es"];
  const noShow = cat["calendar.bookings.status.no_show.es"];

  it("the no-show button is the Calendar's own status word (mutation: restore \"No se presentaron\" -> FAILS)", () => {
    expect(noShow).toBe("No llegó");
    expect(t(m, "work.booking.noShow", "es")).toBe(noShow);
  });

  it("each toast names the status the Calendar shows (mutation: restore \"Marcado como realizado\" / \"Marcado como inasistencia\" -> FAILS)", () => {
    expect(done).toBe("Terminada");
    expect(t(m, "work.booking.completed.toast", "es")).toBe(`La cita quedó como “${done}”. Es posible que se envíe una solicitud de reseña.`);
    expect(t(m, "work.booking.noShow.toast", "es")).toBe(`La cita quedó como “${noShow}”. Es posible que se envíe un mensaje de seguimiento.`);
  });
});
