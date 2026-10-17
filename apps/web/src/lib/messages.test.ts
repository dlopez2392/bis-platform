import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { m, type MessageKey } from "./messages";

/**
 * Internal roadmap labels must not reach a screen a client can open.
 *
 * The defect this file exists to stop: /calendar told every client "Calendar
 * is coming in M2". Three things wrong with one string, and no gate could see
 * any of them — it was present, correct, and rendered exactly as written.
 *   1. "M2" is an internal roadmap label. It means nothing to the reader.
 *   2. It promises a delivery the reader cannot evaluate or hold us to.
 *   3. The numbering has since DRIFTED, so it is wrong even internally: what
 *      shipped under the name M2 was client access, while the spec's M2 is the
 *      booking module the string was actually promising. A reader cannot tell
 *      which one it meant.
 *
 * Same class as the branding-panel slip that `panel-copy.test.ts` pins —
 * internal language surviving onto a client-facing surface — which is why it
 * gets a guard rather than just a fix.
 *
 * A client's sidebar is six items (Dashboard, Contacts, Opportunities,
 * Conversations, Forms, Calendar) plus their own Branding page. Everything
 * else is gated: Settings and the activation checklist by
 * `requireAgencyOnlyAccountAccess`, the dashboard's checklist panel by an
 * `isAgency` branch, and Companies/Blueprints by the agency-only shell.
 */
const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

/**
 * The exceptions, deliberately NOT the coverage: the assertion runs over every
 * key in the catalogue, so a newly added string is checked by default and has
 * to be consciously named here to be exempt. Each of these renders only behind
 * an agency-only guard, where a roadmap label is a note to ourselves.
 */
// checklist.phone_number.help and checklist.gbp_connect.help WERE exempted
// here (both agency-only strings) until 2026-09-29, when both were rewritten
// to drop their milestone codes (checklist-catalogue.test.ts now runs a
// stricter, unconditional guard over every catalogue string, agency-only or
// not) — removed rather than left behind to wave through a future regression.
// settings.customValuesBody WAS exempted here (agency-only, requireAgency-
// OnlyAccountAccess in settings/page.tsx) until 2026-09-30, when it was
// rewritten to drop both its milestone code and its raw `{{...}}` template
// syntax — removed rather than left behind to wave through a future
// regression.
const AGENCY_ONLY = new Set<string>([]);

describe("messages", () => {
  it("cites no internal roadmap label on a client-reachable string", () => {
    for (const [key, value] of Object.entries(m)) {
      if (AGENCY_ONLY.has(key)) continue;
      expect(value, `"${key}" names an internal milestone: ${value}`)
        .not.toMatch(INTERNAL_MILESTONE);
    }
  });

  /**
   * Keeps the allowlist from rotting into silent permission. If one of these
   * gets reworded away from its label, the exemption should be deleted with
   * it — not left behind to wave through whatever a later edit puts there.
   */
  it("exempts only strings that actually carry a label", () => {
    for (const key of AGENCY_ONLY) {
      expect(m[key as keyof typeof m], `"${key}" no longer needs its exemption`)
        .toMatch(INTERNAL_MILESTONE);
    }
  });
});

/**
 * D-020. Threads also start from a text and from a form submission
 * (sms/inbound's route, forms/enrich.ts both call ensureConversation), not
 * only from an operator's own email — the empty state's one sentence said
 * otherwise (DESIGN.md rule 5: "one sentence of what appears here + the
 * action that causes it", and this one named only ONE of the real actions,
 * as if it were the only one).
 */
describe("conversations.empty.body (D-020)", () => {
  it("does not claim a thread starts only from an operator's own email, and names the real ways one starts", () => {
    const body = m["conversations.empty.body"];
    expect(body).not.toContain("Email a contact from their timeline");
    expect(body.toLowerCase()).toMatch(/\btext/);
    expect(body.toLowerCase()).toMatch(/\bform/);
  });
});

/**
 * Post-merge review of #228 (owner decision): the reserved-key strings named
 * "the source question" / "la pregunta de origen", a name the owner never
 * sees anywhere. The form editor calls that field "Who recommended you?"
 * (forms.kind.core.referral_source), so the settings copy names it the same
 * way, in each language, read off the catalogue rather than retyped.
 */
describe("settings.fieldKeyReserved / settings.fieldKeyFormat name the question the owner sees", () => {
  it.each([
    ["settings.fieldKeyReserved", "forms.kind.core.referral_source"],
    ["settings.fieldKeyFormat", "forms.kind.core.referral_source"],
    ["settings.fieldKeyReserved.es", "forms.kind.core.referral_source.es"],
    ["settings.fieldKeyFormat.es", "forms.kind.core.referral_source.es"],
  ] as const)("%s quotes the form editor's own label (mutation: restore \"source question\" → FAILS)", (key, label) => {
    expect(m[key]).toContain(`"${m[label]}"`);
    expect(m[key]).not.toMatch(/source question|pregunta de origen/i);
  });
});

describe("settings.fieldKeyReserved / settings.fieldKeyFormat say RESERVED in English, as the Spanish says reservado", () => {
  it.each(["settings.fieldKeyReserved", "settings.fieldKeyFormat"] as const)(
    "%s says \"is reserved for\" (mutation: \"is saved for\" → FAILS)", (key) => {
      expect(m[key]).toContain("\"referred_by\" is reserved for");
      expect(m[`${key}.es`]).toContain("\"referred_by\" está reservado para");
    });
});

/**
 * M4 (whole-branch review), Spanish copy. "Lista de tareas" (Checklist) read
 * as the same thing as "Pendientes" (To do) — tareas ARE to-dos — so the
 * checklist is a "Lista de verificación". "Valor en proceso" is not how a
 * Spanish-speaking owner names a pipeline; "embudo" is, and both pipeline
 * labels use it. "Preparación" (Setup) → "Configuración".
 */
