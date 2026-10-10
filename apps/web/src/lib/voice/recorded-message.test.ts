// The positives here are VERBATIM from production — nine calls to 956
// Woodworks on 2026-09-17, the only real client on the platform. Every one was
// recorded as `abandoned`, which told the owner he had lost nine customers in
// one day.
//
// The negatives matter more than the positives. A false positive hangs up on a
// paying customer and leaves no trace they ever called, which is strictly worse
// than a robocall getting through — so the negatives are written to be hostile:
// real callers who mention Google, who ramble at length, who read out a number,
// who talk about pressing things.
import { describe, it, expect } from "vitest";
import { looksLikeRecordedMessage } from "./recorded-message";

/** The exact text the robot delivered, from `calls.transcript`. */
const REAL_ROBOCALL =
  "Hello, please don't hang up the phone. This is an important message regarding " +
  "your Google business account. Our system shows a new search for your business " +
  "via Google, and Google Voice clients are currently having trouble finding you. " +
  "Press 0 to speak with an agent immediately and verify your Google listings. " +
  "Again, your business is not showing correctly on Google and Google Voice " +
  "search. Press 0 to speak to an agent, press 9 to opt out, or call " +
  "877-556-9255. Thank you.";

describe("looksLikeRecordedMessage — the positives, verbatim from production", () => {
  it("catches the Google-listing robocall that hit 956 Woodworks nine times", () => {
    expect(looksLikeRecordedMessage(REAL_ROBOCALL)).toBe(true);
  });

  it("catches it when the transcriber changes casing and the digit form, as long as the sentence breaks survive", () => {
    // Whisper is not deterministic about casing or the digit form, and a
    // guard that only matches one transcription of one recording is a guard
    // that stops working the next time the same robot calls.
    expect(looksLikeRecordedMessage(
      "hello please dont hang up the phone. this is an important message regarding " +
      "your google business account. press zero to speak with an agent. press nine " +
      "to opt out",
    )).toBe(true);
  });

  it("KNOWN MISS: the same script transcribed with NO punctuation at all gets through (F-010 review round 2)", () => {
    // Before round 2 this was a positive. The instruction must now OPEN A
    // SENTENCE, because a customer describing a real menu says the very same
    // words mid-sentence ("the recording said press 0 to talk to an
    // operator…") and the owner's standing rule is that hanging up on a real
    // customer is strictly worse than letting a robocall through. With no
    // sentence breaks, nothing shows where a sentence starts, so this robot
    // bills its minutes; the silence and repeat-caller guards still stand.
    expect(looksLikeRecordedMessage(
      "hello please dont hang up the phone this is an important message regarding " +
      "your google business account press zero to speak with an agent press nine " +
      "to opt out",
    )).toBe(false);
  });

  it("catches an IVR instruction with no opt-out clause at all", () => {
    // BOTH HALVES OF THE `||` HAVE TO EARN THEIR PLACE. Every positive above
    // happens to contain the press-instruction AND the opt-out, so with only
    // those, changing `||` to `&&` — or deleting either regex — would leave
    // this file green. Broadcasters are not obliged to offer an opt-out.
    expect(looksLikeRecordedMessage(
      "This is an urgent notice concerning the warranty on your vehicle, which " +
      "our records show is about to expire. Press 1 to speak with a warranty " +
      "specialist about renewing your coverage today.",
    )).toBe(true);
  });

  it("catches an opt-out clause with no press instruction at all, opening its sentence", () => {
    // The other half. Some recordings say "reply" or give a callback number
    // instead of a keypad instruction, but still read out the opt-out because
    // somebody's compliance team made them.
    expect(looksLikeRecordedMessage(
      "Good afternoon, this message is regarding an important update to your " +
      "business listing that requires your attention before the end of the " +
      "month. Call us back on 877-555-0100. To be removed from our list, reply STOP.",
    )).toBe(true);
  });

  it("KNOWN MISS: the opt-out in the middle of a sentence gets through (F-010 review round 2)", () => {
    // Was a positive. Mid-sentence, the list-holder's words are exactly what
    // a customer reading out a letter says ("it says to be removed from our
    // list call this number…"), so only the sentence-opening form counts —
    // the owner's rule, see the miss above.
    expect(looksLikeRecordedMessage(
      "Good afternoon, this message is regarding an important update to your " +
      "business listing that requires your attention before the end of the " +
      "month. Call us back on 877-555-0100, or reply to this message to be " +
      "removed from our list.",
    )).toBe(false);
  });

  it("catches the shape without the Google pretext at all", () => {
    // The pretext is whatever the scam of the month is. The IVR instruction is
    // the part that makes it a recording rather than a person, so that is what
    // this keys on — a different script with the same shape must still be
    // caught.
    expect(looksLikeRecordedMessage(
      "This is a final notice about your vehicle warranty. Press 1 to speak " +
      "with a specialist, or press 9 to be removed from our list.",
    )).toBe(true);
  });
});

