// apps/web/src/app/api/voice/texml/owner-line-copy.ts
// The owner line's spoken words (F-032 §4.1, §4.2): the `ownerLine.say.*` keys of lib/messages.ts, copied here so
// the TeXML answer route never loads the whole catalogue on Telnyx's answer deadline (Task 7 review M-2: the route's
// bundle went from 34 KB to 595 KB with the catalogue in it). NOT a second source of words: messages.ts stays the
// reviewed one, the i18n gates read it, and ./owner-line-copy.test.ts fails unless every key here is byte-identical
// to the catalogue's and the two key sets are the same. Change a sentence there first, then here.
// No imports at all: the TeXML routes import this file statically (plan SC-18).
export const OWNER_LINE_SAY = {
  "ownerLine.say.pinPrompt": "Hi {name}. Enter your PIN, or press pound to talk to {persona}.",
  "ownerLine.say.pinPrompt.es": "Hola, {name}. Marque su PIN, o oprima la tecla de gato para hablar con {persona}.",
  "ownerLine.say.pinPromptNoName": "Hi. Enter your PIN, or press pound to talk to {persona}.",
  "ownerLine.say.pinPromptNoName.es": "Hola. Marque su PIN, o oprima la tecla de gato para hablar con {persona}.",
  "ownerLine.say.pinWrong": "That PIN didn't match. Try again.",
  "ownerLine.say.pinWrong.es": "Ese PIN no coincide. Intente de nuevo.",
  "ownerLine.say.limit": "You've reached today's limit for calling in. Here is {persona}.",
  "ownerLine.say.limit.es": "Ya llegó al límite de llamadas de hoy. Le comunico con {persona}.",
  "ownerLine.say.verifyPrompt": "Enter the 6-digit code shown on your screen.",
  "ownerLine.say.verifyPrompt.es": "Marque el código de 6 dígitos que aparece en su pantalla.",
  "ownerLine.say.verifyWrong": "That code didn't match. Try again.",
  "ownerLine.say.verifyWrong.es": "Ese código no coincide. Intente de nuevo.",
  "ownerLine.say.verifyDone": "Thank you. This phone is verified. You can hang up now.",
  "ownerLine.say.verifyDone.es": "Gracias. Este teléfono quedó verificado. Ya puede colgar.",
} as const;