describe("Spanish copy review (M4)", () => {
  it("names Checklist, Pipeline value, Pipeline added and Setup in the reviewed words (mutation: restore \"Lista de tareas\" → FAILS)", () => {
    expect(m["nav.checklist.es"]).toBe("Lista de verificación");
    expect(m["account.pipelineValue.es"]).toBe("Valor del embudo");
    expect(m["dashboard.kpi.pipelineAdded.es"]).toBe("Nuevo valor del embudo");
    expect(m["nav.setup.es"]).toBe("Configuración");
  });

  it("no two sidebar labels read the same in Spanish (mutation: give nav.checklist.es the same text as nav.tasks.es → FAILS)", () => {
    const spanishNav = Object.entries(m).filter(([k]) => k.startsWith("nav.") && k.endsWith(".es")).map(([, v]) => v);
    expect(new Set(spanishNav).size).toBe(spanishNav.length);
    expect(spanishNav.some((v) => /\btareas\b/i.test(v))).toBe(false);
  });
});

// Final fix wave (Mis preferencias copy): a person's theme is theirs, not the
// business account's, so its Spanish never says "cuenta" (which in this app
// is the business), and it calls the setting what the legend calls it,
// "tema", never a second word ("aspecto").
// S-03 1b minors: automations.reason.accountSuppressed reaches the operator
// through sendSmsAction's rejection toast (conversations/actions.ts), which
// had no Spanish twin at all — the ratchet's frozen baseline had it as a
// known gap (deviation #11).
describe("automations.reason.accountSuppressed has a Spanish twin", () => {
  it("is plain Spanish, distinct from the English (mutation: copy the English string -> FAILS)", () => {
    expect(m["automations.reason.accountSuppressed.es"]).toBe("Esta cuenta aún no está enviando");
    expect(m["automations.reason.accountSuppressed.es"]).not.toBe(m["automations.reason.accountSuppressed"]);
  });
});

describe("prefs theme copy in Spanish names the theme, not the account", () => {
  const themeEs = Object.entries(m).filter(([k]) =>
    (k.startsWith("prefs.theme.") || k.startsWith("prefs.saved.theme.")) && k.endsWith(".es"));
  it("covers the theme strings (positive control)", () => {
    expect(themeEs.length).toBeGreaterThanOrEqual(8);
  });
  it("never says cuenta or aspecto (mutation: restore 'predeterminado de tu cuenta' -> FAILS)", () => {
    for (const [k, v] of themeEs) {
      expect(`${k}: ${v}`).not.toMatch(/cuenta|aspecto/);
    }
  });
  it("says what the brief asked for", () => {
    expect(m["prefs.saved.theme.none.es"]).toBe("Volviste al tema predeterminado.");
    expect(m["prefs.theme.empty.es"]).toBe("Aún no has elegido, así que ves el tema {mode}.");
  });
});

describe("the document vault's copy (S-07 part 1)", () => {
  const CATEGORIES = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"] as const;
  it("the nine category words are the spec's table, in both languages (mutation: change documents.category.estimate.es -> FAILS)", () => {
    const want: Record<(typeof CATEGORIES)[number], [string, string]> = {
      id: ["ID", "Identificación"], contract: ["Contract", "Contrato"], estimate: ["Estimate or quote", "Presupuesto"],
      invoice: ["Invoice or receipt", "Factura o recibo"], photo: ["Photo", "Foto"], permit: ["Permit or license", "Permiso o licencia"],
      insurance: ["Insurance", "Seguro"], warranty: ["Warranty", "Garantía"], other: ["Other", "Otro"],
    };
    for (const k of CATEGORIES) {
      expect([m[`documents.category.${k}` as MessageKey], m[`documents.category.${k}.es` as MessageKey]], k).toEqual(want[k]);
    }
  });
  it("the empty sentence is the spec's, in usted (mutation: 'Sube' for 'Suba' -> FAILS)", () => {
    expect(m["documents.empty.contact"]).toBe("Contracts, IDs, photos and receipts for this customer are kept here. Upload a file or take a photo.");
    expect(m["documents.empty.contact.es"]).toBe("Aquí se guardan los contratos, identificaciones, fotos y recibos de este cliente. Suba un archivo o tome una foto.");
  });
  it("the household and business empty sentences are the spec's, in usted (mutation: swap 'hogar' for 'negocio' -> FAILS)", () => {
    expect(m["documents.empty.household"]).toBe("Contracts, IDs, photos and receipts for this household are kept here. Upload a file or take a photo.");
    expect(m["documents.empty.household.es"]).toBe("Aquí se guardan los contratos, identificaciones, fotos y recibos de este hogar. Suba un archivo o tome una foto.");
    expect(m["documents.empty.business"]).toBe("Contracts, IDs, photos and receipts for this business are kept here. Upload a file or take a photo.");
    expect(m["documents.empty.business.es"]).toBe("Aquí se guardan los contratos, identificaciones, fotos y recibos de este negocio. Suba un archivo o tome una foto.");
  });
  it("the four upload failures are the spec's words, in both languages (mutation: drop 'or contact BIS' -> FAILS)", () => {
    expect(m["documents.error.tooLarge"]).toBe("Too large: {size}. The limit is 25 MB.");
    expect(m["documents.error.tooLarge.es"]).toBe("Demasiado grande: {size}. El límite es de 25 MB.");
    expect(m["documents.error.badType"]).toBe("This kind of file can't be kept here. Use PDF, JPG, PNG, WebP, Word or Excel.");
    expect(m["documents.error.badType.es"]).toBe("Este tipo de archivo no se puede guardar aquí. Use PDF, JPG, PNG, WebP, Word o Excel.");
    expect(m["documents.error.quota"]).toBe("Your account's 5 GB is full. Delete files you no longer need, or contact BIS.");
    expect(m["documents.error.quota.es"]).toBe("Los 5 GB de su cuenta están llenos. Borre los archivos que ya no necesite o comuníquese con BIS.");
    expect(m["documents.error.upload"]).toBe("Couldn't upload. Try again.");
    expect(m["documents.error.upload.es"]).toBe("No se pudo subir. Intente de nuevo.");
  });
  it("a drop while a batch is still uploading says so, in both languages (mutation: change documents.error.busy.es -> FAILS)", () => {
    expect(m["documents.error.busy"]).toBe("Wait for these files to finish uploading, then add more.");
    expect(m["documents.error.busy.es"]).toBe("Espere a que terminen de subir estos archivos y luego agregue más.");
  });
  it("the delete dialog's file line is the owner's wording, both languages (mutation: 'Esto también borra' -> FAILS)", () => {
    expect(m["contacts.delete.alsoFiles"]).toBe("This also deletes {count} files.");
    expect(m["contacts.delete.alsoFiles.es"]).toBe("También se borrarán {count} archivos.");
  });
  it("the delete dialog's singular, failure and partial-failure lines are the owner's wording, both languages (mutation: change keptFiles.es -> FAILS)", () => {
    expect(m["contacts.delete.alsoFilesOne"]).toBe("This also deletes {count} file.");
    expect(m["contacts.delete.alsoFilesOne.es"]).toBe("También se borrará {count} archivo.");
    expect(m["contacts.delete.filesFailed"]).toBe("Couldn't check for files. Close this and try again.");
    expect(m["contacts.delete.filesFailed.es"]).toBe("No se pudo revisar si hay archivos. Cierre esto e intente de nuevo.");
    expect(m["contacts.delete.keptFiles"]).toBe("Deleted {count} · kept {kept} whose files couldn't be deleted. Try again.");
    expect(m["contacts.delete.keptFiles.es"]).toBe("Se borraron {count} · se conservaron {kept} cuyos archivos no se pudieron borrar. Intente de nuevo.");
    expect(m["contacts.delete.filesGoneKept"]).toBe("The files were deleted, but the customers were kept. Try again.");
    expect(m["contacts.delete.filesGoneKept.es"]).toBe("Los archivos se borraron, pero los clientes se conservaron. Intente de nuevo.");
  });
  it("the bulk delete dialog has the exact Spanish (mutation: wrong-but-truthy content in any of the five -> FAILS)", () => {
    expect(m["common.cancel.es"]).toBe("Cancelar");
    expect(m["bulk.delete.es"]).toBe("Borrar…");
    expect(m["bulk.confirmTitle.es"]).toBe("¿Borrar {count} contactos?");
    expect(m["bulk.confirmTitleOne.es"]).toBe("¿Borrar 1 contacto?");
    expect(m["bulk.confirmBody.es"]).toBe("Esto no se puede deshacer. Escriba {count} para confirmar.");
  });
});