describe("looksLikeRecordedMessage — the negatives, which cost more to get wrong", () => {
  it("a customer who found them on Google is NOT a robocall", () => {
    // THE most important negative, and it has to be LONG ENOUGH TO BE JUDGED.
    // The first version of this test was 66 characters, so the length floor
    // rejected it before any keyword could matter — which meant the claim
    // "never keyed on Google" was untested, and a mutation adding a Google
    // rule passed. Now it is past the floor, so only the ABSENCE of that rule
    // keeps it false.
    //
    // Keying on "Google" was the obvious heuristic: the word appears five
    // times in the real robocall. It would hang up on this caller — a real
    // lead — silently, with the owner never learning they rang.
    expect(looksLikeRecordedMessage(
      "Hi there, I found you on Google when I was searching for custom furniture " +
      "makers around McAllen, and your photos looked great. I wanted to ask about " +
      "getting a dining table made for eight people, in oak if you have it.",
    )).toBe(false);
  });

  it("a customer reading out their phone number is not a robocall", () => {
    expect(looksLikeRecordedMessage(
      "Sure, my number is 956-555-0134, you can reach me any time after five.",
    )).toBe(false);
  });

  it("a customer who talks about pressing something is not a robocall", () => {
    // "press" alone is a word people use, and this negative has to use it as a
    // WHOLE WORD past the length floor to prove anything. The first version
    // said "presses", which \bpress\b does not match either way — so a
    // mutation keying on the bare verb passed, and the instruction-shape
    // requirement went untested.
    expect(looksLikeRecordedMessage(
      "So the veneer work — do you press it yourself in the shop, or does that go " +
      "out somewhere? My father-in-law used to press his own and swore the glue " +
      "line was better that way. Either is fine by me, I just wondered.",
    )).toBe(false);
  });

  it("a long rambling customer is not a robocall", () => {
    // Length alone is not the signal. Plenty of real callers monologue,
    // especially older ones and especially on a first call.
    expect(looksLikeRecordedMessage(
      "Hi there, so my wife and I have been talking about redoing the kitchen for " +
      "about two years now and we finally decided to go ahead with it, and someone " +
      "at church mentioned that you all do custom cabinets, so I wanted to call and " +
      "see whether you could come out and take a look and give us some idea of what " +
      "something like that would run, because we have no idea what to expect really.",
    )).toBe(false);
  });

  it("a Spanish-speaking customer is not a robocall", () => {
    expect(looksLikeRecordedMessage(
      "Buenos días, quería preguntar por una mesa de comedor de madera.",
    )).toBe(false);
  });

  it("an empty or whitespace turn is not a robocall", () => {
    // The silence guard owns that case and classifies it `spam` already. This
    // guard must not also claim it, or two guards write the same outcome for
    // different reasons and neither log explains the other.
    expect(looksLikeRecordedMessage("")).toBe(false);
    expect(looksLikeRecordedMessage("   ")).toBe(false);
  });

  it("a short Spanish answer is never a robocall either", () => {
    // A complete instruction AND a complete opt-out, so only the floor can
    // reject it — the same construction as the English case below.
    expect(looksLikeRecordedMessage("Oprima 9 para ser eliminado de nuestra lista")).toBe(false);
  });

  it("a short answer is never a robocall, whatever words it contains", () => {
    // These carry a COMPLETE instruction and a COMPLETE opt-out clause, so the
    // LENGTH FLOOR is the only thing that can reject them. That is the point:
    // the first version of this test used "press 1", which the instruction
    // regex rejects on its own, so dropping the floor entirely left this file
    // green and the floor was protecting nothing anybody checked.
    //
    // Why a fragment must not be judged: the transcriber cuts turns, and a
    // caller repeating an instruction back ("press 9 to opt out — is that what
    // you mean?") is a person asking a question, not a broadcast.
    expect(looksLikeRecordedMessage("press 9 to opt out")).toBe(false);
    expect(looksLikeRecordedMessage("Press 1 to speak with someone")).toBe(false);
    expect(looksLikeRecordedMessage("press 1")).toBe(false);
    expect(looksLikeRecordedMessage("yes please")).toBe(false);
  });
});

// ─── Spanish (F-010) ─────────────────────────────────────────────────────────
//
// The same two signals, said in Spanish: the keypad instruction and the
// broadcaster's opt-out. No real Spanish robocall is on record yet, so the
// positives are written in the shapes US Spanish IVR scripts use ("oprima 1
// para…", "para hablar con un agente, oprima 1") — an assumption until one is
// caught. The negatives are real-customer sentences and are the half that
// matters: a false positive hangs up on a customer and leaves no trace.

