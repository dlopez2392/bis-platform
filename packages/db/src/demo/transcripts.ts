import type { CallOutcome } from "../voice";

/**
 * What Sofía actually said. These are the demo's most load-bearing content:
 * a screenshot of a KPI proves nothing a chart library cannot fake, and a
 * transcript is the only artefact on the dashboard that shows the product
 * doing the thing it claims to do.
 *
 * Written to three rules, all of which the real product is held to:
 *
 *   1. Sofía books, or she takes a message and says so. She never invents a
 *      price, never promises a technician by name, and never says a time she
 *      has not held. A demo that shows an AI over-promising is a demo of a
 *      liability.
 *   2. Half of these are in Spanish, and the Spanish is written by the
 *      register a Valley household actually uses on the phone — usted, not
 *      textbook neutral. This is the single most valuable thing the product
 *      does in this market and a demo that hides it undersells itself.
 *   3. The failures are here too. `abandoned` and `spam` are outcomes an
 *      owner sees every week, and a call log with five green rows out of five
 *      is the first thing a sceptical buyer stops believing.
 *
 * Turn timestamps are NOT stored here — the seeder stamps them from the
 * call's own start time, so a re-seed moves the whole conversation together
 * rather than leaving a transcript dated to whenever this file was written.
 */
export type DemoTurn = { role: "caller" | "assistant"; text: string };

export type DemoTranscript = {
  key: string;
  lang: "en" | "es";
  outcome: CallOutcome;
  /** Seconds. Drives duration_secs, and the call list shows it. */
  durationSecs: number;
  /** The one-line summary the operator reads before opening anything. */
  summary: string;
  turns: readonly DemoTurn[];
};