describe("the document vault's copy, PR 1b (versions, Delete forever, space used)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.error.fileNotFound": ["We can't find this file anymore. Reload the page.", "Ya no encontramos este archivo. Vuelva a cargar la página."],
    "documents.error.trashed": ["This file is in the trash. Restore it first.", "Este archivo está en la papelera. Restáurelo primero."],
    "documents.newVersion": ["Upload new version", "Subir una versión nueva"],
    "documents.versionAdded": ["New version of {title} added.", "Se agregó una versión nueva de {title}."],
    "documents.version": ["Version {n}", "Versión {n}"],
    "documents.versions": ["Versions", "Versiones"],
    "documents.versionLine": ["Version {n} · {when}", "Versión {n} · {when}"],
    "documents.versionCurrent": ["Current", "Actual"],
    "documents.downloadVersion": ["Download version {n}", "Descargar la versión {n}"],
    "documents.deleteForever": ["Delete forever", "Borrar para siempre"],
    "documents.purge.body": ["This deletes {title} and all of its versions for good. It can't be undone.", "Esto borra {title} y todas sus versiones para siempre. No se puede deshacer."],
    "documents.purge.bodyOne": ["This deletes {title} for good. It can't be undone.", "Esto borra {title} para siempre. No se puede deshacer."],
    "documents.purge.label": ["Type the file's name to confirm", "Escriba el nombre del archivo para confirmar"],
    "documents.purge.mismatch": ["The name doesn't match. Type it exactly as shown.", "El nombre no coincide. Escríbalo tal como aparece."],
    "documents.purged": ["{title} was deleted for good.", "{title} se borró para siempre."],
    "documents.error.purgeUploading": ["A new version of this file is still uploading. Try again later.", "Todavía se está subiendo una versión nueva de este archivo. Intente de nuevo más tarde."],
    "documents.error.purgeRole": ["Only an Owner can delete a file forever.", "Solo un dueño puede borrar un archivo para siempre."],
    "documents.error.purgeChanged": ["Someone changed this file first, so it was not deleted.", "Alguien cambió este archivo primero, así que no se borró."],
    "documents.error.purge": ["Couldn't delete that file. Try again.", "No se pudo borrar ese archivo. Intente de nuevo."],
    "documents.spaceUsed": ["{used} of {quota} GB used", "{used} de {quota} GB usados"],
    "timeline.documentVersion": ["uploaded a new version of {title}", "subió una nueva versión de {title}"],
    "documents.status.purging": ["Being deleted", "Se está borrando"],
  };
  it("every new key is the plan's wording, in both languages (mutation: 'Sube' for 'Suba'-style tú in any .es, or any word changed -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("the file's own 'not found' says file, and the record's still says record and the in-flight refusal promises no time (review M6) (mutations: point fileNotFound at the record wording -> FAILS; 'Try again in a few minutes.' -> FAILS)", () => {
    expect(m["documents.error.fileNotFound"]).toMatch(/\bfile\b/);
    expect(m["documents.error.fileNotFound.es"]).toMatch(/\barchivo\b/);
    // Review M6: the in-flight refusal can last hours, so it promises no time.
    expect(m["documents.error.purgeUploading"]).not.toMatch(/minute/);
    expect(m["documents.error.purgeUploading.es"]).not.toMatch(/minuto/);
    expect([m["documents.error.notFound"], m["documents.error.notFound.es"]]).toEqual([
      "We can't find this record anymore. Reload the page.", "Ya no encontramos este registro. Vuelva a cargar la página."]);
  });
});