/** Judged only past the length floor — a negative under it proves nothing
 *  about the instruction rules (the lesson this file's English negatives
 *  record twice), and a positive under it would fail for the wrong reason. */
function judged(text: string): boolean {
  expect(text.trim().length, text).toBeGreaterThanOrEqual(120);
  return looksLikeRecordedMessage(text);
}

/**
 * A negative must hold at EVERY point the caller's turn can be judged, not
 * only when it is finished: `call-events.ts` runs this predicate on each
 * transcription delta's running prefix, and a customer reading out
 * "marque el nueve…" is a prefix ending at "nueve" before the next digit
 * arrives. Every character boundary is a superset of where a delta can end.
 */
function trippedAtSomePrefix(text: string): string | null {
  for (let end = 120; end <= text.length; end++) {
    if (looksLikeRecordedMessage(text.slice(0, end))) return text.slice(0, end);
  }
  return null;
}

describe("looksLikeRecordedMessage — Spanish positives", () => {
  it("catches the Google-listing script read in Spanish", () => {
    expect(judged(
      "Hola, por favor no cuelgue. Este es un mensaje importante sobre su cuenta de " +
      "negocio de Google. Nuestro sistema muestra que sus clientes no lo pueden " +
      "encontrar. Oprima 0 para hablar con un agente de inmediato. Oprima 9 para no " +
      "recibir más llamadas.",
    )).toBe(true);
  });

  it("catches 'marque el 1 si…' with no opt-out at all", () => {
    // The forward instruction on its own: no opt-out, no "para …," before it.
    expect(judged(
      "Este es un aviso urgente sobre la garantía de su vehículo, que según nuestros " +
      "registros está por vencer. Marque el 1 si desea hablar con un especialista sobre " +
      "cómo renovar su cobertura hoy.",
    )).toBe(true);
  });

  it("catches the purpose-first order, 'para hablar con un representante, oprima 1.'", () => {
    // Spanish IVRs put the purpose FIRST far more often than English ones do,
    // and nothing follows the digit here, so the forward rule cannot see it.
    expect(judged(
      "Le llamamos de parte del departamento de beneficios para informarle que usted " +
      "califica para un nuevo plan de salud sin costo alguno. Para hablar con un " +
      "representante, oprima 1.",
    )).toBe(true);
    // ", o …" offering the next option is the other way the digit visibly ends.
    expect(judged(
      "Le informamos que su paquete está retenido en la aduana por falta de pago. Para " +
      "hablar con un agente oprima uno, o espere en la línea para más información.",
    )).toBe(true);
  });

  it("catches the broadcaster's opt-out with no keypad instruction, opening its sentence", () => {
    expect(judged(
      "Buenas tardes, este mensaje es sobre una actualización importante de su listado " +
      "de negocio que requiere su atención antes de fin de mes. Llámenos al 877-555-0100. " +
      "Para ser eliminado de nuestra lista, responda a este mensaje.",
    )).toBe(true);
  });

  // ── KNOWN MISSES (F-010 review round 2). Each was a positive until the
  // instruction had to OPEN A SENTENCE. A customer describing a real menu
  // says these very words mid-sentence ("ayer llamé y después presione el 0
  // para hablar con una operadora…"), and the owner's standing rule is that
  // hanging up on a real customer is strictly worse than letting a robocall
  // through. These robots bill their minutes; the silence and repeat-caller
  // guards still stand behind this one.
  it("KNOWN MISS: the Spanish script transcribed with no punctuation at all", () => {
    expect(judged(
      "hola por favor no cuelgue este es un mensaje importante sobre su cuenta de " +
      "negocio de google presione cero para hablar con un agente presione nueve para " +
      "ser eliminado de nuestra lista",
    )).toBe(false);
  });
  it("KNOWN MISS: purpose-first with no punctuation", () => {
    expect(judged(
      "le informamos que su paquete está retenido en la aduana por falta de pago para " +
      "hablar con un agente oprima uno o espere en la línea para más información",
    )).toBe(false);
  });
  it("KNOWN MISS: the opt-out in the middle of a sentence", () => {
    expect(judged(
      "Buenas tardes, este mensaje es sobre una actualización importante de su listado " +
      "de negocio que requiere su atención antes de fin de mes. Llámenos al 877-555-0100, " +
      "o responda a este mensaje para ser eliminado de nuestra lista.",
    )).toBe(false);
    expect(judged(
      "Le llamamos del centro de inscripción de beneficios para informarle que usted " +
      "califica para un nuevo plan de salud sin costo este año. Responda a este mensaje " +
      "para darse de baja de nuestra lista.",
    )).toBe(false);
  });
});