export const DEMO_TRANSCRIPTS: readonly DemoTranscript[] = [
  {
    key: "en-booked-noac",
    lang: "en",
    outcome: "booked",
    durationSecs: 97,
    summary: "No cooling since last night, upstairs unit. Booked tomorrow 8–10 AM.",
    turns: [
      { role: "assistant", text: "Thanks for calling Resaca Air Conditioning and Heating, this is Sofía. How can I help?" },
      { role: "caller", text: "Hey — our AC quit sometime last night. Upstairs is already about eighty-two in there." },
      { role: "assistant", text: "That's miserable, I'm sorry. Is the unit running at all, or is it completely silent?" },
      { role: "caller", text: "The fan's going. It's just blowing warm." },
      { role: "assistant", text: "Okay — fan running, no cool air. That's usually something a technician can diagnose on the first visit. I can get someone out tomorrow morning between eight and ten, or tomorrow afternoon between one and three. Which works better?" },
      { role: "caller", text: "Morning. The earlier the better honestly." },
      { role: "assistant", text: "Eight to ten tomorrow it is. Can I get the service address?" },
      { role: "caller", text: "It's 3114 Palm Court, Harlingen." },
      { role: "assistant", text: "3114 Palm Court. And the best number to reach you if the technician is running early?" },
      { role: "caller", text: "This one's fine." },
      { role: "assistant", text: "Perfect. You're booked for tomorrow, eight to ten. You'll get a text confirmation in a minute and a reminder the night before. Anything else I can help with?" },
      { role: "caller", text: "No, that's it. Thank you." },
      { role: "assistant", text: "Of course. We'll see you tomorrow morning." },
    ],
  },
  {
    key: "es-booked-noenfria",
    lang: "es",
    outcome: "booked",
    durationSecs: 112,
    summary: "El aire no enfría desde el martes. Cita agendada para el jueves 10–12.",
    turns: [
      { role: "assistant", text: "Gracias por llamar a Resaca Air Conditioning and Heating, habla Sofía. ¿En qué le puedo ayudar?" },
      { role: "caller", text: "Buenos días. Fíjese que el aire no está enfriando bien desde el martes." },
      { role: "assistant", text: "Con gusto le ayudo. ¿El aire prende y sopla, pero sale el aire tibio, o no prende nada?" },
      { role: "caller", text: "Sí prende, sopla, pero sale tibio. Y hace un ruido como un zumbido afuera." },
      { role: "assistant", text: "Entiendo — sopla pero no enfría, y con un zumbido en la unidad de afuera. Eso lo revisa el técnico en la primera visita. Tengo disponible el jueves de diez a doce, o el viernes temprano de ocho a diez. ¿Cuál le acomoda mejor?" },
      { role: "caller", text: "El jueves está bien." },
      { role: "assistant", text: "Muy bien, jueves de diez a doce. ¿Me regala la dirección del servicio?" },
      { role: "caller", text: "Es el 1802 de la calle Jackson, en Harlingen." },
      { role: "assistant", text: "1802 Jackson, Harlingen. ¿Y este número es el mejor para avisarle si el técnico llega antes?" },
      { role: "caller", text: "Sí, este mismo." },
      { role: "assistant", text: "Perfecto. Ya quedó agendado para el jueves de diez a doce. Le va a llegar un mensaje de confirmación en un momento y un recordatorio un día antes. ¿Algo más en que le pueda ayudar?" },
      { role: "caller", text: "No, eso es todo. Muchas gracias." },
      { role: "assistant", text: "Con mucho gusto. Que tenga buen día." },
    ],
  },
  {
    key: "en-lead-quote",
    lang: "en",
    outcome: "lead",
    durationSecs: 143,
    summary: "Wants a replacement quote — 18-year-old system, 1,900 sq ft. Asked for an estimator to call back.",
    turns: [
      { role: "assistant", text: "Thanks for calling Resaca Air Conditioning and Heating, this is Sofía. How can I help?" },
      { role: "caller", text: "I'm looking at replacing the whole system. It's original to the house, so about eighteen years." },
      { role: "assistant", text: "Eighteen years is right about where replacement starts making more sense than repair. Do you know roughly the square footage?" },
      { role: "caller", text: "Nineteen hundred, single story." },
      { role: "assistant", text: "Got it. I want to be straight with you — I can't quote a replacement over the phone, because the size and the ductwork change the number a lot and I'd rather not give you one that moves later. What I can do is have an estimator come measure and put a real figure in writing, at no charge." },
      { role: "caller", text: "How long does that take?" },
      { role: "assistant", text: "The visit is about forty-five minutes, and the written quote usually comes back the same day. Would you like me to have someone call you to set that up, or should I put you on the schedule now?" },
      { role: "caller", text: "Have them call me. I need to check with my wife on the timing." },
      { role: "assistant", text: "Absolutely. Is this the best number, and is there a time of day that's better for you?" },
      { role: "caller", text: "This number, and after five is best." },
      { role: "assistant", text: "After five, this number. I've passed that along — someone will reach out. Anything else while I have you?" },
      { role: "caller", text: "That's it, thanks." },
      { role: "assistant", text: "You're welcome. Have a good one." },
    ],
  },
  {
    key: "es-lead-mantenimiento",
    lang: "es",
    outcome: "lead",
    durationSecs: 88,
    summary: "Pregunta por el plan de mantenimiento y el precio. Pidió que le llamen con los detalles.",
    turns: [
      { role: "assistant", text: "Gracias por llamar a Resaca Air Conditioning and Heating, habla Sofía. ¿En qué le puedo ayudar?" },
      { role: "caller", text: "Hola. Quería preguntar por el plan de mantenimiento, el que es cada seis meses." },
      { role: "assistant", text: "Claro que sí. El plan incluye dos visitas al año — una antes del calor y otra antes del frío — con limpieza y revisión completa del sistema." },
      { role: "caller", text: "¿Y cuánto sale?" },
      { role: "assistant", text: "El precio depende de cuántas unidades tenga en la casa, y prefiero no darle un número que después cambie. Le puedo pedir a alguien de la oficina que le llame hoy mismo con el precio exacto para su caso. ¿Le parece bien?" },
      { role: "caller", text: "Sí, está bien. Tengo dos unidades, una arriba y una abajo." },
      { role: "assistant", text: "Dos unidades, una arriba y una abajo — ya lo anoté para que no tenga que repetirlo. ¿Este número es el mejor para localizarla?" },
      { role: "caller", text: "Sí, gracias." },
      { role: "assistant", text: "Perfecto, le llamamos hoy. Que esté bien." },
    ],
  },
  {
    key: "en-message-afterhours",
    lang: "en",
    outcome: "message",
    durationSecs: 61,
    summary: "After-hours. Water pooling at the indoor unit — shut off at the breaker, message left for first thing.",
    turns: [
      { role: "assistant", text: "Thanks for calling Resaca Air Conditioning and Heating, this is Sofía. The office is closed right now, but I can take a message or get you on tomorrow's schedule." },
      { role: "caller", text: "There's water all over the floor by the indoor unit. It's coming out of the bottom of it." },
      { role: "assistant", text: "Okay. First thing — do you know where your breaker panel is? If you can shut the system off at the breaker, that stops the water while you wait." },
      { role: "caller", text: "Yeah, I can do that. Hang on... okay, it's off." },
      { role: "assistant", text: "Good. That's usually a blocked drain line, and with the system off it won't get worse overnight. I'm marking this urgent for first thing in the morning — someone will call you before eight to get a technician out. Is this the best number?" },
      { role: "caller", text: "Yes. Thank you, I appreciate it." },
      { role: "assistant", text: "You did the right thing calling. Someone will be in touch before eight." },
    ],
  },
  {
    key: "es-message-recado",
    lang: "es",
    outcome: "message",
    durationSecs: 54,
    summary: "Fuera de horario. Pregunta por una factura; recado tomado para la oficina.",
    turns: [
      { role: "assistant", text: "Gracias por llamar a Resaca Air Conditioning and Heating, habla Sofía. En este momento la oficina está cerrada, pero le puedo tomar un recado." },
      { role: "caller", text: "Sí, mire, es sobre una factura del mes pasado. Creo que me cobraron dos veces." },
      { role: "assistant", text: "Eso lo tiene que ver la oficina directamente — no quiero decirle algo de su cuenta sin verla. ¿Me regala su nombre y le pido que le llamen en la mañana?" },
      { role: "caller", text: "Sí, cómo no." },
      { role: "assistant", text: "Muy bien, ya quedó anotado con el motivo, para que no tenga que explicarlo otra vez. Le llaman mañana en la mañana. Que descanse." },
    ],
  },
  {
    key: "en-abandoned",
    lang: "en",
    outcome: "abandoned",
    durationSecs: 9,
    summary: "Caller hung up before stating a reason.",
    turns: [
      { role: "assistant", text: "Thanks for calling Resaca Air Conditioning and Heating, this is Sofía. How can I help?" },
      { role: "caller", text: "[call ended]" },
    ],
  },
  {
    key: "en-spam",
    lang: "en",
    outcome: "spam",
    durationSecs: 17,
    summary: "Automated sales pitch for business listings. Ended.",
    turns: [
      { role: "assistant", text: "Thanks for calling Resaca Air Conditioning and Heating, this is Sofía. How can I help?" },
      { role: "caller", text: "This is a final courtesy notice regarding your business listing, press one to speak with a representative—" },
      { role: "assistant", text: "This line is for customers. Removing this number from our call list. Goodbye." },
    ],
  },
] as const;