describe("the document vault's copy, PR 2a (virus scanning)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.status.scanning": ["Checking", "Revisando"],
    "documents.status.scanSlow": ["Taking longer than usual", "Tarda más de lo normal"],
    "documents.status.virusRemoved": ["Removed: it had a virus", "Quitado: tenía un virus"],
    "documents.status.unscannable": ["Couldn't check this file", "No se pudo revisar este archivo"],
    "documents.viewer.scanning": ["This file opens once it has been checked for viruses. That usually takes a few seconds.", "Este archivo se abre cuando termine la revisión de virus. Normalmente tarda unos segundos."],
    "documents.viewer.virusRemoved": ["This file had a virus, so it was removed. Move it to the trash, or upload a new version.", "Este archivo tenía un virus, así que se quitó. Muévalo a la papelera o suba una versión nueva."],
    "documents.viewer.unscannable": ["We couldn't check this file for viruses, so it was removed. Upload it again.", "No pudimos revisar este archivo, así que se quitó. Vuelva a subirlo."],
    "documents.error.scanning": ["This file is still being checked. Try again in a moment.", "Este archivo todavía se está revisando. Intente de nuevo en un momento."],
    "documents.error.removed": ["This file was removed and can't be opened.", "Este archivo se quitó y no se puede abrir."],
    "timeline.documentRemoved": ["removed {title}: it had a virus", "quitó {title}: tenía un virus"],
    "timeline.documentUnscannable": ["removed {title}: it couldn't be checked", "quitó {title}: no se pudo revisar"],
    "documents.status.passwordRemoved": ["Password-protected: remove the password and upload it again", "Tiene contraseña: quítela y vuelva a subirlo"],
    "documents.viewer.passwordRemoved": ["This file has a password, so we couldn't check it for viruses and it was removed. Remove the password and upload it again.", "Este archivo tiene contraseña, así que no pudimos revisarlo y se quitó. Quítele la contraseña y vuelva a subirlo."],
    "timeline.documentPassword": ["removed {title}: it has a password", "quitó {title}: tiene contraseña"],
  };
  it("every new key is the plan's wording, in both languages (mutation: any word changed, or a tú form such as 'Mueve' -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("no new string names the machinery (mutation: 'The scanner is checking this file' -> FAILS)", () => {
    for (const k of Object.keys(WANT)) {
      for (const text of [m[k as MessageKey], m[`${k}.es` as MessageKey]]) {
        expect(typeof text, k).toBe("string");
        expect(/clamav|scanner|escáner|fly|supabase|signature|firma|storage/i.test(text ?? "x"), k).toBe(false);
      }
    }
  });
});