// One positive per closed-list purpose and per sentence opener, each carrying
// ONLY that instruction, so dropping any one of them from the rules fails
// here by name. What is NOT pinned one by one, on purpose: the articles and
// qualifiers around a purpose ("uno de nuestros", "a live", "one of our"),
// the feminine and plural endings (operadora, asesores), "obtener más
// información", "get more information" — variants of a purpose that is
// pinned, not purposes of their own.
describe("looksLikeRecordedMessage — one positive per closed-list purpose", () => {
  const PREAMBLE_EN =
    "This is a courtesy call from the benefits enrollment center regarding your " +
    "eligibility for a new health plan at no cost to you this year. ";
  const PREAMBLE_ES =
    "Le llamamos del centro de inscripción de beneficios para informarle que usted " +
    "califica para un nuevo plan de salud sin costo este año. ";

  it.each([
    "Press 1 to speak with an agent.",
    "Press 1 to speak with a representative.",
    "Press 0 to talk to an operator.",
    "Press 1 to speak with a specialist.",
    "Press 2 to talk to an advisor.",
    "Press 9 to opt out.",
    "Press 9 to be removed from our list.",
    "Press 2 to stop receiving these calls.",
    "Press 1 to hear more information.",
    "Press 1 for more information.",
    "Press 0 for a live agent.",
    "Press 0 for a representative.",
    "Press 0 for an operator.",
    "Please press 1 to speak with an agent.",
    "To be removed from our list, reply STOP to this message.",
  ])("English: %s", (instruction) => {
    expect(judged(PREAMBLE_EN + instruction)).toBe(true);
  });

  it.each([
    "Oprima 1 para hablar con un agente.",
    "Oprima 1 para hablar con un representante.",
    "Oprima 0 para hablar con un operador.",
    "Oprima 1 para hablar con un especialista.",
    "Oprima 2 para hablar con un asesor.",
    "Oprima 9 para no recibir más llamadas.",
    "Oprima 9 para ser eliminado de nuestra lista.",
    "Oprima 1 para recibir más información.",
    "Marque el 1 si desea hablar con un agente.",
    "Marque el 1 si quiere hablar con un agente.",
    "Marque el 1 si gusta hablar con un agente.",
    "Por favor, oprima 1 para hablar con un agente.",
    "Si quiere hablar con un asesor, presione 2.",
    "Para ser eliminado de nuestra lista, responda a este mensaje.",
    "Para darse de baja de nuestra lista, responda a este mensaje.",
  ])("Spanish: %s", (instruction) => {
    expect(judged(PREAMBLE_ES + instruction)).toBe(true);
  });
});

/** Real-customer Spanish, named so each test and the prefix sweep below read
 *  the same sentences. Accent-stripped twins are how a transcriber may
 *  render the same words. */
