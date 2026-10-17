/** S-06 part 1, Inbound step 5: the reply's new text, English and Spanish quote markers stripped. Pure. */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .split("\n").map((l) => l.trim()).filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n")
    .trim();
}

/** A line where the quoted history starts; everything from it on is dropped. */
const CUT: readonly RegExp[] = [
  /^On .+ wrote:\s*$/i,                         // Gmail, Apple Mail (EN)
  /^El .+ escribió:\s*$/i,                      // Gmail (ES)
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,     // Outlook (EN)
  /^-{2,}\s*Mensaje original\s*-{2,}\s*$/i,     // Outlook (ES)
  /^_{10,}\s*$/,                                // Outlook's rule above its From: block
];
// Outlook's "From:/De:" block cuts only when the next line is Sent/Enviado, Date/Fecha, To/Para or
// Subject/Asunto (the `outlookFrom` test below), so "a quote from: Bob's" mid-body is kept.

export function newText(text: string): string {
  // Two-line Gmail markers ("On … <\n…> wrote:") are joined first.
  const lines = text.replace(/\r\n/g, "\n").replace(/(^On [^\n]+)\n([^\n]*wrote:\s*$)/gim, "$1 $2").replace(/(^El [^\n]+)\n([^\n]*escribió:\s*$)/gim, "$1 $2").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // M5: the marker line itself must look like an address line (carries an
    // '@' or a '<'), or ordinary prose that happens to start "De:"/"Para:"
    // (e.g. "De: mi jefe me dijo...") gets mistaken for a quoted thread.
    const outlookFrom = /^(From|De):\s.+$/.test(line) && /[@<]/.test(line) && /^(Sent|Enviado|Date|Fecha|To|Para|Subject|Asunto):/i.test(lines[i + 1] ?? "");
    if (CUT.some((r) => r.test(line)) || outlookFrom) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}