describe("the document vault's copy, PR 2b (customer upload links)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.request.open": ["Ask the customer", "Pedir al cliente"],
    "documents.request.title": ["Ask {name} for documents", "Pedir documentos a {name}"],
    "documents.request.what": ["What do you need?", "¿Qué necesita?"],
    "documents.request.otherNote": ["What is it?", "¿Qué es?"],
    "documents.request.how": ["How should it go?", "¿Cómo se lo enviamos?"],
    "documents.request.channel.text": ["Text", "Mensaje de texto"],
    "documents.request.channel.email": ["Email", "Correo"],
    "documents.request.channel.link": ["Copy link", "Copiar enlace"],
    "documents.request.textOff": ["Texting isn't available for this customer.", "No se le pueden enviar mensajes de texto a este cliente."],
    "documents.request.emailOff": ["There's no email address on file.", "No hay un correo en el expediente."],
    "documents.request.send": ["Send request", "Enviar pedido"],
    "documents.request.createLink": ["Create link", "Crear enlace"],
    "documents.request.cancel": ["Cancel", "Cancelar"],
    "documents.request.pickOne": ["Pick at least one document.", "Elija al menos un documento."],
    "documents.request.noteNeeded": ["Say what you need under Other.", "Diga qué necesita en Otro."],
    "documents.request.sentText": ["Request sent by text.", "Pedido enviado por mensaje de texto."],
    "documents.request.sentEmail": ["Request sent by email.", "Pedido enviado por correo."],
    "documents.request.held": ["Request saved. It goes out at {time}, after quiet hours.", "Pedido guardado. Sale a las {time}, después del horario de descanso."],
    "documents.request.linkCopied": ["Link copied. It works for 7 days.", "Enlace copiado. Funciona por 7 días."],
    "documents.request.copyFailed": ["Your browser didn't let us copy it. Here's the link to copy yourself:", "Su navegador no nos dejó copiarlo. Este es el enlace para copiarlo usted:"],
    "documents.request.notSent": ["Request saved, but not sent: {reason}. Copy the link instead.", "Pedido guardado, pero no se envió: {reason}. Copie el enlace en su lugar."],
    "documents.request.failed": ["Couldn't create the request. Try again.", "No se pudo crear el pedido. Intente de nuevo."],
    "documents.request.reason.textsStopped": ["they asked not to get texts", "pidió no recibir mensajes de texto"],
    "documents.request.reason.noPhone": ["there's no number we can text", "no hay un número para mensajes de texto"],
    "documents.request.reason.textSetup": ["texting isn't set up yet", "los mensajes de texto aún no están configurados"],
    "documents.request.reason.noEmail": ["there's no email address", "no hay un correo"],
    "documents.request.reason.emailStopped": ["they asked not to get these emails", "pidió no recibir estos correos"],
    "documents.request.reason.bounced": ["this email address bounced", "este correo rebotó"],
    "documents.request.reason.failed": ["it couldn't be delivered", "no se pudo entregar"],
    "documents.request.task.received": ["{name} sent documents · Review", "{name} mandó documentos · Revisar"],
    "documents.request.task.storageFull": ["{name} couldn't send documents: your storage is full", "{name} no pudo mandar documentos: su espacio está lleno"],
    "documents.requests.label": ["Asked for", "Pedido"],
    "documents.requests.expires": ["expires in {count} days", "vence en {count} días"],
    "documents.requests.expiresOne": ["expires in 1 day", "vence en 1 día"],
    "documents.requests.expiresToday": ["expires today", "vence hoy"],
    "documents.requests.received": ["Received", "Recibido"],
    "documents.requests.waiting": ["Waiting", "Pendiente"],
    "documents.requests.copy": ["Copy link", "Copiar enlace"],
    "documents.requests.revoke": ["Revoke", "Anular"],
    "documents.requests.revoked": ["Request revoked.", "Pedido anulado."],
    "documents.requests.loadFailed": ["Couldn't load the requests.", "No se pudieron cargar los pedidos."],
    "documents.addedByCustomer": ["Sent by the customer · {when}", "Enviado por el cliente · {when}"],
    "timeline.documentRequest": ["asked for {count} documents", "pidió {count} documentos"],
    "timeline.documentRequestOne": ["asked for 1 document", "pidió 1 documento"],
    "timeline.documentCustomer": ["sent {title}", "mandó {title}"],
    "activity.source.documentRequest": ["Document request", "Pedido de documentos"],
    "documentRequest.sms": ["{business}: please send us {items}. Upload them here:", "{business}: por favor envíenos {items}. Súbalos aquí:"],
    "documentRequest.email.subject": ["{business} needs a few documents", "{business} necesita unos documentos"],
    "documentRequest.email.body": ["Please send us: {items}. The link works for 7 days, and you don't need an account.", "Por favor envíenos: {items}. El enlace funciona por 7 días y no necesita una cuenta."],
    "documentRequest.email.button": ["Upload documents", "Subir documentos"],
    "customerDocs.pageTitle": ["Send documents", "Enviar documentos"],
    "customerDocs.heading": ["{business} asks for these documents", "{business} le pide estos documentos"],
    "customerDocs.intro": ["Upload each one below. Only {business} will see them.", "Suba cada uno abajo. Solo {business} los verá."],
    "customerDocs.headingNoName": ["The business asks for these documents", "El negocio le pide estos documentos"],
    "customerDocs.introNoName": ["Upload each one below. Only the business will see them.", "Suba cada uno abajo. Solo el negocio los verá."],
    "customerDocs.upload": ["Upload", "Subir"],
    "customerDocs.takePhoto": ["Take photo", "Tomar foto"],
    "customerDocs.uploading": ["Uploading {percent} %", "Subiendo {percent} %"],
    "customerDocs.checking": ["Checking", "Revisando"],
    "customerDocs.received": ["Received", "Recibido"],
    "customerDocs.refused": ["We couldn't accept this file", "No pudimos aceptar este archivo"],
    "customerDocs.why.type": ["Use a PDF, a photo, or a Word or Excel file.", "Use un PDF, una foto o un archivo de Word o Excel."],
    "customerDocs.why.size": ["It's over 25 MB.", "Pesa más de 25 MB."],
    "customerDocs.why.virus": ["It had a virus.", "Tenía un virus."],
    "customerDocs.why.password": ["It has a password: remove it and upload it again.", "Tiene contraseña: quítela y vuelva a subirlo."],
    "customerDocs.why.unscannable": ["We couldn't check it. Try another copy.", "No pudimos revisarlo. Pruebe con otra copia."],
    "customerDocs.why.full": ["Please call {business} at {phone}.", "Por favor llame a {business} al {phone}."],
    "customerDocs.why.fullNoPhone": ["Please call {business}.", "Por favor llame a {business}."],
    "customerDocs.why.fullNoName": ["Please call the business at {phone}.", "Por favor llame al negocio al {phone}."],
    "customerDocs.why.fullNoPhoneNoName": ["Please call the business.", "Por favor llame al negocio."],
    "customerDocs.why.limit": ["That's a lot of files for one day. Try again tomorrow.", "Son muchos archivos para un día. Intente mañana."],
    "customerDocs.failed": ["Didn't upload. Try again.", "No se subió. Intente de nuevo."],
    "customerDocs.done": ["Thank you. {business} has everything it asked for.", "Gracias. {business} ya tiene todo lo que pidió."],
    "customerDocs.doneNoName": ["Thank you. The business has everything it asked for.", "Gracias. El negocio ya tiene todo lo que pidió."],
    "customerDocs.expired": ["This link has expired.", "Este enlace venció."],
    "customerDocs.revoked": ["This link is no longer active.", "Este enlace ya no está activo."],
    "customerDocs.notFound": ["This link doesn't work.", "Este enlace no funciona."],
    "customerDocs.ask": ["Ask {business} for a new link.", "Pida a {business} un enlace nuevo."],
    "customerDocs.call": ["Questions? Call {business} at {phone}.", "¿Preguntas? Llame a {business} al {phone}."],
    "customerDocs.callNoPhone": ["Questions? Contact {business}.", "¿Preguntas? Comuníquese con {business}."],
    "customerDocs.askNoName": ["Ask the business for a new link.", "Pida al negocio un enlace nuevo."],
    "customerDocs.callNoName": ["Questions? Call the business at {phone}.", "¿Preguntas? Llame al negocio al {phone}."],
    "customerDocs.callNoPhoneNoName": ["Questions? Contact the business.", "¿Preguntas? Comuníquese con el negocio."],
    "customerDocs.business": ["the business", "el negocio"],
    "customerDocs.poweredBy": ["Powered by BIS", "Con tecnología de BIS"],
    "customerDocs.error.title": ["Something went wrong on our side.", "Algo salió mal de nuestro lado."],
    "customerDocs.error.body": ["Please try again in a moment.", "Por favor intente de nuevo en un momento."],
    "customerDocs.error.retry": ["Try again", "Intentar de nuevo"],
  };
  it("every new key is the plan's wording, in both languages (mutation: any word changed, or a tú form such as 'Sube' -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("no new string names the machinery (mutation: 'Your upload token expired' -> FAILS)", () => {
    // "storage" is deliberately NOT in this ban list: documents.request.task.storageFull's
    // wording ("your storage is full") is a legitimate customer-facing quota concept, the
    // same way "your inbox is full" is, not a mention of the vendor's storage backend.
    // Supabase/bucket/signed stay banned, so a real vendor leak is still caught.
    for (const k of Object.keys(WANT)) {
      for (const text of [m[k as MessageKey], m[`${k}.es` as MessageKey]]) {
        expect(typeof text, k).toBe("string");
        expect(/token|hash|scanner|escáner|supabase|signed|firmad|request id|bucket/i.test(text ?? "x"), k).toBe(false);
      }
    }
  });
  it("a placeholder in English is a placeholder in Spanish (mutation: drop {items} from documentRequest.sms.es -> FAILS)", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    for (const k of Object.keys(WANT)) expect(holes(m[`${k}.es` as MessageKey]), k).toBe(holes(m[k as MessageKey]));
  });
});