const ES_CUSTOMERS = {
  websiteButton:
    "Hola, buenas tardes. Estaba en su página web y oprimí el botón de reservar, pero " +
    "no me dejó escoger la hora, por eso les estoy llamando para ver si me pueden ayudar.",
  websiteButtonPlain:
    "hola buenas tardes estaba en su pagina web y oprimi el boton de reservar pero no " +
    "me dejo escoger la hora por eso les estoy llamando para ver si me pueden ayudar",
  dialledThisNumber:
    "Sí, mire, ayer marqué a este número en la tarde y nadie me contestó, entonces " +
    "quería saber si todavía tienen lugar la próxima semana para una limpieza de alfombras.",
  dialledThisNumberPlain:
    "si mire ayer marque a este numero en la tarde y nadie me contesto entonces queria " +
    "saber si todavia tienen lugar la proxima semana para una limpieza de alfombras",
  foundOnGoogle:
    "Hola, lo encontré en Google buscando a alguien que arregle techos aquí en Edinburg, " +
    "y vi que tienen muy buenas reseñas. Quería saber cuánto cobran por revisar una " +
    "gotera en la cocina.",
  pressedInTheMenu:
    "Ayer en el menú oprimí el 1 para citas y se cortó la llamada, entonces le vuelvo " +
    "a marcar para ver si me pueden dar una cita para el lunes en la mañana.",
  pressedInTheMenuPlain:
    "ayer en el menu oprimi el 1 para citas y se corto la llamada entonces le vuelvo " +
    "a marcar para ver si me pueden dar una cita para el lunes en la manana",
  pressedLastWeek:
    "La semana pasada llamé a la oficina y presioné el 1 para hablar con alguien de " +
    "citas, pero nadie contestó, así que quería intentar otra vez para hacerle una cita a mi mamá.",
  pressedLastWeekPlain:
    "la semana pasada llame a la oficina y presione el 1 para hablar con alguien de " +
    "citas pero nadie contesto asi que queria intentar otra vez para hacerle una cita a mi mama",
  toldToDial:
    "Mi cuñada me pasó este número y me dijo que marque el 2 para citas, pero no me " +
    "salió ninguna opción, así que nada más quería ver si me pueden apuntar para el sábado.",
  agentAboutPolicy:
    "Buenas tardes, le llamo para hablar con un agente sobre el seguro de mi casa, " +
    "porque tuvimos un problema con el techo después de la tormenta y no sé qué cubre la póliza.",
  ownNumber:
    "Para cualquier cosa marque el 956 555 0134, es mi celular, y pregunte por Rosa, o " +
    "si no le contesto déjeme un mensaje y yo le regreso la llamada en la tarde.",
  ownNumberCommas:
    "Para cualquier cosa, marque el 9, 5, 6, 5, 5, 5, 0, 1, 3, 4, es mi celular, y " +
    "pregunte por Rosa, o déjeme un mensaje y yo le regreso la llamada.",
  // The number comes AFTER the floor here, as it does when a caller explains
  // first: a readout inside the first 120 characters is never judged at all.
  ownNumberInWords:
    "Mire, le hablo porque el aire acondicionado de la casa ya no enfría nada y quería " +
    "que alguien viniera a revisarlo. Para cualquier cosa, marque el nueve cinco seis, " +
    "cinco cinco cinco, cero uno tres cuatro, es mi celular.",
  ownNumberAfterTalking:
    "Mire, le hablo porque el aire acondicionado de la casa ya no enfría nada y quería " +
    "que alguien viniera a revisarlo. Para cualquier cosa, marque el 9, 5, 6, 5, 5, 5, " +
    "0, 1, 3, 4, es mi celular.",
  tiredOfCalls:
    "Oiga, ¿qué tengo que hacer para no recibir más llamadas de ustedes? Ya me han " +
    "llamado tres veces esta semana ofreciéndome el servicio y de verdad no me interesa.",

  // ── Review round 1: customers telling how a phone menu went. A keypad
  // command with an ordinary purpose ("para citas", "para español") is a
  // person retelling a menu, and the accent-dropped past tense is spelled
  // exactly like the command, with nothing in front of it to say so.
  answeringMachineStory:
    "Buenas tardes, ayer llamé en la tarde y me contesto la grabadora, presione el 1 " +
    "para citas y nadie me contesto, así que vuelvo a llamar para ver si me pueden atender.",
  dialledLastNight:
    "Ayer en la noche marque el 2 para hablar con alguien de servicio pero nadie me " +
    "regresó la llamada, y quería saber si todavía tienen disponible el técnico esta semana.",
  pressedForService:
    "Le marqué temprano, luego presione el 2 para servicio y se corto la llamada, " +
    "entonces quería ver si me pueden mandar a alguien para revisar el calentador de agua.",
  languageMenu:
    "Cuando llamé la primera vez me salió una grabación que decía: oprima 1 para inglés, " +
    "oprima 2 para español, y yo no sabía qué hacer, así que mejor colgué y volví a llamar.",
  sonSaidPress:
    "Es que no le entiendo bien al teléfono, mi hijo me dijo: presione el uno para " +
    "español, pero no me salió nada, así que nomás le hablo para preguntar por una cita.",
  toldForAppointments:
    "Mi vecina me pasó este número y me dijeron que para citas marque el 1 o el 2, pero " +
    "no me salió ninguna opción, así que quería ver si me pueden apuntar el sábado.",
  // Cancelling a plan, and asking to stop messages: the customer's own words
  // for leaving, which no broadcaster's "nuestra lista" is in.
  cancelMothersPlan:
    "Hola, le llamo por mi mamá, ella tiene el plan mensual con ustedes y ya no lo va a " +
    "usar, quería saber qué tiene que hacer para darse de baja del servicio.",
  stopTheTexts:
    "Oiga, me siguen llegando mensajes de texto de ustedes cada semana y ya no los " +
    "quiero recibir, ¿qué tengo que hacer para ser removido de esta lista?",
  // A customer's OWN phone tree, given as a callback instruction.
  ownExtensionToTalk:
    "Si me llama a la oficina, oprima el 3 para hablar conmigo directamente, o si no le " +
    "contesto déjeme un mensaje y yo le regreso la llamada en la tarde.",
  ownExtension:
    "Mi número de la oficina es el 956 555 0134, y cuando le conteste la grabadora " +
    "marque el 3 para mi extensión, ahí le contesto yo o mi esposa, cualquiera de los dos.",
  ifNoAnswer:
    "Le dejo mi número de la casa por si acaso, es el 956 555 0134, y si no contesto, " +
    "marque el 2. Es el celular de mi hijo, él siempre contesta en la tarde.",
  // A quoted command WITH a robocall's purpose, in its commonest frame
  // ("me dijo que oprima…"): mid-sentence, so it is a story.
  toldToPressForAgent:
    "Mi suegra tiene seguro con ustedes y me dijo que oprima el 1 para hablar con un " +
    "agente, pero cuando llamé no me salió ningún menú, así que nomás quería preguntar por la póliza.",
  // A digit that is the start of a longer number: at the prefix ending
  // "…el uno si", "si" is the first half of "siete".
  digitThenSiete:
    "Mire, le hablo porque necesito que vengan a ver la lavadora de la casa, que ya no " +
    "centrifuga nada desde el lunes. Para cualquier cosa marque el uno siete dos, es la " +
    "extensión de mi trabajo.",

  // ── Review round 2, C1: a list purpose followed by a PHONE NUMBER — a
  // card, a flyer, a vendor's own line. The keypad digit never visibly ends.
  facebookAdNumber:
    "Hola, vi un anuncio de ustedes en Facebook que decía para más información marque el " +
    "956 555 0134 y por eso les llamo, quería saber cuánto cuesta una mesa de comedor de mezquite.",
  insuranceCardNumber:
    "Sí, buenas, tengo una pregunta de mi póliza, en la tarjeta del seguro dice para hablar " +
    "con un agente marque el 1 800 555 0199 pero ese número no me contesta, ¿ustedes me pueden ayudar?",
  pressedYesterdayForAgent:
    "Le hablo porque ayer para hablar con un agente de seguros presione el 2 y luego me " +
    "pasaron con ustedes, pero se cortó, y quería terminar de arreglar lo del seguro de la troca.",
  doctorsOffice:
    "Soy de la oficina del doctor Garza, si quiere hablar con una asesora de nosotros marque " +
    "el 2 cuando le conteste la grabadora, es para confirmar lo de la factura que les mandamos.",
  comadresCard:
    "Buenos días, mi comadre me dio su tarjeta y atrás dice si desea más información marque " +
    "el 956 555 0172, pero ese es otro número, ¿este es el bueno para hacer una cita?",
  vendorAfterComma:
    "Hola, habla Rosa de la mueblería, para hablar con un asesor de nosotros marque el 956 " +
    "555 0101 cuando guste, le hablaba por lo del pedido de las sillas que nos encargó.",
  // The same vendor with a FULL STOP before the purpose: the purpose now
  // begins a sentence, so only "the digit must visibly end" keeps it out.
  vendorAfterStop:
    "Hola, habla Rosa de la mueblería. Para hablar con un asesor de nosotros marque el 956 " +
    "555 0101 cuando guste, le hablaba por lo del pedido de las sillas que nos encargó.",

  // ── Review round 2, C2: a customer DESCRIBING a real business's menu.
  // "Hablar con una operadora" and "más información" are what real menus
  // offer too, so the purpose cannot tell them apart — where the command
  // sits can: mid-sentence, after "luego" / "después" / "la grabación".
  pressedThenOperator:
    "Buenas, fíjese que ayer llamé y después presione el 0 para hablar con una operadora y " +
    "nadie me contestó, entonces quería saber si me pueden cambiar la cita del jueves para el viernes.",
  pressedThenAdvisor:
    "Buenas tardes, le hablo porque la otra vez llamé y luego presione el 0 para hablar con " +
    "un asesor y se cortó la llamada, y necesito ver lo de mi cotización del techo.",
  recordingMoreInfo:
    "Quiero más información sobre el plan de mantenimiento del aire, ayer en la grabación " +
    "marque el 1 para más información pero no me dijeron nada de precios, ¿me puede explicar?",
  saidCommaPress:
    "Cuando llamé en la mañana la grabación dijo, presione 0 para hablar con un agente, y " +
    "esperé como diez minutos y nadie me contestó, por eso le vuelvo a marcar.",
  quotedRobocall:
    "Oiga, me llegó una llamada rara que decía oprima 1 para hablar con un agente sobre mi " +
    "cuenta de Google, ¿ustedes me llamaron o es una de esas llamadas de fraude?",
} as const;

// KNOWN GAP, recorded rather than chased (review rounds 1–2). The list
// purposes are ALSO what real business menus offer, so the purpose alone
// cannot tell a customer describing a menu from a script; the SENTENCE START
// is the discriminator. A customer who quotes a menu or a robocall
// mid-sentence ("me llegó una llamada que decía oprima 1 para hablar con un
// agente…", "the recording said press 0 to talk to an operator…") stays on
// the line — quotedRobocall and the round-2 negatives pin it. What is left:
// a customer who OPENS a sentence with the command — "Ayer llamé. Presione
// el 0 para hablar con una operadora y nadie contestó." (the accent-dropped
// past tense is spelled like the command), or a quote the transcriber
// breaks off with a full stop ("It said. Press 0 to speak with an agent.").
// A colon or a comma is not a sentence start, so "decía: oprima…" and "it
// said, press…" are safe. Nothing in the words tells the rest from a script.
// Only a real call can say how often it happens.

/** English and Spanglish callers retelling a menu or asking to stop
 *  messages — the English rule's own negatives for the same principle. */
const EN_CUSTOMERS = {
  spanglishMenu:
    "Ayer llamé y the thing said press 1 for appointments y nadie me contestó, so I'm " +
    "calling back to see if you guys can fit me in this week for a cleaning.",
  serviceMenu:
    "I called yesterday and the menu said press 2 for service, then it hung up on me, so " +
    "I'm trying again to see if someone can come out and look at my AC this week.",
  languageMenu:
    "When I called earlier it said press 1 for English, press 2 for Spanish, and then " +
    "nothing happened, so I hung up and called back to ask about your Saturday hours.",
  optOutOfTexts:
    "Hi, I keep getting the reminder texts and I'd like to opt out of those, but I still " +
    "want to keep my appointment for Thursday at ten if that's okay with you guys.",
  unsubscribe:
    "Hello, I'm calling to unsubscribe from your emails, I get like three a week and it's " +
    "too many, but please keep sending the appointment reminders by text.",
  removedFromThisList:
    "Yeah, I keep getting these flyers in the mail from you and I'd like to be removed " +
    "from this list please, I already had the roof done by another company.",
  // Review round 2, C2: customers quoting a menu, a flyer or a letter whose
  // option IS on the list.
  operatorRangAndRang:
    "Yeah hi, I called earlier and the recording said press 0 to talk to an operator and it " +
    "just rang and rang, so I'm calling again, I need to move my appointment to Friday.",
  spanglishAgent:
    "Oiga, la otra vez que llamé it told me press 1 to speak with an agent y nadie me " +
    "contestó, so I'm calling back porque necesito una cita para la troca esta semana.",
  flyerMoreInfo:
    "Hi, I got your flyer on my door yesterday and it says press 1 for more information, but " +
    "when I called nothing happened, so I just wanted to ask about the lawn package.",
  warrantyPaperwork:
    "Hi, my water heater from you guys is leaking again and the paperwork says press 2 to " +
    "speak with a warranty specialist but that line never picks up, so can you guys just send a tech out?",
  letterRemovedFromOurList:
    "Hi, I got a letter from you guys, it says to be removed from our list call this number, " +
    "but I actually still want the service, I just moved, so I need to update my address.",
  saidCommaPress:
    "When I called this morning it said, press 0 to speak with an agent, and I waited like ten " +
    "minutes and nobody picked up, so I'm trying again about my estimate.",
} as const;