describe("the document vault's copy, PR 2c (the required-documents checklist)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.checklist.label": ["Required", "Requeridos"],
    "documents.checklist.meter": ["{met} of {required}", "{met} de {required}"],
    "documents.checklist.complete": ["Complete", "Completo"],
    "documents.checklist.missing": ["Missing: {category}", "Falta: {category}"],
    "documents.checklist.expired": ["Expired: {category}", "Vencido: {category}"],
    "documents.checklist.checking": ["Checking: {category}", "Revisando: {category}"],
    "documents.checklist.notNeeded": ["{category} · Not needed", "{category} · No hace falta"],
    "documents.checklist.skip": ["Not needed", "No hace falta"],
    "documents.checklist.unskip": ["Needed again", "Hace falta otra vez"],
    "documents.checklist.skipped": ["{category} isn't needed for this customer.", "{category} no hace falta para este cliente."],
    "documents.checklist.unskipped": ["{category} is needed again.", "{category} hace falta otra vez."],
    "documents.checklist.loadFailed": ["Couldn't load the list.", "No se pudo cargar la lista."],
    "documents.checklist.skipRole": ["Only an Owner or Staff can change a customer's list.", "Solo un dueño o un empleado puede cambiar la lista de un cliente."],
    "documents.checklist.changed": ["Someone changed this first. Reload to see it.", "Alguien lo cambió primero. Vuelva a cargar para verlo."],
    "documents.checklist.notRequired": ["That document isn't on the list anymore.", "Ese documento ya no está en la lista."],
    // M2: the skip actions' own refusal (a malformed id, an unknown or Other category), never 2b's documents.request.refused.
    "documents.checklist.refused": ["We couldn't change that. Reload the page.", "No pudimos cambiar eso. Vuelva a cargar la página."],
    // M9: the checklist's own crash sentence, in usted; common.actionCrashed.es is in tú (messages.ts:312).
    "documents.checklist.crashed": ["That didn't go through. This page may be out of date: reload it and try again.", "Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo."],
    "timeline.documentSkip": ["marked {category} as not needed", "marcó que {category} no hace falta"],
    "timeline.documentUnskip": ["marked {category} as needed again", "marcó que {category} hace falta otra vez"],
    "settings.requiredDocuments.title": ["Required documents", "Documentos requeridos"],
    "settings.requiredDocuments.body": ["Each customer's Documents card will show which of these they're missing.", "La tarjeta de Documentos de cada cliente mostrará cuáles de estos le faltan."],
    "settings.requiredDocuments.off": ["Nothing is required yet, so the list is off.", "Todavía no se requiere nada, así que la lista está apagada."],
    "settings.requiredDocuments.saved": ["Saved. Each customer's Documents card shows the list.", "Guardado. La tarjeta de Documentos de cada cliente muestra la lista."],
    "settings.requiredDocuments.savedOff": ["Saved. The list is off.", "Guardado. La lista está apagada."],
    "settings.requiredDocuments.role": ["Only an Owner can change this list.", "Solo un dueño puede cambiar esta lista."],
    "settings.requiredDocuments.failed": ["Couldn't save the list. Try again.", "No se pudo guardar la lista. Intente de nuevo."],
    "palette.settings.requiredDocuments": ["Required documents", "Documentos requeridos"],
  };
  it("every new key is the plan's wording, in both languages (mutation: any word changed, or a tú form such as 'Vuelve' -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("no new string names the machinery or the customer (mutation: 'Couldn't load the skip rows' or a {name} -> FAILS)", () => {
    for (const k of Object.keys(WANT)) {
      for (const text of [m[k as MessageKey], m[`${k}.es` as MessageKey]]) {
        expect(typeof text, k).toBe("string");
        expect(/token|rls|definer|skip row|category key|supabase|bucket|\{name\}|\{business\}/i.test(text ?? "x"), k).toBe(false);
        expect(/\b(vuelve|intenta|elige|sube|pide|recárgala|inténtalo)\b/i.test(text ?? "x"), k).toBe(false);
      }
    }
  });
  it("a placeholder in English is a placeholder in Spanish (mutation: drop {category} from documents.checklist.missing.es -> FAILS)", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    for (const k of Object.keys(WANT)) expect(holes(m[`${k}.es` as MessageKey]), k).toBe(holes(m[k as MessageKey]));
  });
});

describe("S-06 part 1: inbound email keys, English and Spanish (plan Task 2)", () => {
  const WANT: Record<string, string> = {
    "conversations.held.filter": "Needs a look",
    "conversations.held.filter.es": "Por revisar",
    "conversations.held.filterCount": "Needs a look · {count}",
    "conversations.held.filterCount.es": "Por revisar · {count}",
    "conversations.held.title": "Emails that need a look",
    "conversations.held.title.es": "Correos por revisar",
    "conversations.held.empty": "Emails we couldn't match to a customer wait here for you to file.",
    "conversations.held.empty.es": "Aquí esperan los correos que no pudimos vincular con un cliente, para que usted los archive.",
    "conversations.held.loadFailed": "We couldn't load these emails. Reload the page to try again.",
    "conversations.held.loadFailed.es": "No pudimos cargar estos correos. Vuelva a cargar la página para intentarlo de nuevo.",
    "conversations.held.reason.notOnRecord": "Not on this customer's record",
    "conversations.held.reason.notOnRecord.es": "No está en el registro de este cliente",
    "conversations.held.reason.unverified": "Couldn't confirm who sent it",
    "conversations.held.reason.unverified.es": "No pudimos confirmar quién lo envió",
    "conversations.held.suggestion": "A reply to an email sent to {name}",
    "conversations.held.suggestion.es": "Respuesta a un correo enviado a {name}",
    "conversations.held.noSubject": "(no subject)",
    "conversations.held.noSubject.es": "(sin asunto)",
    "conversations.held.fileOn": "File on {name}",
    "conversations.held.fileOn.es": "Archivar con {name}",
    "conversations.held.choose": "Choose a record",
    "conversations.held.choose.es": "Elegir un registro",
    "conversations.held.searchLabel": "Find a customer",
    "conversations.held.searchLabel.es": "Buscar un cliente",
    "conversations.held.searchEmpty": "No customer matches that.",
    "conversations.held.searchEmpty.es": "Ningún cliente coincide con eso.",
    "conversations.held.searchFailed": "Couldn't search right now. Try again.",
    "conversations.held.searchFailed.es": "No se pudo buscar en este momento. Inténtelo de nuevo.",
    "conversations.held.notCustomer": "Not a customer",
    "conversations.held.notCustomer.es": "No es un cliente",
    "conversations.held.filed": "Filed on {name}.",
    "conversations.held.filed.es": "Archivado con {name}.",
    "conversations.held.dismissed": "Marked as not a customer.",
    "conversations.held.dismissed.es": "Marcado como que no es un cliente.",
    "conversations.held.undone": "Back in Needs a look.",
    "conversations.held.undone.es": "De vuelta en Por revisar.",
    "conversations.held.undoneStopped": "Back in Needs a look, but their emails are still stopped. Open their record to turn them back on.",
    "conversations.held.undoneStopped.es": "De vuelta en Por revisar, pero sus correos siguen detenidos. Abra su ficha para volver a activarlos.",
    "conversations.held.changed": "Someone already handled this email. Reload to see where it is.",
    "conversations.held.changed.es": "Alguien ya atendió este correo. Vuelva a cargar para ver dónde está.",
    "conversations.held.failed": "That didn't save. Try again.",
    "conversations.held.failed.es": "No se guardó. Inténtelo de nuevo.",
    "conversations.reply.fromMember": "from {name}",
    "conversations.reply.fromMember.es": "de {name}",
    "conversations.reply.attachments": "{count} attachments — not saved yet",
    "conversations.reply.attachments.es": "{count} archivos adjuntos — aún no se guardan",
    "conversations.reply.attachmentsOne": "1 attachment — not saved yet",
    "conversations.reply.attachmentsOne.es": "1 archivo adjunto — aún no se guarda",
    "conversations.reply.stopped": "Stopped marketing emails · from their reply",
    "conversations.reply.stopped.es": "Se detuvieron los correos de promoción · por su respuesta",
    "conversations.reply.stopUndone": "Marketing emails are on again.",
    "conversations.reply.stopUndone.es": "Los correos de promoción están activos otra vez.",
    "conversations.reply.maybeStop": "May want to stop",
    "conversations.reply.maybeStop.es": "Quizás quiere dejar de recibirlos",
    "conversations.reply.stopDone": "Emails stopped.",
    "conversations.reply.stopDone.es": "Correos detenidos.",
    "conversations.reply.stopExpired": "Only the customer can turn these emails back on.",
    "conversations.reply.stopExpired.es": "Solo el cliente puede volver a activar estos correos.",
    "contact.email.replyExpiredExplain": "Stopped by their reply more than 7 days ago. Only the customer can turn emails back on.",
    "contact.email.replyExpiredExplain.es": "Se detuvo por su respuesta hace más de 7 días. Solo el cliente puede volver a activar los correos.",
    "work.heldEmails": "{count} emails need a look",
    "work.heldEmails.es": "{count} correos por revisar",
    "work.heldEmailsOne": "1 email needs a look",
    "work.heldEmailsOne.es": "1 correo por revisar",
    "contact.email.how.reply": "they asked in a reply",
    "contact.email.how.reply.es": "lo pidió en una respuesta",
    "settings.replies.label": "Replies",
    "settings.replies.label.es": "Respuestas",
    "settings.replies.off": "Off",
    "settings.replies.off.es": "Apagado",
    "settings.replies.bis": "BIS address",
    "settings.replies.bis.es": "Dirección de BIS",
    "settings.replies.own": "Own domain",
    "settings.replies.own.es": "Dominio propio",
    "settings.replies.offBody": "Customers' replies go to the reply-to address on Branding.",
    "settings.replies.offBody.es": "Las respuestas de los clientes van a la dirección de respuesta de Marca.",
    "settings.replies.bisBody": "Customers reply to an address at reply.bis-rgv.com, and the reply lands on their thread here.",
    "settings.replies.bisBody.es": "Los clientes responden a una dirección en reply.bis-rgv.com, y la respuesta llega a su conversación aquí.",
    "settings.replies.ownBody": "Customers reply to an address at {domain}, and the reply lands on their thread here.",
    "settings.replies.ownBody.es": "Los clientes responden a una dirección en {domain}, y la respuesta llega a su conversación aquí.",
    "settings.replies.domainLabel": "Reply domain",
    "settings.replies.domainLabel.es": "Dominio de respuesta",
    "settings.replies.checkDns": "Check DNS",
    "settings.replies.checkDns.es": "Revisar DNS",
    "settings.replies.dnsOk": "The MX record points at Resend. You can use this domain.",
    "settings.replies.dnsOk.es": "El registro MX apunta a Resend. Puede usar este dominio.",
    "settings.replies.dnsMissing": "No MX record on {domain} points at Resend yet. Add it, then check again.",
    "settings.replies.dnsMissing.es": "Aún no hay un registro MX en {domain} que apunte a Resend. Agréguelo y vuelva a revisar.",
    "settings.replies.dnsFailed": "We couldn't look up {domain}. Check the spelling and try again.",
    "settings.replies.dnsFailed.es": "No pudimos consultar {domain}. Revise cómo está escrito e inténtelo de nuevo.",
    "settings.replies.invalidDomain": "Enter a domain like reply.example.com.",
    "settings.replies.invalidDomain.es": "Escriba un dominio como reply.example.com.",
    "settings.replies.domainTaken": "Another account already uses that domain.",
    "settings.replies.domainTaken.es": "Otra cuenta ya usa ese dominio.",
    "settings.replies.saved": "Replies: {mode}.",
    "settings.replies.saved.es": "Respuestas: {mode}.",
    "settings.replies.undone": "Replies are back to {mode}.",
    "settings.replies.undone.es": "Las respuestas volvieron a {mode}.",
    "branding.replies.agency": "Customer replies come back into BIS at {domain}; the reply-to address above gets a copy.",
    "branding.replies.agency.es": "Las respuestas de los clientes regresan a BIS en {domain}; la dirección de respuesta de arriba recibe una copia.",
    "branding.replies.client": "Your customers' replies come back into BIS at {domain}, and a copy goes to the reply-to address above.",
    "branding.replies.client.es": "Las respuestas de sus clientes regresan a BIS en {domain}, y una copia llega a la dirección de respuesta de arriba.",
    "email.replyForward.fromName": "{customer} via {business}",
    "email.replyForward.fromName.es": "{customer} vía {business}",
    "email.replyForward.answer": "Answer in BIS",
    "email.replyForward.answer.es": "Responder en BIS",
    "email.replyForward.attachments": "This email had {count} attachments. They are not saved in BIS yet.",
    "email.replyForward.attachments.es": "Este correo traía {count} archivos adjuntos. Aún no se guardan en BIS.",
    "email.replyForward.attachmentsOne": "This email had 1 attachment. It is not saved in BIS yet.",
    "email.replyForward.attachmentsOne.es": "Este correo traía 1 archivo adjunto. Aún no se guarda en BIS.",
  };

  it("has every key with exactly this text (mutation: change any .es string → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("every English key has its .es twin on the very next line (mutation: move a twin → FAILS)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es"))) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve a cargar' in .changed.es → FAILS; drop {domain} from dnsMissing.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  it("no client-facing key uses provider or internal words (mutation: 'token' in a conversations.* key → FAILS)", () => {
    const BANNED = /\b(token|dkim|dmarc|spf|ses|webhook|resend|mx)\b/i;
    for (const [k, v] of Object.entries(WANT)) {
      if (k.startsWith("settings.replies.")) continue;   // the agency's own Settings card names DNS and MX on purpose
      expect(BANNED.test(v), k).toBe(false);
    }
  });
});