describe("looksLikeRecordedMessage — Spanish negatives, real customers", () => {
  it("someone who pressed the booking button on the website", () => {
    // "oprimí" is the past tense; only the usted command "oprima" is an
    // instruction. Accents dropped by the transcriber must not change that.
    expect(judged(ES_CUSTOMERS.websiteButton)).toBe(false);
    expect(judged(ES_CUSTOMERS.websiteButtonPlain)).toBe(false);
  });

  it("someone who says they dialled this number", () => {
    expect(judged(ES_CUSTOMERS.dialledThisNumber)).toBe(false);
    expect(judged(ES_CUSTOMERS.dialledThisNumberPlain)).toBe(false);
  });

  it("someone who found the business on Google — never keyed on Google, in either language", () => {
    expect(judged(ES_CUSTOMERS.foundOnGoogle)).toBe(false);
  });

  it("someone telling how they pressed 1 on an earlier call", () => {
    // "oprimí" is never the command, accent or not ("oprimi" ≠ "oprima"), and
    // nothing else in this sentence protects it: no "y"/"que" before it.
    expect(judged(ES_CUSTOMERS.pressedInTheMenu)).toBe(false);
    expect(judged(ES_CUSTOMERS.pressedInTheMenuPlain)).toBe(false);
    // Past tense with its accent is never the command. Without the accent
    // "presione" IS the command's spelling, so the narrative's own "y …" /
    // "que …" in front of it is what keeps it a person's sentence.
    expect(judged(ES_CUSTOMERS.pressedLastWeek)).toBe(false);
    expect(judged(ES_CUSTOMERS.pressedLastWeekPlain)).toBe(false);
    expect(judged(ES_CUSTOMERS.toldToDial)).toBe(false);
  });

  it("someone who wants to talk to an agent about their policy", () => {
    // "para hablar con un agente" is a topic a customer can say. Only the
    // keypad instruction attached to it makes it a script.
    expect(judged(ES_CUSTOMERS.agentAboutPolicy)).toBe(false);
  });

  it("someone reading out their own number after 'marque el'", () => {
    expect(judged(ES_CUSTOMERS.ownNumber)).toBe(false);
    expect(judged(ES_CUSTOMERS.ownNumberCommas)).toBe(false);
    expect(judged(ES_CUSTOMERS.ownNumberInWords)).toBe(false);
  });

  it("someone tired of getting calls is complaining, not broadcasting", () => {
    // Why "para no recibir más llamadas" is NOT an opt-out signal on its own,
    // unlike "para ser eliminado de nuestra lista": a customer can say it. It
    // still counts after a keypad command ("oprima 9 para no recibir más
    // llamadas"), which the instruction rules already see.
    expect(judged(ES_CUSTOMERS.tiredOfCalls)).toBe(false);
  });

  it("someone retelling a phone menu — an ordinary purpose after the command is a person's story (review A, B, B2, C, D, N)", () => {
    for (const name of [
      "answeringMachineStory", "dialledLastNight", "pressedForService",
      "languageMenu", "sonSaidPress", "toldForAppointments",
    ] as const) {
      expect(judged(ES_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("someone cancelling a plan or asking to stop the texts is never hung up on (review I, J)", () => {
    // The sharpest false positive this guard can have: the customer asking
    // to be left alone is hung up on and never seen.
    expect(judged(ES_CUSTOMERS.cancelMothersPlan)).toBe(false);
    expect(judged(ES_CUSTOMERS.stopTheTexts)).toBe(false);
  });

  it("someone giving their own phone tree as a callback instruction (review E, F, Q)", () => {
    for (const name of ["ownExtensionToTalk", "ownExtension", "ifNoAnswer", "digitThenSiete"] as const) {
      expect(judged(ES_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("someone passing on what a relative told them to press", () => {
    expect(judged(ES_CUSTOMERS.toldToPressForAgent)).toBe(false);
  });

  it("a list purpose followed by a phone number — a card, a flyer, a vendor (review round 2, C1)", () => {
    for (const name of [
      "facebookAdNumber", "insuranceCardNumber", "pressedYesterdayForAgent",
      "doctorsOffice", "comadresCard", "vendorAfterComma", "vendorAfterStop",
    ] as const) {
      expect(judged(ES_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("someone describing a real menu whose option IS on the list (review round 2, C2)", () => {
    for (const name of [
      "pressedThenOperator", "pressedThenAdvisor", "recordingMoreInfo", "saidCommaPress", "quotedRobocall",
    ] as const) {
      expect(judged(ES_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("none of them trips the guard partway through, while the caller is still talking", () => {
    // The finished sentence is not the only thing judged — see
    // `trippedAtSomePrefix`. "Para cualquier cosa, marque el nueve" is a
    // complete purpose-then-command until " cinco" arrives.
    const tripped = Object.entries(ES_CUSTOMERS)
      .map(([name, text]) => [name, trippedAtSomePrefix(text)] as const)
      .filter(([, prefix]) => prefix !== null);
    expect(tripped).toEqual([]);
  });
});

describe("looksLikeRecordedMessage — English and Spanglish negatives, the same principle (review round 1, I1)", () => {
  it("someone retelling a menu: 'press 1 for appointments' is a story, not a script", () => {
    for (const name of ["spanglishMenu", "serviceMenu", "languageMenu"] as const) {
      expect(judged(EN_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("someone asking to stop texts, emails or flyers is never hung up on", () => {
    for (const name of ["optOutOfTexts", "unsubscribe", "removedFromThisList"] as const) {
      expect(judged(EN_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("someone quoting a menu, flyer or letter whose option IS on the list (review round 2, C2)", () => {
    for (const name of [
      "operatorRangAndRang", "spanglishAgent", "flyerMoreInfo", "warrantyPaperwork",
      "letterRemovedFromOurList", "saidCommaPress",
    ] as const) {
      expect(judged(EN_CUSTOMERS[name]), name).toBe(false);
    }
  });

  it("none of them trips the guard partway through either", () => {
    const tripped = Object.entries(EN_CUSTOMERS)
      .map(([name, text]) => [name, trippedAtSomePrefix(text)] as const)
      .filter(([, prefix]) => prefix !== null);
    expect(tripped).toEqual([]);
  });
});