describe("S-06 part 2: forward to a record and Never record keys, English and Spanish (plan Task 2)", () => {
  const WANT: Record<string, string> = {
    "contact.forwarding.label": "Forwarding address",
    "contact.forwarding.label.es": "Dirección para reenviar",
    "contact.forwarding.hint": "Forward an email here to save it on this customer.",
    "contact.forwarding.hint.es": "Reenvíe un correo a esta dirección para guardarlo con este cliente.",
    "contact.forwarding.copy": "Copy",
    "contact.forwarding.copy.es": "Copiar",
    "contact.forwarding.copyLabel": "Copy the forwarding address",
    "contact.forwarding.copyLabel.es": "Copiar la dirección para reenviar",
    "contact.forwarding.copied": "Copied",
    "contact.forwarding.copied.es": "Copiado",
    "contact.forwarding.copyFailed": "Couldn't copy. Select the address and copy it by hand.",
    "contact.forwarding.copyFailed.es": "No se pudo copiar. Seleccione la dirección y cópiela a mano.",
    "contact.forwarding.turnOn": "Turn on Replies in Settings to get a forwarding address",
    "contact.forwarding.turnOn.es": "Active Respuestas en Configuración para obtener una dirección para reenviar",
    "contact.forwarding.failed": "We couldn't load the forwarding address. Reload the page to try again.",
    "contact.forwarding.failed.es": "No pudimos cargar la dirección para reenviar. Vuelva a cargar la página para intentarlo de nuevo.",
    "conversations.forward.by": "Forwarded by {name} · team",
    "conversations.forward.by.es": "Reenviado por {name} · equipo",
    "conversations.forward.bySomeone": "Forwarded by someone on the team",
    "conversations.forward.bySomeone.es": "Reenviado por alguien del equipo",
    "neverLog.title": "Never record",
    "neverLog.title.es": "No registrar nunca",
    "neverLog.body": "Mail from these addresses or domains is dropped and never saved, even when it comes from a customer.",
    "neverLog.body.es": "El correo de estas direcciones o dominios se descarta y nunca se guarda, aunque venga de un cliente.",
    "neverLog.empty": "Mail from addresses or domains you add here is never saved.",
    "neverLog.empty.es": "El correo de las direcciones o dominios que agregue aquí nunca se guarda.",
    "neverLog.loadFailed": "We couldn't load this list. Reload the page to try again.",
    "neverLog.loadFailed.es": "No pudimos cargar esta lista. Vuelva a cargar la página para intentarlo de nuevo.",
    "neverLog.inputLabel": "Address or domain",
    "neverLog.inputLabel.es": "Dirección o dominio",
    "neverLog.placeholder": "billing@supplier.com or supplier.com",
    "neverLog.placeholder.es": "facturas@proveedor.com o proveedor.com",
    "neverLog.add": "Add",
    "neverLog.add.es": "Agregar",
    "neverLog.remove": "Remove",
    "neverLog.remove.es": "Quitar",
    "neverLog.removeLabel": "Remove {pattern}",
    "neverLog.removeLabel.es": "Quitar {pattern}",
    "neverLog.kind.address": "Address",
    "neverLog.kind.address.es": "Dirección",
    "neverLog.kind.domain": "Whole domain",
    "neverLog.kind.domain.es": "Todo el dominio",
    "neverLog.added": "Mail from {pattern} will never be saved.",
    "neverLog.added.es": "El correo de {pattern} nunca se guardará.",
    "neverLog.removed": "{pattern} is off the list.",
    "neverLog.removed.es": "{pattern} ya no está en la lista.",
    "neverLog.undone": "Back as it was.",
    "neverLog.undone.es": "Quedó como estaba.",
    "neverLog.duplicate": "Already on the list.",
    "neverLog.duplicate.es": "Ya está en la lista.",
    "neverLog.invalid": "Enter an address like name@example.com or a domain like example.com.",
    "neverLog.invalid.es": "Escriba una dirección como nombre@ejemplo.com o un dominio como ejemplo.com.",
    "neverLog.full": "The list is full (200). Remove one to add another.",
    "neverLog.full.es": "La lista está llena (200). Quite una para agregar otra.",
    "neverLog.failed": "That didn't save. Try again.",
    "neverLog.failed.es": "No se guardó. Inténtelo de nuevo.",
  };

  it("has every key with exactly this text (mutation: change any .es string → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("is 28 English keys, each with its .es twin on the very next line (mutation: move a twin → FAILS)", () => {
    const en = Object.keys(WANT).filter((x) => !x.endsWith(".es"));
    expect(en).toHaveLength(28);
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of en) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve a cargar' in .failed.es → FAILS; drop {pattern} from added.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?|reenvía|selecciona|quita|activa)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  it("no key uses provider or internal words (mutation: 'token' in contact.forwarding.hint → FAILS)", () => {
    const BANNED = /\b(token|dkim|dmarc|spf|ses|webhook|resend|mx|clerk|pattern)\b/i;
    for (const [k, v] of Object.entries(WANT)) expect(BANNED.test(v.replace(/\{pattern\}/g, "")), k).toBe(false);
  });
});
