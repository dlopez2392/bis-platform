import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { m, type MessageKey } from "./messages";
import { t, plural } from "./i18n/t";

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
    expect(m["prefs.saved.theme.none.es"]).toBe("Volvió al tema predeterminado.");
    expect(m["prefs.theme.empty.es"]).toBe("Aún no ha elegido, así que ve el tema {mode}.");
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
    "contact.forwarding.turnOn.es": "Active Respuestas en Ajustes para obtener una dirección para reenviar",
    "contact.forwarding.get": "Get forwarding address",
    "contact.forwarding.get.es": "Obtener dirección para reenviar",
    "contact.forwarding.getFailed": "We couldn't make the forwarding address. Try again.",
    "contact.forwarding.getFailed.es": "No pudimos crear la dirección para reenviar. Inténtelo de nuevo.",
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

  it("is 30 English keys, each with its .es twin on the very next line (mutation: move a twin → FAILS)", () => {
    const en = Object.keys(WANT).filter((x) => !x.endsWith(".es"));
    expect(en).toHaveLength(30);
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of en) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve a cargar' in .failed.es → FAILS; drop {pattern} from added.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?|reenvía|selecciona|quita|activa)\b/i;
    const mm = m as Record<string, string>;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(mm[k]!), k).toBe(false);
      const en = mm[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(mm[k]!), k).toEqual(ph(en));
    }
  });

  it("no key uses provider or internal words (mutation: 'token' in contact.forwarding.hint → FAILS)", () => {
    const BANNED = /\b(token|dkim|dmarc|spf|ses|webhook|resend|mx|clerk|pattern)\b/i;
    for (const [k, v] of Object.entries(WANT)) expect(BANNED.test(v.replace(/\{pattern\}/g, "")), k).toBe(false);
  });
});

describe("S-06 part 3: web chat in the inbox and the record, English and Spanish (plan Task 1)", () => {
  const WANT: Record<string, string> = {
    // G8: the four existing channel words gain Spanish; their English is unchanged.
    "conversations.channel.form": "Form submission",
    "conversations.channel.form.es": "Formulario",
    "conversations.channel.email": "Email",
    "conversations.channel.email.es": "Correo",
    "conversations.channel.voice": "Call",
    "conversations.channel.voice.es": "Llamada",
    "conversations.channel.sms": "Text",
    "conversations.channel.sms.es": "Texto",
    "conversations.channel.webchat": "Web chat",
    "conversations.channel.webchat.es": "Chat web",
    "conversations.compose.via": "Reply by",
    "conversations.compose.via.es": "Responder por",
    "conversations.webchat.unconfirmed": "Matched by the phone or email they typed; not confirmed.",
    "conversations.webchat.unconfirmed.es": "Lo relacionamos por el teléfono o el correo que escribió; no está confirmado.",
    // G23: the chat row's verb and its count, the kit's grammar ("Customer chatted with Sofía … · 12 messages").
    "timeline.webchat": "chatted with {name} on your website",
    "timeline.webchat.es": "conversó con {name} en su sitio web",
    "timeline.webchatCount": "{count} messages",
    "timeline.webchatCount.es": "{count} mensajes",
    "timeline.webchatCountOne": "1 message",
    "timeline.webchatCountOne.es": "1 mensaje",
    // G24, G25.
    "timeline.what.chats": "website chats",
    "timeline.what.chats.es": "chats del sitio web",
    "timeline.openChat": "Open chat",
    "timeline.openChat.es": "Ver chat",
    "record.facts.channel.chat": "website chat",
    "record.facts.channel.chat.es": "chat del sitio web",
  };

  it("has every key with exactly this text (mutation: change any .es string → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("is 13 English keys, each with its .es twin on the very next line (mutation: append conversations.channel.email.es at the end of the file → FAILS)", () => {
    const en = Object.keys(WANT).filter((x) => !x.endsWith(".es"));
    expect(en).toHaveLength(13);
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of en) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'escribiste' in unconfirmed.es → FAILS; drop {count} from webchatCount.es → FAILS)", () => {
    const TU = /\b(escribiste|tu|tus|tienes|puedes|abre|responde|confirmaste)\b/i;
    const mm = m as Record<string, string>;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(mm[k]!), k).toBe(false);
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(mm[k]!), k).toEqual(ph(mm[k.slice(0, -3)]!));
    }
  });

  it("no key uses an internal or vendor word (mutation: 'webchat transcript' in timeline.webchat → FAILS)", () => {
    const BANNED = /\b(webchat|concierge|transcript|provider|index|openai|telnyx|resend)\b/i;
    for (const [k, v] of Object.entries(WANT)) expect(BANNED.test(v), k).toBe(false);
  });
});

describe("S-07 3a: the Documents page, the expiry To-dos and the Owner's Required card (plan Task 2)", () => {
  const KEYS_3A = [
    "nav.documents",
    "documents.page.title",
    "documents.page.show.label", "documents.page.show.expiring", "documents.page.show.expired", "documents.page.show.all",
    "documents.page.category.label", "documents.page.category.any",
    "documents.page.openRecord", "documents.page.noName",
    "documents.page.next", "documents.page.first",
    "documents.page.empty.all", "documents.page.empty.allBody",
    "documents.page.empty.expiring", "documents.page.empty.expiringBody", "documents.page.empty.expired",
    "documents.page.loadFailed",
    "documents.expiryTask.noName",
    "documents.expiryTask.id", "documents.expiryTask.contract", "documents.expiryTask.estimate", "documents.expiryTask.invoice",
    "documents.expiryTask.photo", "documents.expiryTask.permit", "documents.expiryTask.insurance", "documents.expiryTask.warranty",
    "documents.expiryTask.other",
    "documents.required.summary", "documents.required.summaryOff", "documents.required.loadFailed",
    "documents.required.restored", "documents.required.changed", "documents.required.failed", "documents.required.role",
    "documents.required.crashed",
  ] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    const missing = KEYS_3A.filter((k) => !(`${k}.es` in m) || !(k in m));
    expect(missing).toEqual([]);
  });

  it("the To-do titles read as the spec's example in both languages (mutation: drop {date} or {name} from either -> FAILS)", () => {
    expect(t(m, "documents.expiryTask.insurance", "en", { name: "Ana García", date: "Nov 16" })).toBe("Ana García's insurance expires on Nov 16");
    expect(t(m, "documents.expiryTask.insurance", "es", { name: "Ana García", date: "16 nov" })).toBe("El seguro de Ana García vence el 16 nov");
    expect(t(m, "documents.expiryTask.other", "en", { name: "Bo", date: "Nov 16", title: "Pool permit" })).toBe("Bo's \"Pool permit\" expires on Nov 16");
    expect(t(m, "documents.expiryTask.other", "es", { name: "Bo", date: "16 nov", title: "Pool permit" })).toBe("\"Pool permit\" de Bo vence el 16 nov");
  });

  it("the empty states are the spec's sentences (spec 3.1)", () => {
    expect(`${m["documents.page.empty.all"]} ${m["documents.page.empty.allBody"]}`)
      .toBe("Files you upload to a customer or household show up here. Open a customer and use Documents to add one.");
    expect(`${m["documents.page.empty.expiring"]} ${m["documents.page.empty.expiringBody"]}`)
      .toBe("Nothing expires in the next 30 days. Files with an expiry date show up here a month before.");
    expect(m["documents.page.empty.expired"]).toBe("Nothing has expired.");
  });

  it("Spanish is usted, never tu (mutation: 'Revisa' or 'intenta' in any .es -> FAILS)", () => {
    const es = KEYS_3A.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(revisa|intenta|vuelve|abre|usa|tu|tus)\b/i);
  });
});

describe("S-07 3b: share links (plan Task 2)", () => {
  const KEYS_3B = [
    "documents.share", "documents.share.copied", "documents.share.live", "documents.share.stop", "documents.share.stopped",
    "documents.share.failed", "documents.share.ownersOnlyRole", "documents.share.notShared", "documents.share.ended", "documents.share.refused",
    "timeline.documentShared", "timeline.documentShareOpened", "provenance.linkRecipient",
    "sharePage.pageTitle", "sharePage.pageTitleNoName", "sharePage.heading", "sharePage.headingNoName", "sharePage.details",
    "sharePage.download", "sharePage.limit", "sharePage.failed", "sharePage.revoked", "sharePage.trashed",
    "sharePage.removed", "sharePage.ask", "sharePage.askNoName",
  ] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    expect(KEYS_3B.filter((k) => !(k in m) || !(`${k}.es` in m))).toEqual([]);
  });

  it("the spec's sentences, in both languages (spec 4.1, 4.3; mutation: change either side of any pair -> FAILS)", () => {
    expect([m["documents.share.copied"], m["documents.share.copied.es"]]).toEqual(["Link copied. It works for 24 hours.", "Enlace copiado. Funciona por 24 horas."]);
    expect([t(m, "documents.share.live", "en", { hours: 18 }), t(m, "documents.share.live", "es", { hours: 18 })])
      .toEqual(["Shared · expires in 18 h", "Compartido · vence en 18 h"]);
    expect([m["provenance.linkRecipient"], m["provenance.linkRecipient.es"]]).toEqual(["The link's recipient", "Quien recibió el enlace"]);
    expect([t(m, "timeline.documentShareOpened", "en", { title: "Seguro 2026.pdf" }), t(m, "timeline.documentShareOpened", "es", { title: "Seguro 2026.pdf" })])
      .toEqual(["opened Seguro 2026.pdf", "abrió Seguro 2026.pdf"]);
    expect([t(m, "sharePage.heading", "en", { business: "Casa Verde" }), t(m, "sharePage.heading", "es", { business: "Casa Verde" })])
      .toEqual(["Casa Verde shared a file with you", "Casa Verde compartió un archivo con usted"]);
  });

  it("no copy says token, hash, link id or storage (mutation: 'token' in any value -> FAILS)", () => {
    const all = KEYS_3B.flatMap((k) => [m[k], m[`${k}.es` as keyof typeof m] as string]);
    for (const s of all) expect(s).not.toMatch(/\b(token|hash|storage|signed|supabase)\b/i);
  });

  it("Spanish is usted, never tu (mutation: 'Intenta' or 'tu' in any .es -> FAILS)", () => {
    const es = KEYS_3B.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(intenta|pide|abre|usa|tu|tus|contigo)\b/i);
  });
});

describe("S-10 T8: the owner's own mail (weekly report, lead alert, call alert) in the account's language (spec §3.3)", () => {
  const KEYS_T8 = [
    "email.weeklyReport.delta.same", "email.weeklyReport.delta.more", "email.weeklyReport.delta.moreOne",
    "email.weeklyReport.delta.fewer", "email.weeklyReport.delta.fewerOne",
    "email.weeklyReport.label.calls", "email.weeklyReport.label.callsOne",
    "email.weeklyReport.label.leads", "email.weeklyReport.label.leadsOne",
    "email.weeklyReport.label.bookings", "email.weeklyReport.label.bookingsOne",
    "email.weeklyReport.label.visitors", "email.weeklyReport.label.visitorsOne",
    "email.weeklyReport.visitors", "email.weeklyReport.visitorsOne",
    "email.weeklyReport.reassurance.receptionist", "email.weeklyReport.reassurance.textBack",
    "email.weeklyReport.reassurance.join", "email.weeklyReport.quiet.heading", "email.weeklyReport.quiet.body",
    "email.weeklyReport.heading", "email.weeklyReport.cta",
    "email.weeklyReport.subject.visitors", "email.weeklyReport.subject.visitorsOne", "email.weeklyReport.subject.pipeline",
    "email.weeklyReport.subject.pipeline.calls", "email.weeklyReport.subject.pipeline.callsOne",
    "email.weeklyReport.subject.pipeline.leads", "email.weeklyReport.subject.pipeline.leadsOne",
    "email.leadAlert.subject", "email.leadAlert.heading", "email.leadAlert.fromFormHtml", "email.leadAlert.fromFormText",
    "email.callAlert.heading", "email.callAlert.outcome.booked", "email.callAlert.outcome.lead", "email.callAlert.outcome.message",
    "email.alert.openContact",
  ] as const;

  it("every key has a Spanish twin that differs from the English (mutation: drop one .es line -> FAILS naming it)", () => {
    const missing = KEYS_T8.filter((k) => !(k in m) || !(`${k}.es` in m));
    expect(missing).toEqual([]);
    for (const k of KEYS_T8) {
      expect(m[`${k}.es` as keyof typeof m], k).not.toBe(m[k]);
    }
  });

  it("every English key has its .es twin on the very next line (mutation: move a twin -> FAILS)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of KEYS_T8) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, never tú (mutation: put a tú form in any .es -> FAILS)", () => {
    const TU = /\b(tu|tus|ti|contigo|puedes|tienes|verás|elijas|recárgala|inténtalo|agregaste|cámbiala)\b/i;
    for (const k of KEYS_T8) {
      const es = m[`${k}.es` as keyof typeof m] as string;
      expect(TU.test(es), `${k}.es: ${es}`).toBe(false);
    }
  });

  it("deltaPhrase's Spanish agrees across One/Other, both directions (mutation: swap más/menos -> FAILS)", () => {
    expect(t(m, "email.weeklyReport.delta.moreOne", "es", { size: 1 })).toBe("1 más que la semana anterior");
    expect(t(m, "email.weeklyReport.delta.more", "es", { size: 3 })).toBe("3 más que la semana anterior");
    expect(t(m, "email.weeklyReport.delta.fewerOne", "es", { size: 1 })).toBe("1 menos que la semana anterior");
    expect(t(m, "email.weeklyReport.delta.fewer", "es", { size: 2 })).toBe("2 menos que la semana anterior");
    expect(m["email.weeklyReport.delta.same.es"]).toBe("igual que la semana anterior");
  });

  it("the outcome words glossary-match the Calls page's own concepts (mutation: 'Reserva' for booked, or 'Prospecto' for lead -> would FAIL the live G6 gate)", () => {
    expect(m["email.callAlert.outcome.booked.es"]).toBe("cita");
    expect(m["email.callAlert.outcome.lead.es"]).toBe("cliente potencial");
    expect(m["email.callAlert.outcome.message.es"]).toBe("mensaje");
  });

  it("every placeholder set survives translation (mutation: drop {formName} from leadAlert.subject.es -> FAILS)", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    for (const k of KEYS_T8) {
      const en = m[k];
      const es = m[`${k}.es` as keyof typeof m] as string;
      expect(ph(es), `${k}.es`).toEqual(ph(en));
    }
  });
});

describe("S-10: the owner's booking mail (new booking, cancel, move, phone change) in the account's language (spec §3.3)", () => {
  const KEYS_BOOKING_ALERTS = [
    "email.bookingAlert.subject", "email.bookingAlert.heading", "email.bookingAlert.sentence", "email.bookingAlert.text",
    "email.bookingAlert.label.when", "email.bookingAlert.label.who", "email.bookingAlert.label.note",
    "email.bookingAlert.label.was", "email.bookingAlert.label.now", "email.bookingAlert.label.calledFrom",
    "email.bookingAlert.someone",
    "email.cancelNotice.subject", "email.cancelNotice.sentence",
    "email.phoneChangeAlert.subject.cancelled", "email.phoneChangeAlert.subject.moved",
    "email.phoneChangeAlert.heading.cancelled", "email.phoneChangeAlert.heading.moved",
    "email.phoneChangeAlert.sentence.cancelled", "email.phoneChangeAlert.sentence.moved",
    "email.phoneChangeAlert.numberHidden",
    "email.movedAlert.subject", "email.movedAlert.heading", "email.movedAlert.sentence",
  ] as const;

  it("every key has a Spanish twin that differs from the English (mutation: drop one .es line -> FAILS naming it)", () => {
    const missing = KEYS_BOOKING_ALERTS.filter((k) => !(k in m) || !(`${k}.es` in m));
    expect(missing).toEqual([]);
    for (const k of KEYS_BOOKING_ALERTS) {
      expect(m[`${k}.es` as keyof typeof m], k).not.toBe(m[k as keyof typeof m]);
    }
  });

  it("every English key has its .es twin on the very next line (mutation: move a twin -> FAILS)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of KEYS_BOOKING_ALERTS) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, never tú, and says cita, never reserva (mutation: 'Nueva reserva' or 'agendó una cita contigo' -> FAILS)", () => {
    const TU = /\b(tu|tus|ti|te|contigo|puedes|tienes|agendaste|cancelaste|cambiaste)\b/i;
    for (const k of KEYS_BOOKING_ALERTS) {
      const es = m[`${k}.es` as keyof typeof m] as string;
      expect(TU.test(es), `${k}.es: ${es}`).toBe(false);
      expect(/reserva/i.test(es), `${k}.es: ${es}`).toBe(false);
    }
    expect(m["email.bookingAlert.sentence.es"]).toBe("{name} agendó una cita con usted.");
  });

  it("the English is today's exact wording, so the English emails stay byte-identical (mutation: reword any English key -> FAILS)", () => {
    expect(KEYS_BOOKING_ALERTS.map((k) => m[k as keyof typeof m])).toEqual([
      "New booking: {when} — {name}", "New booking", "{name} booked a time with you.", "New booking from {name}.",
      "When", "Who", "Note", "Was", "Now", "Called from", "Someone",
      "Booking cancelled: {when} — {name}", "{name} cancelled their booking.",
      "Booking cancelled by phone: {when} — {name}", "Booking moved by phone: {was} to {now} — {name}",
      "Booking cancelled by phone", "Booking moved by phone",
      "{name} cancelled their booking by phone.", "{name} moved their booking by phone.",
      "Number not shown",
      "Booking moved: {was} to {now} — {name}", "Booking moved", "{name} moved their booking.",
    ]);
  });

  it("every placeholder set survives translation (mutation: drop {name} from cancelNotice.sentence.es -> FAILS)", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    for (const k of KEYS_BOOKING_ALERTS) {
      const en = m[k as keyof typeof m] as string;
      const es = m[`${k}.es` as keyof typeof m] as string;
      expect(ph(es), `${k}.es`).toEqual(ph(en));
    }
  });
});

describe("item 8a-1: the AI card's copy (spec 3.6)", () => {
  const KEYS_8A1 = [
    "aiSettings.title", "aiSettings.description", "aiSettings.account.label", "aiSettings.account.help", "aiSettings.budget.label",
    "aiSettings.budget.help", "aiSettings.spend", "aiSettings.empty", "aiSettings.reached", "aiSettings.reachedNoDate",
    "aiSettings.skipped", "aiSettings.skippedOne", "aiSettings.save", "aiSettings.saved", "aiSettings.undone",
    "aiSettings.error.budget", "aiSettings.error.failed", "aiSettings.crashed", "aiSettings.loadError",
    "aiSettings.global.label", "aiSettings.global.onHelp", "aiSettings.global.offHelp", "aiSettings.global.turnOff",
    "aiSettings.global.turnOn", "aiSettings.global.confirmTitle", "aiSettings.global.confirmBody", "aiSettings.global.confirmWord",
    "aiSettings.global.confirmLabel", "aiSettings.global.cancel", "aiSettings.global.turnedOff", "aiSettings.global.turnedOn",
    "aiSettings.global.wrongWord", "palette.settings.ai", "aiSettings.zeroBudget",
  ] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    expect(KEYS_8A1.filter((k) => !(k in m) || !(`${k}.es` in m))).toEqual([]);
  });

  it("the spec's sentences, in both languages (spec 3.6; mutation: change either side of any pair -> FAILS)", () => {
    expect([t(m, "aiSettings.spend", "en", { spent: "$1.84", budget: "$10.00" }), t(m, "aiSettings.spend", "es", { spent: "$1.84", budget: "$10.00" })])
      .toEqual(["$1.84 of $10.00 this month, estimated", "$1.84 de $10.00 este mes, estimado"]);
    expect([t(m, "aiSettings.reached", "en", { date: "Oct 14", resume: "Nov 1" }), t(m, "aiSettings.reached", "es", { date: "14 oct", resume: "1 nov" })])
      .toEqual(["Budget reached on Oct 14. Summaries, cards and suggestions are paused for this account until Nov 1.", "Presupuesto alcanzado el 14 oct. Los resúmenes, las tarjetas y las sugerencias están en pausa en esta cuenta hasta el 1 nov."]);
    // Task 7 fix round 3: a $0 budget is off until raised, never "resumes on the 1st" (the gate refuses spend >= budget).
    expect([m["aiSettings.zeroBudget"], m["aiSettings.zeroBudget.es"]])
      .toEqual(["Budget is $0. Summaries, cards and suggestions are off for this account until the budget is raised.", "El presupuesto es $0. Los resúmenes, las tarjetas y las sugerencias están apagados en esta cuenta hasta que se suba el presupuesto."]);
    expect([m["aiSettings.empty"], m["aiSettings.empty.es"]]).toEqual(["No AI use yet this month.", "Todavía no hay uso de IA este mes."]);
    expect([m["aiSettings.global.label"], m["aiSettings.global.label.es"]]).toEqual(["AI for every account", "IA para todas las cuentas"]);
    expect([m["aiSettings.account.label"], m["aiSettings.account.label.es"]]).toEqual(["AI for this account", "IA para esta cuenta"]);
    expect([m["aiSettings.global.confirmWord"], m["aiSettings.global.confirmWord.es"]]).toEqual(["OFF", "APAGAR"]);
    expect([plural(m, "aiSettings.skipped", 1, "en"), plural(m, "aiSettings.skipped", 3, "es", { count: 3 })])
      .toEqual(["Summaries, cards and suggestions were skipped once this month because this account's AI was off or over budget.", "Los resúmenes, las tarjetas y las sugerencias se omitieron 3 veces este mes porque la IA de esta cuenta estaba apagada o sin presupuesto."]);
  });

  it("no copy names the vendor or the plumbing (mutation: 'OpenAI' or 'tokens' in any value -> FAILS)", () => {
    const all = KEYS_8A1.flatMap((k) => [m[k], m[`${k}.es` as keyof typeof m] as string]);
    for (const s of all) expect(s).not.toMatch(/\b(openai|gpt|token|tokens|ledger|gateway|rpc|model|microd[oó]lar)/i);
  });

  it("Spanish is usted, never tu (mutation: 'Escribe' or 'tu' in any .es -> FAILS)", () => {
    const es = KEYS_8A1.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(escribe|intenta|recarga|tu|tus|contigo)\b/i);
  });
});

describe("item 8a-2: the record summary's copy (spec 4.6, 4.8, 3.6)", () => {
  const KEYS_8A2 = ["record.ai.label", "record.ai.regenerate", "record.ai.capped", "record.ai.failed", "record.ai.writing", "aiSettings.summariesToday", "aiSettings.account.help"] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    expect(KEYS_8A2.filter((k) => !(k in m) || !(`${k}.es` in m))).toEqual([]);
  });

  it("the spec's sentences, in both languages (mutation: change either side of any pair -> FAILS)", () => {
    expect([t(m, "record.ai.label", "en", { time: "9:42 AM" }), t(m, "record.ai.label", "es", { time: "9:42 a.m." })])
      .toEqual(["Generated by AI · 9:42 AM", "Generado por IA · 9:42 a.m."]);
    expect([m["record.ai.capped"], m["record.ai.capped.es"]]).toEqual(["AI summaries are paused until tomorrow.", "Los resúmenes con IA vuelven mañana."]);
    expect([m["record.ai.failed"], m["record.ai.failed.es"]]).toEqual(["Couldn't write the summary just now.", "No se pudo escribir el resumen ahora."]);
    expect([m["record.ai.regenerate"], m["record.ai.regenerate.es"]]).toEqual(["Regenerate", "Volver a generar"]);
    expect([m["record.ai.writing"], m["record.ai.writing.es"]]).toEqual(["Writing the summary…", "Escribiendo el resumen…"]);
    expect([t(m, "aiSettings.summariesToday", "en", { count: 12, cap: 200 }), t(m, "aiSettings.summariesToday", "es", { count: 12, cap: 200 })])
      .toEqual(["12 of 200 customer summaries written today", "12 de 200 resúmenes de clientes escritos hoy"]);
    expect([m["aiSettings.account.help"], m["aiSettings.account.help.es"]]).toEqual([
      "Off: no written call summary, no \"why they called\" card, and no suggestions — just what Sofía recorded live. Customer pages show no written summary either. Sofía still answers calls and the website chat still runs; those have their own switches, on the Voice page.",
      "Apagada: sin resumen de llamada, sin tarjeta de \"por qué llamó\" y sin sugerencias — solo lo que Sofía registró en vivo. Las páginas de clientes tampoco muestran un resumen escrito. Sofía sigue atendiendo llamadas y el chat del sitio sigue funcionando; esos tienen sus propios interruptores, en la página de Voz.",
    ]);
  });

  it("no copy names the vendor or the plumbing (mutation: 'model' or 'cache' in any value -> FAILS)", () => {
    const all = KEYS_8A2.flatMap((k) => [m[k], m[`${k}.es` as keyof typeof m] as string]);
    for (const s of all) expect(s).not.toMatch(/\b(openai|gpt|token|tokens|ledger|gateway|rpc|model|cache|digest)/i);
  });

  it("Spanish is usted, never tu (mutation: 'Intenta' or 'tu' in any .es -> FAILS)", () => {
    const es = KEYS_8A2.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(escribe|intenta|recarga|tu|tus|contigo)\b/i);
  });
});

describe("suggestions.* keys (item 8b-1)", () => {
  const KEYS = [
    "suggestions.heading", "suggestions.subhead", "suggestions.cap", "suggestions.loadFailed",
    "suggestions.loading", "suggestions.source.call", "suggestions.source.callNoName", "suggestions.evidence",
    "suggestions.status.pending", "suggestions.status.accepted", "suggestions.status.edited",
    "suggestions.status.dismissed", "suggestions.status.expired",
    "suggestions.decided.accepted", "suggestions.decided.edited", "suggestions.decided.dismissed", "suggestions.decided.expired",
    "suggestions.decided.acceptedByYou", "suggestions.decided.editedByYou", "suggestions.decided.dismissedByYou",
    "suggestions.accept", "suggestions.editAccept", "suggestions.discard", "suggestions.saveAccept", "suggestions.cancel",
    "suggestions.task", "suggestions.due", "suggestions.wasDue", "suggestions.field",
    "suggestions.field.firstName", "suggestions.field.lastName", "suggestions.field.email", "suggestions.field.phone",
    "suggestions.stage", "suggestions.stage.skipped", "suggestions.stage.skippedOne", "suggestions.stage.unresolved",
    "suggestions.toast.task", "suggestions.toast.field", "suggestions.toast.stage", "suggestions.toast.dismissed",
    "suggestions.undone", "suggestions.undoneDuplicate",
    "suggestions.answer.unavailable", "suggestions.answer.answeredBy", "suggestions.answer.answeredBySomeone",
    "suggestions.answer.pastDue", "suggestions.answer.maybeFailed", "suggestions.answer.failed",
    "suggestions.answer.tooLate", "suggestions.answer.changed", "suggestions.answer.undoStranded",
    "suggestions.out.field_filled", "suggestions.out.name_mismatch", "suggestions.out.deal_moved",
    "suggestions.out.deal_closed", "suggestions.out.deal_gone", "suggestions.out.aged", "suggestions.out.superseded",
    "suggestions.reason.field_filled", "suggestions.reason.name_mismatch", "suggestions.reason.deal_moved",
    "suggestions.reason.deal_closed", "suggestions.reason.deal_gone", "suggestions.reason.aged", "suggestions.reason.superseded",
    "suggestions.edit.title", "suggestions.edit.due", "suggestions.edit.stage",
    "suggestions.edit.titleRequired", "suggestions.edit.titleTooLong", "suggestions.edit.dueInvalid",
    "suggestions.edit.valueRequired", "suggestions.edit.phoneInvalid", "suggestions.edit.emailInvalid",
    "suggestions.edit.stageInvalid",
  ] as const;
  it("every key has a Spanish twin that differs from the English (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const missing = KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`]);
    expect(missing).toEqual([]);
  });
  it("pins the spec's own sentences, both languages (mutation: change one word -> FAILS)", () => {
    expect([m["suggestions.heading"], m["suggestions.heading.es"]]).toEqual(["Suggestions", "Sugerencias"]);
    expect([m["suggestions.subhead"], m["suggestions.subhead.es"]]).toEqual([
      "From {persona}. Nothing changes until you accept.", "De {persona}. Nada cambia hasta que usted acepte."]);
    expect([m["suggestions.answer.answeredBy"], m["suggestions.answer.answeredBy.es"]]).toEqual([
      "{name} already answered this one.", "{name} ya respondió esta."]);
    expect([m["suggestions.answer.pastDue"], m["suggestions.answer.pastDue.es"]]).toEqual([
      "Its due date has passed. Use Edit and accept to pick a new one.",
      "Su fecha ya pasó. Use Editar y aceptar para elegir otra."]);
    expect([m["suggestions.out.aged"], m["suggestions.out.aged.es"]]).toEqual([
      "Out of date: this suggestion is more than 30 days old.", "Ya no aplica: esta sugerencia tiene más de 30 días."]);
    expect([m["suggestions.answer.undoStranded"], m["suggestions.answer.undoStranded.es"]]).toEqual([
      "The change was undone, but this suggestion didn't update. Refresh before doing anything else.",
      "El cambio se deshizo, pero esta sugerencia no se actualizó. Actualice la página antes de hacer otra cosa."]);
  });
  it("a decision the reader made reads you, lower case mid-sentence, in both languages (Task 7 review I3)", () => {
    expect([m["suggestions.decided.acceptedByYou"], m["suggestions.decided.acceptedByYou.es"],
      m["suggestions.decided.editedByYou"], m["suggestions.decided.editedByYou.es"],
      m["suggestions.decided.dismissedByYou"], m["suggestions.decided.dismissedByYou.es"]]).toEqual([
      "Accepted by you · {time}", "Aceptada por usted · {time}", "Edited by you · {time}", "Editada por usted · {time}",
      "Discarded by you · {time}", "Descartada por usted · {time}"]);
  });
  it("no plumbing words reach the reader (mutation: write 'proposal' into one key -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const bad = KEYS.flatMap((k) => [cat[k], cat[`${k}.es`]]).filter((s) => /proposal|payload|model|registry|token/i.test(s ?? ""));
    expect(bad).toEqual([]);
  });
});

describe("the tray everywhere, item 8b-2's new keys (plan Task 3)", () => {
  const KEYS = [
    "suggestions.group.call",
    "suggestions.group.noCustomer",
    "suggestions.capAccount",
    "suggestions.waiting.heading",
    "suggestions.waiting.seeAll",
    "suggestions.transcript",
    "suggestions.transcript.noTime",
    "suggestions.answer.unreachable",
    "suggestions.reload",
    "timeline.suggestion",
    "timeline.suggestionEdited",
    "timeline.suggestion.original",
    "timeline.what.suggestions",
  ] as const;

  it("every key has an English string and a Spanish twin that differs from it (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const missing = KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`]);
    expect(missing).toEqual([]);
  });

  it("pins the plan's own sentences, both languages (mutation: change one word -> FAILS)", () => {
    expect([m["suggestions.group.call"], m["suggestions.group.call.es"]]).toEqual([
      "{name} · from the call on {date}", "{name} · de la llamada del {date}"]);
    expect([m["suggestions.group.noCustomer"], m["suggestions.group.noCustomer.es"]]).toEqual([
      "No customer yet", "Sin cliente todavía"]);
    expect([m["suggestions.capAccount"], m["suggestions.capAccount.es"]]).toEqual([
      "Showing the newest {n} for this account.", "Se muestran las {n} más recientes de esta cuenta."]);
    expect([m["suggestions.waiting.heading"], m["suggestions.waiting.heading.es"]]).toEqual([
      "Waiting for you", "Esperan su respuesta"]);
    expect([m["suggestions.waiting.seeAll"], m["suggestions.waiting.seeAll.es"]]).toEqual([
      "Edit or see all in To do", "Editar o ver todas en Pendientes"]);
    expect([m["suggestions.transcript"], m["suggestions.transcript.es"]]).toEqual([
      "See it in the transcript · {time}", "Ver en la transcripción · {time}"]);
    expect([m["suggestions.transcript.noTime"], m["suggestions.transcript.noTime.es"]]).toEqual([
      "See it in the transcript", "Ver en la transcripción"]);
    expect([m["suggestions.answer.unreachable"], m["suggestions.answer.unreachable.es"]]).toEqual([
      "That didn't reach us. Reload the page, then check before trying again.",
      "No nos llegó. Recargue la página y revise antes de intentarlo otra vez."]);
    expect([m["suggestions.reload"], m["suggestions.reload.es"]]).toEqual(["Reload", "Recargar"]);
    expect([m["timeline.suggestion"], m["timeline.suggestion.es"]]).toEqual([
      "accepted {persona}'s suggestion: {change}", "aceptó la sugerencia de {persona}: {change}"]);
    expect([m["timeline.suggestionEdited"], m["timeline.suggestionEdited.es"]]).toEqual([
      "accepted {persona}'s suggestion with changes: {change}",
      "aceptó la sugerencia de {persona} con cambios: {change}"]);
    expect([m["timeline.suggestion.original"], m["timeline.suggestion.original.es"]]).toEqual([
      "Suggested: {change}", "Se sugirió: {change}"]);
    expect([m["timeline.what.suggestions"], m["timeline.what.suggestions.es"]]).toEqual([
      "accepted suggestions", "sugerencias aceptadas"]);
  });

  it("the named params interpolate through t() for both languages", () => {
    expect(t(m, "suggestions.group.call", "en", { name: "Maria Garcia", date: "Oct 12" }))
      .toBe("Maria Garcia · from the call on Oct 12");
    expect(t(m, "suggestions.group.call", "es", { name: "Maria Garcia", date: "12 oct" }))
      .toBe("Maria Garcia · de la llamada del 12 oct");
    expect(t(m, "suggestions.capAccount", "en", { n: 50 })).toBe("Showing the newest 50 for this account.");
    expect(t(m, "suggestions.capAccount", "es", { n: 50 })).toBe("Se muestran las 50 más recientes de esta cuenta.");
    expect(t(m, "suggestions.transcript", "en", { time: "2:14" })).toBe("See it in the transcript · 2:14");
    expect(t(m, "suggestions.transcript", "es", { time: "2:14" })).toBe("Ver en la transcripción · 2:14");
    expect(t(m, "timeline.suggestion", "en", { persona: "Sofía", change: "Stage: Lead → Deal build" }))
      .toBe("accepted Sofía's suggestion: Stage: Lead → Deal build");
    expect(t(m, "timeline.suggestionEdited", "es", { persona: "Sofía", change: "Etapa: Prospecto → Construcción" }))
      .toBe("aceptó la sugerencia de Sofía con cambios: Etapa: Prospecto → Construcción");
    expect(t(m, "timeline.suggestion.original", "en", { change: "Due Oct 20" })).toBe("Suggested: Due Oct 20");
  });

  it("no plumbing words reach the reader, and no internal milestone code (mutation: write 'proposal' into one key -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const bad = KEYS.flatMap((k) => [cat[k], cat[`${k}.es`]])
      .filter((s) => /proposal|payload|model|registry|token|call_proposals/i.test(s ?? ""));
    expect(bad).toEqual([]);
  });
});

describe("Sofía's acts on the timeline, their Undo, reasons, notice and created-by (item 8c, plan Task 2)", () => {
  // The expected `{param}` set per key — the mutation this guards against is
  // a key whose English and Spanish strings name different params (a
  // translator drops or renames one), which `t()` would silently leave
  // un-interpolated in only one language.
  const EXPECTED_PARAMS: Record<string, readonly string[]> = {
    "timeline.what.aiActs": [],
    "aiActs.verb.booked": ["when"],
    "aiActs.verb.rescheduled": ["when"],
    "aiActs.detail.movedFrom": ["when"],
    "aiActs.verb.cancelled": ["when"],
    "aiActs.verb.contactCreated": [],
    "aiActs.verb.fieldFilled": ["field", "value"],
    "aiActs.field.firstName": [],
    "aiActs.field.lastName": [],
    "aiActs.field.email": [],
    "aiActs.field.phone": [],
    "aiActs.source.call": ["date"],
    "aiActs.source.webchat": [],
    "aiActs.reason.alreadyCancelled": [],
    "aiActs.reason.alreadyHappened": [],
    "aiActs.reason.rebooked": [],
    "aiActs.reason.timePassed": [],
    "aiActs.reason.timeTaken": [],
    "aiActs.reason.oldTimeTaken": [],
    "aiActs.reason.changed": [],
    "aiActs.reason.changedBy": ["name"],
    "aiActs.reason.hasActivity": [],
    "aiActs.reason.hasBooking": [],
    "aiActs.reason.otherBooking": [],
    "aiActs.reason.ownerOnly": [],
    "aiActs.reason.gone": [],
    "aiActs.undoneBy": ["name", "date"],
    "aiActs.notify.label": ["name"],
    "aiActs.notify.noEmail": ["name"],
    "aiActs.toast.fieldUndone": ["field"],
    "aiActs.toast.fieldRedone": ["persona", "field"],
    "aiActs.toast.fieldRemoved": ["field", "persona"],
    "aiActs.toast.bookingUndone": [],
    "aiActs.toast.bookingUndoneTold": ["name"],
    "aiActs.toast.bookingUndoneNotTold": ["name"],
    "aiActs.toast.contactRemoved": [],
    "aiActs.toast.contactRemovedChat": [],
    "aiActs.toast.notAvailable": ["reason"],
    "aiActs.toast.failed": [],
    "aiActs.toast.typedNameMismatch": [],
    "aiActs.notice.calendarFix": [],
    "aiActs.contactDialog.title": ["name"],
    "aiActs.contactDialog.body": ["persona"],
    "aiActs.contactDialog.bodyChat": ["persona"],
    "aiActs.contactDialog.label": ["name"],
    "aiActs.contactDialog.mismatch": [],
    "aiActs.contactDialog.confirm": [],
    "record.facts.addedBy.person": ["name"],
    "record.facts.addedBy.you": [],
    "record.facts.addedBy.someone": [],
    "record.facts.addedBy.ai": ["name"],
    "record.facts.addedBy.customer": [],
    "record.facts.addedBy.import": [],
    "record.facts.addedBy.automation": [],
    "styleguide.aiActs": [],
  };
  const KEYS = Object.keys(EXPECTED_PARAMS) as (keyof typeof m)[];

  function paramsOf(s: string): string[] {
    return [...s.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!).sort();
  }

  it("every key exists with its Spanish twin, differing from the English (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const missing = KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`]);
    expect(missing).toEqual([]);
  });

  it("names exactly its params, and the same set in both languages (mutation: rename {name} to {who} in one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      const expected = [...EXPECTED_PARAMS[k]!].sort();
      expect(paramsOf(cat[k]!), `"${k}" (en)`).toEqual(expected);
      expect(paramsOf(cat[`${k}.es`]!), `"${k}" (es)`).toEqual(expected);
    }
  });

  it("pins the plan's own sentences, both languages (mutation: change one word -> FAILS)", () => {
    expect([m["timeline.what.aiActs"], m["timeline.what.aiActs.es"]]).toEqual([
      "the assistant's actions", "las acciones de la asistente"]);
    expect([m["aiActs.verb.fieldFilled"], m["aiActs.verb.fieldFilled.es"]]).toEqual([
      "filled in the {field}: {value}", "completó {field}: {value}"]);
    expect([m["aiActs.undoneBy"], m["aiActs.undoneBy.es"]]).toEqual([
      "Undone by {name} · {date}", "Deshecho por {name} · {date}"]);
    // Design M-8: the Spanish names who would need to know, so "Llámele" is never read as the reader's own call.
    expect([m["aiActs.notify.noEmail"], m["aiActs.notify.noEmail.es"]]).toEqual([
      "{name} has no email on file, so they won't be told. Call them if they need to know.",
      "Este cliente no tiene correo registrado, así que no se le avisará. Llámele si {name} necesita saberlo."]);
    // Design M-2: the typed name moved out of the body into its own visible label.
    expect([m["aiActs.contactDialog.body"], m["aiActs.contactDialog.body.es"]]).toEqual([
      "{persona} added this customer, and nothing else has happened since. Removing them can't be undone; the call stays in Calls.",
      "{persona} agregó a este cliente y no ha pasado nada más desde entonces. Quitarlo no se puede deshacer; la llamada sigue en Llamadas."]);
    expect([m["aiActs.contactDialog.label"], m["aiActs.contactDialog.label.es"]]).toEqual([
      "Type {name} to confirm", "Escriba {name} para confirmar"]);
    // Review M-a: the web chat's own words.
    expect([m["aiActs.contactDialog.bodyChat"], m["aiActs.toast.contactRemovedChat"]]).toEqual([
      "{persona} added this customer from the website chat, and nothing else has happened since. Removing them can't be undone; the chat's form entry stays in Forms.",
      "Customer removed. The chat's form entry stays in Forms."]);
    // Design I-5: what the field toasts say.
    expect([m["aiActs.toast.fieldRemoved"], m["aiActs.toast.fieldUndone"], m["aiActs.toast.fieldRedone"]]).toEqual([
      "Removed the {field} {persona} filled in.", "Put back the earlier {field}.", "{persona}'s {field} is back."]);
    // Design M-7.
    expect([m["aiActs.reason.changedBy"], m["aiActs.reason.changed"], m["aiActs.reason.hasActivity"]]).toEqual([
      "Changed by {name} since", "Changed since then", "They've had other activity since"]);
    // Design I-4: one sentence per author kind.
    expect([m["record.facts.addedBy.ai"], m["record.facts.addedBy.ai.es"], m["record.facts.addedBy.you.es"]]).toEqual([
      "Added by {name} (AI)", "Agregado por {name} (IA)", "Agregado por usted"]);
  });

  it("every reason is a fragment with no closing period; the refusal toast closes the sentence (design M-7; mutation: a period back on one reason -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const reasons = KEYS.filter((k) => k.startsWith("aiActs.reason."));
    expect(reasons.length).toBeGreaterThanOrEqual(13);
    const closed = reasons.flatMap((k) => [cat[k]!, cat[`${k}.es`]!]).filter((x) => /[.!?]$/.test(x));
    expect(closed).toEqual([]);
    expect(m["aiActs.toast.notAvailable"]).toBe("This can't be undone any more: {reason}.");
    expect(m["aiActs.toast.notAvailable.es"]).toBe("Ya no se puede deshacer: {reason}.");
  });

  it("the named params interpolate through t() for both languages", () => {
    expect(t(m, "aiActs.verb.booked", "en", { when: "2:00 PM" })).toBe("booked 2:00 PM");
    expect(t(m, "aiActs.verb.booked", "es", { when: "2:00 PM" })).toBe("reservó 2:00 PM");
    expect(t(m, "aiActs.verb.fieldFilled", "en", { field: "phone number", value: "(956) 555-0101" }))
      .toBe("filled in the phone number: (956) 555-0101");
    expect(t(m, "aiActs.undoneBy", "es", { name: "Ana", date: "Oct 20" })).toBe("Deshecho por Ana · Oct 20");
    expect(t(m, "aiActs.contactDialog.title", "en", { name: "Maria Garcia" })).toBe("Remove Maria Garcia?");
    expect(t(m, "record.facts.addedBy.ai", "en", { name: "Sofía" })).toBe("Added by Sofía (AI)");
    expect(t(m, "aiActs.toast.fieldRemoved", "es", { field: "el correo", persona: "Sofía" })).toBe("Se quitó el correo que completó Sofía.");
  });

  it("reuses common.undo, common.cancel and provenance.ai rather than duplicating them", () => {
    expect(m["common.undo"]).toBe("Undo");
    expect(m["common.cancel"]).toBe("Cancel");
    expect(m["provenance.ai"]).toBe("{name} · AI");
  });

  it("no plumbing words reach the reader, and no internal milestone code (mutation: write 'rpc' into one key -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const bad = KEYS.flatMap((k) => [cat[k], cat[`${k}.es`]])
      .filter((s) => /\b(act|ai act|registry|rpc|payload|server)\b/i.test(s ?? ""));
    expect(bad).toEqual([]);
  });

  // The undo notice is a CUSTOMER email: it follows the booking templates' own register, which is tú (design
  // I-6). Every other key here is app copy, read by staff: usted.
  const CUSTOMER_EMAIL = new Set<string>(["aiActs.notice.calendarFix"]);

  it("Spanish app copy is usted, never tú (mutation: 'tu' or 'Intenta' in any app .es -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const es = KEYS.filter((k) => !CUSTOMER_EMAIL.has(k)).map((k) => cat[`${k}.es`]!);
    for (const s of es) expect(s).not.toMatch(/\b(escribe|intenta|recarga|tu|tus|contigo)\b/i);
  });

  it("the undo notice's Spanish sentence is tú, matching the email it sits in (design I-6; mutation: back to usted -> FAILS)", () => {
    expect(m["aiActs.notice.calendarFix.es"]).toBe("Si agregaste la nueva hora a tu calendario, cámbiala de nuevo a esta, por favor.");
  });
});

describe("S-47a: AI disclosure copy, English and Spanish (plan Task 2)", () => {
  const EXPECTED_PARAMS: Record<string, readonly string[]> = {
    "voice.disclosure.legend": ["persona"],
    "voice.disclosure.off": [],
    "voice.disclosure.offHint": ["persona"],
    "voice.disclosure.trial": [],
    "voice.disclosure.trialHint": [],
    "voice.disclosure.on": [],
    "voice.disclosure.onHint": [],
    "voice.disclosure.nextCall": [],
    "voice.disclosure.results.title": [],
    "voice.disclosure.results.period": [],
    "voice.disclosure.results.said": [],
    "voice.disclosure.results.didnt": [],
    "voice.disclosure.results.counted": [],
    "voice.disclosure.results.booked": [],
    "voice.disclosure.results.hungUp": [],
    "voice.disclosure.results.askedPerson": [],
    "voice.disclosure.results.percent": ["percent"],
    "voice.disclosure.results.noneYet": [],
    "voice.disclosure.results.notEnough": [],
    "voice.disclosure.results.notCounted": ["count"],
    "voice.disclosure.results.notCountedOne": [],
    "voice.disclosure.results.empty": [],
    "voice.disclosure.results.emptyAction": [],
    "voice.disclosure.results.emptyIdle": [],
    "voice.disclosure.results.emptyIdleAction": [],
    "voice.disclosure.results.error": [],
    "concierge.aiLabel": ["persona"],
    "concierge.aiIntro": ["persona"],
  };
  const KEYS = Object.keys(EXPECTED_PARAMS) as (keyof typeof m)[];

  function paramsOf(s: string): string[] {
    return [...s.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!).sort();
  }

  it("every key exists with its Spanish twin, differing from the English (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const missing = KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`]);
    expect(missing).toEqual([]);
  });

  it("names exactly its params, and the same set in both languages (mutation: rename {persona} to {name} in one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      const expected = [...EXPECTED_PARAMS[k]!].sort();
      expect(paramsOf(cat[k]!), `"${k}" (en)`).toEqual(expected);
      expect(paramsOf(cat[`${k}.es`]!), `"${k}" (es)`).toEqual(expected);
    }
  });

  it("pins the plan's own sentences, both languages (mutation: change one word -> FAILS)", () => {
    expect([m["voice.disclosure.legend"], m["voice.disclosure.legend.es"]]).toEqual([
      "Tell callers {persona} is an AI", "Decir a quien llama que {persona} es una IA"]);
    expect([m["voice.disclosure.trialHint"], m["voice.disclosure.trialHint.es"]]).toEqual([
      "Half the calls, picked at random, hear it right after the greeting, so the two halves can be compared below. The website chat always says it.",
      "La mitad de las llamadas, elegidas al azar, lo escuchan justo después del saludo, para comparar las dos mitades abajo. El chat del sitio web siempre lo dice."]);
    expect([m["voice.disclosure.nextCall"], m["voice.disclosure.nextCall.es"]]).toEqual([
      "Changes apply from the next call. Calls already made keep what they heard.",
      "Los cambios aplican desde la siguiente llamada. Las llamadas ya hechas conservan lo que escucharon."]);
    expect([m["voice.disclosure.results.title"], m["voice.disclosure.results.title.es"]]).toEqual([
      "Saying it's an AI: how calls went", "Decir que es una IA: cómo fueron las llamadas"]);
    expect([m["voice.disclosure.results.askedPerson"], m["voice.disclosure.results.askedPerson.es"]]).toEqual([
      "Asked for a person", "Pidieron hablar con una persona"]);
    expect([m["voice.disclosure.results.notCounted"], m["voice.disclosure.results.notCounted.es"]]).toEqual([
      "{count} calls not counted (spam, or outside the trial)", "{count} llamadas no contadas (spam, o fuera de la prueba)"]);
    expect([m["voice.disclosure.results.notCountedOne"], m["voice.disclosure.results.notCountedOne.es"]]).toEqual([
      "1 call not counted (spam, or outside the trial)", "1 llamada no contada (spam, o fuera de la prueba)"]);
    // Fix round: the off hint never genders the persona (a persona may be male).
    expect([m["voice.disclosure.offHint"], m["voice.disclosure.offHint.es"]]).toEqual([
      "{persona} says it's an AI only when someone asks.",
      "{persona} dice que es una IA solo cuando se lo preguntan."]);
    // Fix round: the empty card says what fits the STORED setting — on Trial, that calls are counted as
    // they end; on Off or On, what appears here and the one action that causes it. Usted.
    expect([m["voice.disclosure.results.empty"], m["voice.disclosure.results.empty.es"]]).toEqual([
      "No calls since the trial started.", "No hay llamadas desde que empezó la prueba."]);
    expect([m["voice.disclosure.results.emptyAction"], m["voice.disclosure.results.emptyAction.es"]]).toEqual([
      "Each Trial call is counted here once it ends.", "Cada llamada de Prueba se cuenta aquí cuando termina."]);
    expect([m["voice.disclosure.results.emptyIdle"], m["voice.disclosure.results.emptyIdle.es"]]).toEqual([
      "Once a trial runs, how calls went with and without saying it's an AI shows here.",
      "Cuando haga una prueba, aquí verá cómo fueron las llamadas al decir que es una IA y al no decirlo."]);
    expect([m["voice.disclosure.results.emptyIdleAction"], m["voice.disclosure.results.emptyIdleAction.es"]]).toEqual([
      "Choose Trial above and save.", "Elija Prueba arriba y guarde."]);
    expect([m["concierge.aiLabel"], m["concierge.aiLabel.es"]]).toEqual([
      "{persona} · AI assistant", "{persona} · asistente de IA"]);
    expect([m["concierge.aiIntro"], m["concierge.aiIntro.es"]]).toEqual([
      "I'm {persona}, an AI assistant. This chat is saved so the team can follow up.",
      "Soy {persona}, una asistente de inteligencia artificial. Este chat se guarda para que el equipo te dé seguimiento."]);
  });

  it("the plural pair differs only by number, the contacts.count/contacts.countOne shape (mutation: template the singular with {count} -> FAILS)", () => {
    expect(m["voice.disclosure.results.notCountedOne"]).not.toMatch(/\{count\}/);
    expect(m["voice.disclosure.results.notCountedOne.es"]).not.toMatch(/\{count\}/);
    expect(plural(m, "voice.disclosure.results.notCounted", 1, "en")).toBe("1 call not counted (spam, or outside the trial)");
    expect(plural(m, "voice.disclosure.results.notCounted", 3, "en", { count: 3 })).toBe("3 calls not counted (spam, or outside the trial)");
    expect(plural(m, "voice.disclosure.results.notCounted", 1, "es")).toBe("1 llamada no contada (spam, o fuera de la prueba)");
  });

  it("the named params interpolate through t() for both languages", () => {
    expect(t(m, "voice.disclosure.legend", "en", { persona: "Sofía" })).toBe("Tell callers Sofía is an AI");
    expect(t(m, "voice.disclosure.legend", "es", { persona: "Sofía" })).toBe("Decir a quien llama que Sofía es una IA");
    expect(t(m, "voice.disclosure.results.percent", "en", { percent: 62 })).toBe("62%");
    expect(t(m, "voice.disclosure.results.percent", "es", { percent: 62 })).toBe("62 %");
    expect(t(m, "concierge.aiLabel", "en", { persona: "Sofía" })).toBe("Sofía · AI assistant");
  });

  // Every key here except concierge.aiLabel is operator copy (the Voice page's own settings card and its
  // results card), so Spanish is usted. concierge.aiLabel is the website chat's own register (tú), the one
  // named exception alongside the spoken phone sentence (D3, usted) — global constraints, Copy rules.
  const TU_KEYS = new Set<string>(["concierge.aiLabel", "concierge.aiIntro"]);

  it("Spanish operator copy is usted, never tú (mutation: 'tu' into one operator .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const es = KEYS.filter((k) => !TU_KEYS.has(k)).map((k) => cat[`${k}.es`]!);
    for (const s of es) expect(s).not.toMatch(/\b(escribe|intenta|recarga|tu|tus|contigo)\b/i);
  });

  it("the persona is always {persona}, never a typed 'Sofía', in every key (mutation: hard-code Sofía into one line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const all = KEYS.flatMap((k) => [cat[k]!, cat[`${k}.es`]!]);
    for (const s of all) expect(s).not.toMatch(/Sofía|Sofia/);
  });

  it("no plumbing words reach the reader (mutation: write 'trial arm' into one key -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const all = KEYS.flatMap((k) => [cat[k], cat[`${k}.es`]]);
    const bad = all.filter((s) => /\b(flag|stamp|coin|trial arm|variant|disclosure_setting|null)\b/i.test(s ?? ""));
    expect(bad).toEqual([]);
  });
});

describe("S-47b: trade rules copy, English and Spanish (plan Task 2)", () => {
  const EXPECTED_PARAMS: Record<string, readonly string[]> = {
    "voice.tradeRules.legend": [],
    "voice.tradeRules.none": [],
    "voice.tradeRules.noneHint": ["persona"],
    "voice.tradeRules.insurance_pc": [],
    "voice.tradeRules.insurance_pcHint": ["persona"],
    "voice.tradeRules.events": [],
    "voice.tradeRules.eventsHint": ["persona"],
    "voice.tradeRules.nextCall": [],
    "calls.detail.tradeRules": ["module", "version"],
    "calls.detail.tradeModule.insurance_pc": [],
    "calls.detail.tradeModule.events": [],
  };
  const KEYS = Object.keys(EXPECTED_PARAMS) as (keyof typeof m)[];
  // The SET of names: S-47e's closing sentence on insurance_pcHint names {persona} a second
  // time, and t() replaces every occurrence (same reasoning as the S-47d describe below).
  const paramsOf = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!))].sort();

  it("the key list itself is the ten this plan names, plus the final fix's nextCall (guards the loops below from vacuity)", () => {
    expect(KEYS.length).toBe(11);
  });

  // calls.detail.tradeRules is "{module} · v{version}" in BOTH languages (plan review I4): the words
  // "Trade rules" live in the <dt>, so the value carries none. It is the one key allowed to match its twin.
  const SAME_IN_BOTH = new Set<string>(["calls.detail.tradeRules"]);

  it("every key exists with its Spanish twin, differing from the English except the one named (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    expect(KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || (!SAME_IN_BOTH.has(k) && cat[k] === cat[`${k}.es`]))).toEqual([]);
  });

  it("names exactly its params, the same set in both languages (mutation: {version} -> {v} in one .es -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(paramsOf(cat[k]!), `"${k}" (en)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
      expect(paramsOf(cat[`${k}.es`]!), `"${k}" (es)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
    }
  });

  it("pins every sentence, both languages (mutation: change one word -> FAILS)", () => {
    const pairs: Array<[string, string, string]> = [
      ["voice.tradeRules.legend", "Trade rules", "Reglas del giro"],
      ["voice.tradeRules.none", "None — general rules only", "Ninguna — solo las reglas generales"],
      ["voice.tradeRules.noneHint", "{persona} follows only the rules every account has.", "{persona} sigue solo las reglas que tiene toda cuenta."],
      ["voice.tradeRules.insurance_pc", "Insurance (property & casualty)", "Seguros de daños (auto, casa y negocio)"],
      ["voice.tradeRules.insurance_pcHint",
        "{persona} takes quote requests for a licensed agent to call back, and never gives prices, says anyone is covered or discusses a policy. Before reading, moving or cancelling an appointment, {persona} asks for the full name and the email on file.",
        "{persona} toma solicitudes de cotización para que un agente con licencia devuelva la llamada, y nunca da precios, ni dice que alguien está cubierto, ni habla de una póliza. Antes de consultar, cambiar o cancelar una cita, {persona} pide el nombre completo y el correo electrónico registrado."],
      ["voice.tradeRules.events", "Events and venues", "Eventos y salones"],
      ["voice.tradeRules.eventsHint",
        "{persona} takes event details for the team to confirm, never says a date is free, and gives prices only word for word from Services & prices, or from Facts when there is no list.",
        "{persona} toma los datos del evento para que el equipo los confirme, nunca dice que una fecha está libre y da precios solo palabra por palabra de Servicios y precios, o de los datos del negocio cuando no hay lista."],
      ["voice.tradeRules.nextCall",
        "Changes apply from the next call or chat. Calls and chats already under way keep the rules they started with.",
        "Los cambios aplican desde la siguiente llamada o chat. Las llamadas y los chats ya en curso conservan las reglas con las que empezaron."],
      ["calls.detail.tradeRules", "{module} · v{version}", "{module} · v{version}"],
      ["calls.detail.tradeModule.insurance_pc", "Insurance", "Seguros"],
      ["calls.detail.tradeModule.events", "Events", "Eventos"],
    ];
    const cat = m as Record<string, string>;
    for (const [k, en, es] of pairs) expect([cat[k], cat[`${k}.es`]], k).toEqual([en, es]);
  });

  it("interpolates through t() in both languages", () => {
    expect(t(m, "calls.detail.tradeRules", "en", { module: "Insurance", version: 1 })).toBe("Insurance · v1");
    expect(t(m, "calls.detail.tradeRules", "es", { module: "Seguros", version: 1 })).toBe("Seguros · v1");
  });

  it("Spanish is usted, the persona is never typed, no plumbing word reaches the reader (mutations: 'tu' / 'Sofía' / 'trade_module' into one line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(cat[`${k}.es`]).not.toMatch(/\b(tu|tus|contigo|escribe|intenta)\b/i);
      for (const s of [cat[k]!, cat[`${k}.es`]!]) {
        expect(s).not.toMatch(/Sofía|Sofia/);
        expect(s.replace(/\{\w+\}/g, "")).not.toMatch(/\b(insurance_pc|trade_module|stamp|null|flag|module)\b/i);
      }
    }
  });
});

describe("S-47c: structured facts copy, English and Spanish (plan Task 2)", () => {
  const EXPECTED_PARAMS: Record<string, readonly string[]> = {
    "voice.hours.title": [],
    "voice.hours.body": ["persona"],
    "voice.hours.zone": ["zone"],
    "voice.hours.day.mon": [],
    "voice.hours.day.tue": [],
    "voice.hours.day.wed": [],
    "voice.hours.day.thu": [],
    "voice.hours.day.fri": [],
    "voice.hours.day.sat": [],
    "voice.hours.day.sun": [],
    "voice.hours.open": [],
    "voice.hours.from": ["day"],
    "voice.hours.to": ["day"],
    "voice.hours.toWord": [],
    "voice.hours.openOn": ["day"],
    "voice.hours.addSpanOn": ["day"],
    "voice.hours.copyFromCalendarFailed": [],
    "voice.hours.addSpan": [],
    "voice.hours.removeSpan": ["day"],
    "voice.hours.midnightHint": [],
    "voice.hours.copyFromCalendar": [],
    "voice.hours.copyFromCalendarNone": [],
    "voice.hours.clear": [],
    "voice.hours.save": [],
    "voice.hours.saved": [],
    "voice.hours.cleared": [],
    "voice.hours.empty": ["persona"],
    "voice.hours.setHours": [],
    "voice.hours.error.blank": ["day"],
    "voice.hours.error.endBeforeStart": ["day"],
    "voice.hours.error.overlap": ["day"],
    "voice.hours.error.noDay": [],
    "voice.hours.saveFailed": [],
    "voice.services.title": [],
    "voice.services.titleInsurance": [],
    "voice.services.body": ["persona"],
    "voice.services.insuranceNotice": ["persona"],
    "voice.services.empty": ["persona"],
    "voice.services.add": [],
    "voice.services.max": [],
    "voice.services.moveUp": ["name"],
    "voice.services.moveDown": ["name"],
    "voice.services.editNamed": ["name"],
    "voice.services.removeNamed": ["name"],
    "voice.services.keepNamed": ["name"],
    "voice.services.unnamed": [],
    "voice.services.kindPlaceholder": [],
    "voice.services.renameDropsPrice": [],
    "voice.services.edit": [],
    "voice.services.done": [],
    "voice.services.remove": [],
    "voice.services.removing": [],
    "voice.services.keep": [],
    "voice.services.nameEn": [],
    "voice.services.nameEs": [],
    "voice.services.descriptionEn": [],
    "voice.services.descriptionEs": [],
    "voice.services.kind": [],
    "voice.services.kind.fixed": [],
    "voice.services.kind.from": [],
    "voice.services.kind.range": [],
    "voice.services.kind.per_unit": [],
    "voice.services.kind.free": [],
    "voice.services.kind.after_visit": [],
    "voice.services.amount": [],
    "voice.services.amountMin": [],
    "voice.services.amountMax": [],
    "voice.services.unitEn": [],
    "voice.services.unitEs": [],
    "voice.services.previewEn": ["persona"],
    "voice.services.previewEs": ["persona"],
    "voice.services.save": [],
    "voice.services.saved": [],
    "voice.services.saveFailed": [],
    "voice.services.loadFailed": [],
    "voice.services.error.name": [],
    "voice.services.error.amount": ["name"],
    "voice.services.error.range": ["name"],
    "voice.services.error.units": ["name"],
    "voice.services.error.tooLong": ["name"],
    "voice.services.summary.range": ["max", "min"],
    "voice.services.summary.perUnit": ["amount", "unit"],
    "voice.knowledge.stale": [],
    "voice.knowledge.noProfile": [],
    "voice.knowledge.invalid": [],
    "voice.facts.hoursNotice": ["persona"],
    "voice.facts.hoursHint": ["persona"],
    "voice.facts.amountsNotice": ["amounts", "persona"],
    "voice.facts.amountsNoticeInsurance": ["amounts", "persona"],
    "voice.profile.factsHintInsurance": [],
    "calls.detail.knowledge": [],
    "calls.detail.knowledgeLink": ["persona", "version"],
    "voice.knowledge.title": ["persona"],
    "voice.knowledge.version": ["version"],
    "voice.knowledge.savedBy": ["date", "person"],
    "voice.knowledge.recordedAutomatically": ["date"],
    "voice.knowledge.facts": [],
    "voice.knowledge.servicesText": [],
    "voice.knowledge.hours": [],
    "voice.knowledge.prices": [],
    "voice.knowledge.inEnglish": [],
    "voice.knowledge.inSpanish": [],
    "voice.knowledge.nothing": [],
    "voice.knowledge.noHours": [],
    "voice.knowledge.noPrices": [],
    "voice.knowledge.older": [],
    "voice.knowledge.newer": [],
    "voice.knowledge.back": [],
    "voice.knowledge.notFound": ["version"],
    "voice.knowledge.loadFailed": [],
    "voice.knowledge.nameEs": [],
    "voice.knowledge.aboutEn": [],
    "voice.knowledge.aboutEs": [],
    "voice.knowledge.notFoundGeneric": [],
    "voice.knowledge.loading": [],
  };
  const KEYS = Object.keys(EXPECTED_PARAMS) as (keyof typeof m)[];
  // The SET of names: a sentence may name one twice (the amounts Notice names {persona} in two sentences),
  // and t() replaces every occurrence.
  const paramsOf = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!))].sort();

  it("the key list itself is the 115 rows: Task 2's 97 and the fix round's 18 (guards the loops below from vacuity)", () => {
    expect(KEYS.length).toBe(115);
  });

  it("every key exists with its Spanish twin, and none matches its twin (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    expect(KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`])).toEqual([]);
  });

  it("names exactly its params, the same set in both languages (mutation: {zone} -> {z} in one .es -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(paramsOf(cat[k]!), `"${k}" (en)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
      expect(paramsOf(cat[`${k}.es`]!), `"${k}" (es)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
    }
  });

  it("pins every sentence, both languages (mutation: change one word -> FAILS)", () => {
    const pairs: Array<[string, string, string]> = [
      ["voice.hours.title", "Business hours", "Horario del negocio"],
      ["voice.hours.body", "{persona} tells callers whether you're open right now from these hours. Bookable times still come from the calendar.", "{persona} les dice a quienes llaman si está abierto en este momento según este horario. Los horarios para citas siguen saliendo del calendario."],
      ["voice.hours.zone", "Times are in {zone}.", "Las horas están en {zone}."],
      ["voice.hours.day.mon", "Monday", "Lunes"],
      ["voice.hours.day.tue", "Tuesday", "Martes"],
      ["voice.hours.day.wed", "Wednesday", "Miércoles"],
      ["voice.hours.day.thu", "Thursday", "Jueves"],
      ["voice.hours.day.fri", "Friday", "Viernes"],
      ["voice.hours.day.sat", "Saturday", "Sábado"],
      ["voice.hours.day.sun", "Sunday", "Domingo"],
      ["voice.hours.open", "Open", "Abierto"],
      ["voice.hours.from", "Opens on {day}", "{day}: abre"],
      ["voice.hours.to", "Closes on {day}", "{day}: cierra"],
      ["voice.hours.toWord", "to", "a"],
      ["voice.hours.openOn", "Open on {day}", "{day}: abierto"],
      ["voice.hours.addSpan", "Add another time", "Agregar otro horario"],
      ["voice.hours.addSpanOn", "Add another time on {day}", "{day}: agregar otro horario"],
      ["voice.hours.removeSpan", "Remove these hours on {day}", "{day}: quitar estas horas"],
      ["voice.hours.midnightHint", "To close at midnight, set the closing time to 12:00 AM (00:00).", "Para cerrar a medianoche, ponga la hora de cierre en 12:00 a. m. (00:00)."],
      ["voice.hours.copyFromCalendarFailed", "Couldn't read the calendar's hours. Reload the page to try again.", "No se pudieron leer las horas del calendario. Recargue la página para intentar de nuevo."],
      ["voice.hours.copyFromCalendar", "Copy from calendar", "Copiar del calendario"],
      ["voice.hours.copyFromCalendarNone", "The calendar has no hours to copy yet.", "El calendario todavía no tiene horas para copiar."],
      ["voice.hours.clear", "Clear hours", "Quitar el horario"],
      ["voice.hours.save", "Save hours", "Guardar horario"],
      ["voice.hours.saved", "Business hours saved", "Horario guardado"],
      ["voice.hours.cleared", "Business hours cleared", "Horario quitado"],
      ["voice.hours.empty", "Add your hours so {persona} can tell callers whether you're open right now.", "Agregue su horario para que {persona} pueda decirles a quienes llaman si está abierto en este momento."],
      ["voice.hours.setHours", "Set hours", "Poner horario"],
      ["voice.hours.error.blank", "{day}: fill in both times, or remove those hours.", "{day}: llene las dos horas, o quite esas horas."],
      ["voice.hours.error.endBeforeStart", "{day}: each closing time must be after its opening time.", "{day}: cada hora de cierre debe ser después de la de apertura."],
      ["voice.hours.error.overlap", "{day}: these hours overlap.", "{day}: estas horas se cruzan."],
      ["voice.hours.error.noDay", "Mark at least one day open, or clear the hours.", "Marque al menos un día abierto, o quite el horario."],
      ["voice.hours.saveFailed", "Couldn't save the hours. Try again.", "No se pudo guardar el horario. Intente de nuevo."],
      ["voice.services.title", "Services & prices", "Servicios y precios"],
      ["voice.services.titleInsurance", "Services", "Servicios"],
      ["voice.services.body", "{persona} says these prices exactly as written below, and no others.", "{persona} dice estos precios tal como están escritos abajo, y ningún otro."],
      ["voice.services.insuranceNotice", "On insurance accounts {persona} names these services but never gives a price.", "En cuentas de seguros, {persona} nombra estos servicios pero nunca da un precio."],
      ["voice.services.empty", "List your services and prices so {persona} quotes them exactly.", "Anote sus servicios y precios para que {persona} los diga exactamente."],
      ["voice.services.add", "Add a service", "Agregar un servicio"],
      ["voice.services.max", "You can list up to 50 services.", "Puede anotar hasta 50 servicios."],
      ["voice.services.moveUp", "Move {name} up", "Subir {name}"],
      ["voice.services.moveDown", "Move {name} down", "Bajar {name}"],
      ["voice.services.editNamed", "Edit {name}", "Editar {name}"],
      ["voice.services.removeNamed", "Remove {name}", "Quitar {name}"],
      ["voice.services.keepNamed", "Keep {name}", "Conservar {name}"],
      ["voice.services.unnamed", "New service", "Servicio nuevo"],
      ["voice.services.kindPlaceholder", "Choose one", "Elija una opción"],
      ["voice.services.renameDropsPrice", "Renaming this service removes the price stored for it.", "Al cambiar el nombre de este servicio se quita el precio guardado."],
      ["voice.services.edit", "Edit", "Editar"],
      ["voice.services.done", "Done", "Listo"],
      ["voice.services.remove", "Remove", "Quitar"],
      ["voice.services.removing", "Removed when you save", "Se quita al guardar"],
      ["voice.services.keep", "Keep", "Conservar"],
      ["voice.services.nameEn", "Name in English", "Nombre en inglés"],
      ["voice.services.nameEs", "Name in Spanish (optional)", "Nombre en español (opcional)"],
      ["voice.services.descriptionEn", "Description in English (optional)", "Descripción en inglés (opcional)"],
      ["voice.services.descriptionEs", "Description in Spanish (optional)", "Descripción en español (opcional)"],
      ["voice.services.kind", "How it's priced", "Cómo se cobra"],
      ["voice.services.kind.fixed", "Fixed price", "Precio fijo"],
      ["voice.services.kind.from", "Starting price", "Precio desde"],
      ["voice.services.kind.range", "Price range", "Rango de precio"],
      ["voice.services.kind.per_unit", "Price per unit", "Precio por unidad"],
      ["voice.services.kind.free", "Free", "Sin costo"],
      ["voice.services.kind.after_visit", "Priced after a visit", "Precio después de una visita"],
      ["voice.services.amount", "Price in dollars", "Precio en dólares"],
      ["voice.services.amountMin", "Lowest price in dollars", "Precio más bajo en dólares"],
      ["voice.services.amountMax", "Highest price in dollars", "Precio más alto en dólares"],
      ["voice.services.unitEn", "Unit in English (for example, guest)", "Unidad en inglés (por ejemplo, guest)"],
      ["voice.services.unitEs", "Unit in Spanish (for example, invitado)", "Unidad en español (por ejemplo, invitado)"],
      ["voice.services.previewEn", "What {persona} says in English", "Lo que {persona} dice en inglés"],
      ["voice.services.previewEs", "What {persona} says in Spanish", "Lo que {persona} dice en español"],
      ["voice.services.save", "Save services", "Guardar servicios"],
      ["voice.services.saved", "Services saved", "Servicios guardados"],
      ["voice.services.saveFailed", "Couldn't save the services. Try again.", "No se pudieron guardar los servicios. Intente de nuevo."],
      ["voice.services.loadFailed", "Couldn't load the services. Reload the page to try again.", "No se pudieron cargar los servicios. Recargue la página para intentar de nuevo."],
      ["voice.services.error.name", "Give every service a name in English.", "Póngale a cada servicio un nombre en inglés."],
      ["voice.services.error.amount", "Add the price for {name}.", "Agregue el precio de {name}."],
      ["voice.services.error.range", "For {name}, the highest price must be more than the lowest.", "En {name}, el precio más alto debe ser mayor que el más bajo."],
      ["voice.services.error.units", "Add the unit in English and in Spanish for {name}.", "Agregue la unidad en inglés y en español para {name}."],
      ["voice.services.error.tooLong", "{name}: use at most 80 characters for a name, 300 for a description and 30 for a unit.", "{name}: use como máximo 80 caracteres para un nombre, 300 para una descripción y 30 para una unidad."],
      ["voice.services.summary.range", "{min} to {max}", "{min} a {max}"],
      ["voice.services.summary.perUnit", "{amount} per {unit}", "{amount} por {unit}"],
      ["voice.knowledge.stale", "Someone else just saved this. Reload to see their change.", "Alguien más acaba de guardar esto. Recargue la página para ver su cambio."],
      ["voice.knowledge.noProfile", "Save the voice profile above first.", "Primero guarde el perfil de voz de arriba."],
      ["voice.knowledge.invalid", "Something in this card couldn't be saved. Check it and try again.", "Algo en esta tarjeta no se pudo guardar. Revíselo e intente de nuevo."],
      ["voice.facts.hoursNotice", "Facts mentions hours. {persona} uses Business hours below, so take regular hours out of Facts. A closure on a specific date can stay.", "Los datos mencionan horarios. {persona} usa el Horario del negocio de abajo, así que quite el horario normal de los datos. Un cierre en una fecha específica puede quedarse."],
      ["voice.facts.hoursHint", "Add Business hours below so {persona} can tell callers whether you are open right now.", "Agregue el Horario del negocio abajo para que {persona} pueda decirles a quienes llaman si está abierto en este momento."],
      ["voice.facts.amountsNotice", "{persona} gives prices only from Services & prices, so these amounts in the Facts or Services box will not be said: {amounts}. Add each amount {persona} should say as its own row (a deposit or a fee too), or take it out. Refund and cancellation terms without an amount can stay.", "{persona} da precios solo de Servicios y precios, así que no dirá estos montos del cuadro de datos o de servicios: {amounts}. Agregue como su propia fila cada monto que {persona} deba decir (también un depósito o una cuota), o quítelo. Los términos de reembolso y cancelación sin monto pueden quedarse."],
      ["voice.facts.amountsNoticeInsurance", "{persona} never gives prices on insurance accounts, so these amounts in the Facts or Services box will not be said: {amounts}. You can take them out.", "{persona} nunca da precios en cuentas de seguros, así que no dirá estos montos del cuadro de datos o de servicios: {amounts}. Puede quitarlos."],
      ["voice.profile.factsHintInsurance", "Policies and anything else a caller might ask about. Hours go in their own card below. Prices are never given on insurance accounts.", "Pólizas y cualquier otra cosa que pregunte quien llama. El horario va en su propia tarjeta abajo. En cuentas de seguros nunca se dan precios."],
      ["calls.detail.knowledge", "Knowledge", "Conocimiento"],
      ["calls.detail.knowledgeLink", "What {persona} knew (#{version})", "Lo que {persona} sabía (#{version})"],
      ["voice.knowledge.title", "What {persona} knew", "Lo que {persona} sabía"],
      ["voice.knowledge.version", "Version {version}", "Versión {version}"],
      ["voice.knowledge.savedBy", "Saved {date} by {person}", "Guardada el {date} por {person}"],
      ["voice.knowledge.recordedAutomatically", "Recorded automatically {date}", "Registrada automáticamente el {date}"],
      ["voice.knowledge.facts", "Facts", "Datos"],
      ["voice.knowledge.servicesText", "Services (free text)", "Servicios (texto libre)"],
      ["voice.knowledge.hours", "Business hours", "Horario del negocio"],
      ["voice.knowledge.prices", "Services & prices", "Servicios y precios"],
      ["voice.knowledge.nameEs", "Name in Spanish", "Nombre en español"],
      ["voice.knowledge.aboutEn", "About it, in English", "Sobre el servicio, en inglés"],
      ["voice.knowledge.aboutEs", "About it, in Spanish", "Sobre el servicio, en español"],
      ["voice.knowledge.inEnglish", "Price, in English", "Precio, en inglés"],
      ["voice.knowledge.inSpanish", "Price, in Spanish", "Precio, en español"],
      ["voice.knowledge.nothing", "Nothing was written here.", "No había nada escrito aquí."],
      ["voice.knowledge.noHours", "No business hours were set.", "No había horario del negocio."],
      ["voice.knowledge.noPrices", "No services were listed.", "No había servicios en la lista."],
      ["voice.knowledge.older", "Older", "Anterior"],
      ["voice.knowledge.newer", "Newer", "Más reciente"],
      ["voice.knowledge.back", "Back to Voice", "Volver a Voz"],
      ["voice.knowledge.notFound", "This account has no version {version}.", "Esta cuenta no tiene la versión {version}."],
      ["voice.knowledge.loadFailed", "Couldn't load this version. Reload the page to try again.", "No se pudo cargar esta versión. Recargue la página para intentar de nuevo."],
      ["voice.knowledge.notFoundGeneric", "This version doesn't exist.", "Esta versión no existe."],
      ["voice.knowledge.loading", "Loading this version", "Cargando esta versión"],
    ];
    const cat = m as Record<string, string>;
    for (const [k, en, es] of pairs) expect([cat[k], cat[`${k}.es`]], k).toEqual([en, es]);
  });

  it("interpolates through t() in both languages", () => {
    expect(t(m, "voice.hours.zone", "en", { zone: "America/Chicago" })).toBe("Times are in America/Chicago.");
    expect(t(m, "voice.hours.zone", "es", { zone: "America/Chicago" })).toBe("Las horas están en America/Chicago.");
  });

  it("Spanish is usted, the persona is never typed, no plumbing word reaches the reader (mutations: 'tu' / 'Sofía' / 'jsonb' into one line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(cat[`${k}.es`]).not.toMatch(/\b(tu|tus|contigo|escribe|intenta)\b/i);
      for (const s of [cat[k]!, cat[`${k}.es`]!]) {
        expect(s).not.toMatch(/Sofía|Sofia/);
        expect(s.replace(/\{\w+\}/g, "")).not.toMatch(/\b(jsonb|null|payload|price_kind|per_unit|RPC|snapshot)\b/i);
      }
    }
  });
});

describe("S-47d: the one switch copy, English and Spanish (plan Task 2)", () => {
  const EXPECTED_PARAMS: Record<string, readonly string[]> = {
    "business.state.open": [],
    "business.state.closedToday": [],
    "business.state.runningLate": [],
    "business.state.storm": [],
    "business.menu.trigger": [],
    "business.menu.open": [],
    "business.menu.closedToday": [],
    "business.menu.runningLate": [],
    "business.menu.late15": [],
    "business.menu.late30": [],
    "business.menu.late60": [],
    "business.menu.late120": [],
    "business.menu.storm": [],
    "business.menu.stormOpenEnded": [],
    "business.menu.stormBackOn": [],
    "business.menu.changeClosedDays": [],
    "business.storm.title": [],
    "business.storm.description": [],
    "business.storm.date": [],
    "business.storm.submit": [],
    "business.storm.dateError": [],
    "business.opens.time": ["time"],
    "business.opens.tomorrow": [],
    "business.opens.dayTime": ["day", "time"],
    "business.opens.day": ["day"],
    "business.opens.date": ["date"],
    "business.topbar.closedToday": ["opens"],
    "business.topbar.storm": [],
    "business.topbar.stormDated": ["opens"],
    "business.topbar.late15": [],
    "business.topbar.late30": [],
    "business.topbar.late60": [],
    "business.topbar.late120": [],
    "business.topbar.short.closedToday": [],
    "business.topbar.short.storm": [],
    "business.topbar.short.late15": [],
    "business.topbar.short.late30": [],
    "business.topbar.short.late60": [],
    "business.topbar.short.late120": [],
    "business.topbar.open": [],
    "business.toast.closedToday": [],
    "business.toast.storm": [],
    "business.toast.late": [],
    "business.toast.open": [],
    "business.toast.persona": ["persona"],
    "business.toast.todo": ["n"],
    "business.toast.todoOne": [],
    "business.toast.undone": [],
    "business.toast.changedSince": [],
    "business.toast.failed": [],
    "business.refuse.role": [],
    "business.refuse.closeOrReopen": [],
    "business.refuse.keep": [],
    "business.card.title": [],
    "business.card.change": [],
    "business.card.openToday": [],
    "business.card.nextClosedDay": ["date"],
    "business.card.nextClosedDayReason": ["date", "reason"],
    "business.card.opensAgain.tomorrow": ["time"],
    "business.card.opensAgain.day": ["day", "time"],
    "business.card.opensAgain.date": ["date", "time"],
    "business.card.opensAgain.tomorrowNoTime": [],
    "business.card.opensAgain.dayNoTime": ["day"],
    "business.card.opensAgain.dateNoTime": ["date"],
    "business.card.untilReopen": [],
    "business.card.endsMidnight": [],
    "business.card.lateHidden": ["minutes"],
    "business.card.lateHidden120": [],
    "business.card.affectedAppointments": [],
    "business.card.waiting": ["n"],
    "business.card.waitingOne": [],
    "business.card.keep": [],
    "business.card.kept": [],
    "business.card.keptToast": [],
    "business.card.keepFailed": [],
    "business.card.cancelOnCalendar": [],
    "business.card.moreLater": ["date"],
    "business.card.noneAffected": [],
    "business.card.error": [],
    "business.card.retry": [],
    "business.reason.holiday": [],
    "business.reason.vacation": [],
    "business.reason.other": [],
    "business.reason.none": [],
    "closedDays.title": [],
    "closedDays.from": [],
    "closedDays.to": [],
    "closedDays.reason": [],
    "closedDays.add": [],
    "closedDays.remove": [],
    "closedDays.count": ["n"],
    "closedDays.countOne": [],
    "closedDays.moreAppointments": [],
    "closedDays.added": [],
    "closedDays.addedTodo": ["n"],
    "closedDays.addedTodoOne": [],
    "closedDays.removed": [],
    "closedDays.empty": ["persona"],
    "closedDays.emptyNoPersona": [],
    "closedDays.error": [],
    "closedDays.saveFailed": [],
    "closedDays.role": [],
    "closedDays.error.past": [],
    "closedDays.error.endBeforeStart": [],
    "closedDays.error.tooLong": [],
    "closedDays.error.tooFar": [],
    "closedDays.error.overlap": ["range"],
    "business.todo.status": [],
    "business.todo.closedDay": ["dates"],
    "automations.reason.heldClosedToday": [],
    "automations.reason.heldStorm": [],
    "automations.reason.heldClosedDay": [],
    "automations.reason.heldClosureUnknown": [],
    "automations.reason.skippedClosed": [],
    "calls.detail.businessStatus": [],
    "calls.detail.businessStatus.open": [],
    "calls.detail.businessStatus.closed_today": [],
    "calls.detail.businessStatus.running_late_15": [],
    "calls.detail.businessStatus.running_late_30": [],
    "calls.detail.businessStatus.running_late_60": [],
    "calls.detail.businessStatus.running_late_120": [],
    "calls.detail.businessStatus.storm": [],
    "calls.detail.businessStatus.closed_day": [],
    "voice.knowledge.closedDays": [],
    "voice.knowledge.noClosedDays": [],
    "voice.knowledge.noClosedDaysRecorded": [],
  };
  const KEYS = Object.keys(EXPECTED_PARAMS) as (keyof typeof m)[];
  // The SET of names: a sentence may name one twice, and t() replaces every occurrence.
  const paramsOf = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!))].sort();

  it("the key list itself is the 126 rows: the table's 108, the call-page table's 12, the fix round's 5 (business.storm.description, business.refuse.keep, business.card.keepFailed, closedDays.addedTodoOne, closedDays.emptyNoPersona), and the Calendar-page undercount fix round's 1 (closedDays.moreAppointments) (guards the loops below from vacuity)", () => {
    expect(KEYS.length).toBe(126);
  });

  it("every key exists with its Spanish twin, and none matches its twin (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    expect(KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`])).toEqual([]);
  });

  it("names exactly its params, the same set in both languages (mutation: {opens} -> {open} in one .es -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(paramsOf(cat[k]!), `"${k}" (en)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
      expect(paramsOf(cat[`${k}.es`]!), `"${k}" (es)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
    }
  });

  it("pins every sentence, both languages (mutation: change one word -> FAILS)", () => {
    const pairs: Array<[string, string, string]> = [
      ["business.state.open", "Open", "Abierto"],
      ["business.state.closedToday", "Closed today", "Cerrado hoy"],
      ["business.state.runningLate", "Running late", "Con retraso"],
      ["business.state.storm", "Closed for a storm", "Cerrado por tormenta"],
      ["business.menu.trigger", "Change today's status", "Cambiar el estado de hoy"],
      ["business.menu.open", "Open", "Abierto"],
      ["business.menu.closedToday", "Closed today", "Cerrado hoy"],
      ["business.menu.runningLate", "Running late", "Con retraso"],
      ["business.menu.late15", "About 15 minutes", "Unos 15 minutos"],
      ["business.menu.late30", "About 30 minutes", "Unos 30 minutos"],
      ["business.menu.late60", "About an hour", "Como una hora"],
      ["business.menu.late120", "More than an hour", "Más de una hora"],
      ["business.menu.storm", "Storm", "Tormenta"],
      ["business.menu.stormOpenEnded", "Until further notice", "Hasta nuevo aviso"],
      ["business.menu.stormBackOn", "Back on a date…", "Reabrimos el…"],
      ["business.menu.changeClosedDays", "Change closed days", "Cambiar días cerrados"],
      ["business.storm.title", "Closed for a storm", "Cerrado por tormenta"],
      ["business.storm.description", "When do you reopen?", "¿Cuándo vuelve a abrir?"],
      ["business.storm.date", "Back on", "Reabrimos el"],
      ["business.storm.submit", "Close until then", "Cerrar hasta entonces"],
      ["business.storm.dateError", "Pick a date from tomorrow to 92 days from now.", "Elija una fecha entre mañana y dentro de 92 días."],
      ["business.opens.time", "opens {time}", "abre a las {time}"],
      ["business.opens.tomorrow", "opens tomorrow", "abre mañana"],
      ["business.opens.dayTime", "opens {day} {time}", "abre el {day} a las {time}"],
      ["business.opens.day", "opens {day}", "abre el {day}"],
      ["business.opens.date", "opens {date}", "abre el {date}"],
      ["business.topbar.closedToday", "Closed today · {opens}", "Cerrado hoy · {opens}"],
      ["business.topbar.storm", "Closed for a storm", "Cerrado por tormenta"],
      ["business.topbar.stormDated", "Closed for a storm · {opens}", "Cerrado por tormenta · {opens}"],
      ["business.topbar.late15", "Running about 15 min late", "Con unos 15 min de retraso"],
      ["business.topbar.late30", "Running about 30 min late", "Con unos 30 min de retraso"],
      ["business.topbar.late60", "Running about an hour late", "Con alrededor de una hora de retraso"],
      ["business.topbar.late120", "Running over an hour late", "Con más de una hora de retraso"],
      ["business.topbar.short.closedToday", "Closed today", "Cerrado hoy"],
      ["business.topbar.short.storm", "Storm", "Tormenta"],
      ["business.topbar.short.late15", "15 min late", "15 min tarde"],
      ["business.topbar.short.late30", "30 min late", "30 min tarde"],
      ["business.topbar.short.late60", "1 hr late", "1 h tarde"],
      ["business.topbar.short.late120", "1+ hr late", "1+ h tarde"],
      ["business.topbar.open", "Open", "Abierto"],
      ["business.toast.closedToday", "Closed for today. Your booking page now says so.", "Cerrado por hoy. Su página de citas ya lo dice."],
      ["business.toast.storm", "Closed for a storm. Your booking page now says so.", "Cerrado por tormenta. Su página de citas ya lo dice."],
      ["business.toast.late", "Running late today. Booking stays open.", "Con retraso hoy. Se siguen aceptando citas."],
      ["business.toast.open", "Open again. Your booking page takes bookings as usual.", "Abierto de nuevo. Su página de citas acepta reservas como siempre."],
      ["business.toast.persona", "{persona} says so too.", "{persona} también lo dice."],
      ["business.toast.todo", "A To-do lists the {n} affected appointments.", "Una tarea en Pendientes lista las {n} citas afectadas."],
      ["business.toast.todoOne", "A To-do lists the affected appointment.", "Una tarea en Pendientes lista la cita afectada."],
      ["business.toast.undone", "Change undone.", "Cambio deshecho."],
      ["business.toast.changedSince", "Someone changed this since, so nothing was undone.", "Alguien lo cambió mientras tanto, así que no se deshizo nada."],
      ["business.toast.failed", "Couldn't change today's status. Try again.", "No se pudo cambiar el estado de hoy. Intente de nuevo."],
      ["business.refuse.role", "Only an Owner can change this.", "Solo un dueño puede cambiar esto."],
      ["business.refuse.closeOrReopen", "Only an Owner can close the business or reopen it.", "Solo un dueño puede cerrar el negocio o volver a abrirlo."],
      ["business.refuse.keep", "Only an Owner or Staff can keep an appointment.", "Solo un dueño o un empleado puede mantener una cita."],
      ["business.card.title", "Today", "Hoy"],
      ["business.card.change", "Change", "Cambiar"],
      ["business.card.openToday", "Open today", "Abierto hoy"],
      ["business.card.nextClosedDay", "Next closed day: {date}", "Próximo día cerrado: {date}"],
      ["business.card.nextClosedDayReason", "Next closed day: {date} ({reason})", "Próximo día cerrado: {date} ({reason})"],
      ["business.card.opensAgain.tomorrow", "Opens again tomorrow at {time}", "Abre de nuevo mañana a las {time}"],
      ["business.card.opensAgain.day", "Opens again on {day} at {time}", "Abre de nuevo el {day} a las {time}"],
      ["business.card.opensAgain.date", "Opens again on {date} at {time}", "Abre de nuevo el {date} a las {time}"],
      ["business.card.opensAgain.tomorrowNoTime", "Opens again tomorrow", "Abre de nuevo mañana"],
      ["business.card.opensAgain.dayNoTime", "Opens again on {day}", "Abre de nuevo el {day}"],
      ["business.card.opensAgain.dateNoTime", "Opens again on {date}", "Abre de nuevo el {date}"],
      ["business.card.untilReopen", "Until you reopen", "Hasta que vuelva a abrir"],
      ["business.card.endsMidnight", "Ends at midnight", "Termina a medianoche"],
      ["business.card.lateHidden", "Booking stays open; times in the next {minutes} minutes are hidden.", "Se siguen aceptando citas; se ocultan los horarios de los próximos {minutes} minutos."],
      ["business.card.lateHidden120", "Booking stays open; times in the next 2 hours are hidden.", "Se siguen aceptando citas; se ocultan los horarios de las próximas 2 horas."],
      ["business.card.affectedAppointments", "Affected appointments", "Citas afectadas"],
      ["business.card.waiting", "{n} messages waiting", "{n} mensajes en espera"],
      ["business.card.waitingOne", "1 message waiting", "1 mensaje en espera"],
      ["business.card.keep", "Keep", "Mantener"],
      ["business.card.kept", "Kept", "Se mantiene"],
      ["business.card.keptToast", "Kept. Its reminders go out as usual.", "Se mantiene. Sus recordatorios salen como siempre."],
      ["business.card.keepFailed", "Couldn't keep this appointment. Try again.", "No se pudo mantener esta cita. Intente de nuevo."],
      ["business.card.cancelOnCalendar", "Cancel on the calendar", "Cancelar en el calendario"],
      ["business.card.moreLater", "More appointments after {date} are on the calendar.", "Hay más citas después del {date} en el calendario."],
      ["business.card.noneAffected", "No appointments are affected.", "Ninguna cita se ve afectada."],
      ["business.card.error", "Couldn't load today's status.", "No se pudo cargar el estado de hoy."],
      ["business.card.retry", "Retry", "Reintentar"],
      ["business.reason.holiday", "Holiday", "Día festivo"],
      ["business.reason.vacation", "Vacation", "Vacaciones"],
      ["business.reason.other", "Other", "Otro"],
      ["business.reason.none", "None", "Ninguno"],
      ["closedDays.title", "Closed days", "Días cerrados"],
      ["closedDays.from", "From", "Desde"],
      ["closedDays.to", "To (optional)", "Hasta (opcional)"],
      ["closedDays.reason", "Reason", "Motivo"],
      ["closedDays.add", "Add closed days", "Agregar días cerrados"],
      ["closedDays.remove", "Remove", "Quitar"],
      ["closedDays.count", "{n} appointments", "{n} citas"],
      ["closedDays.countOne", "1 appointment", "1 cita"],
      ["closedDays.moreAppointments", "There may be more appointments than shown.", "Puede haber más citas de las que se muestran."],
      ["closedDays.added", "Closed days added.", "Días cerrados agregados."],
      ["closedDays.addedTodo", "{n} appointments are on these days. A To-do lists them.", "Hay {n} citas en estos días. Una tarea en Pendientes las lista."],
      ["closedDays.addedTodoOne", "1 appointment is on these days. A To-do lists it.", "Hay 1 cita en estos días. Una tarea en Pendientes la lista."],
      ["closedDays.removed", "Closed days removed.", "Días cerrados quitados."],
      ["closedDays.empty", "No closed days planned. Add a holiday or a vacation, and your booking page and {persona} will know you're closed.", "No hay días cerrados planeados. Agregue un día festivo o unas vacaciones, y su página de citas y {persona} sabrán que está cerrado."],
      ["closedDays.emptyNoPersona", "No closed days planned. Add a holiday or a vacation, and your booking page will know you're closed.", "No hay días cerrados planeados. Agregue un día festivo o unas vacaciones, y su página de citas sabrá que está cerrado."],
      ["closedDays.error", "Couldn't load closed days.", "No se pudieron cargar los días cerrados."],
      ["closedDays.saveFailed", "Couldn't save the closed days. Try again.", "No se pudieron guardar los días cerrados. Intente de nuevo."],
      ["closedDays.role", "Only an Owner can change closed days.", "Solo un dueño puede cambiar los días cerrados."],
      ["closedDays.error.past", "The first day can't be in the past.", "El primer día no puede ser en el pasado."],
      ["closedDays.error.endBeforeStart", "The last day must be on or after the first.", "El último día debe ser igual o posterior al primero."],
      ["closedDays.error.tooLong", "Closed days can cover at most 92 days at a time.", "Los días cerrados pueden cubrir como máximo 92 días a la vez."],
      ["closedDays.error.tooFar", "Closed days must end within the next 12 months.", "Los días cerrados deben terminar dentro de los próximos 12 meses."],
      ["closedDays.error.overlap", "These days overlap {range}, already listed.", "Estos días se cruzan con {range}, que ya está en la lista."],
      ["business.todo.status", "Contact customers affected by the closure", "Comuníquese con los clientes afectados por el cierre"],
      ["business.todo.closedDay", "Contact customers booked on {dates}", "Comuníquese con los clientes con cita el {dates}"],
      ["automations.reason.heldClosedToday", "Held: the business is closed today", "En espera: el negocio está cerrado hoy"],
      ["automations.reason.heldStorm", "Held: closed for a storm", "En espera: cerrado por tormenta"],
      ["automations.reason.heldClosedDay", "Held: the business is closed that day", "En espera: el negocio está cerrado ese día"],
      ["automations.reason.heldClosureUnknown", "Held: couldn't check whether the business is open", "En espera: no se pudo comprobar si el negocio está abierto"],
      ["automations.reason.skippedClosed", "Not sent: the business was closed for this appointment", "No se envió: el negocio estaba cerrado para esta cita"],
      ["calls.detail.businessStatus", "Status at the start", "Estado al empezar"],
      ["calls.detail.businessStatus.open", "Open", "Abierto"],
      ["calls.detail.businessStatus.closed_today", "Closed today", "Cerrado hoy"],
      ["calls.detail.businessStatus.running_late_15", "Running about 15 minutes late", "Con unos 15 minutos de retraso"],
      ["calls.detail.businessStatus.running_late_30", "Running about 30 minutes late", "Con unos 30 minutos de retraso"],
      ["calls.detail.businessStatus.running_late_60", "Running about an hour late", "Con alrededor de una hora de retraso"],
      ["calls.detail.businessStatus.running_late_120", "Running more than an hour late", "Con más de una hora de retraso"],
      ["calls.detail.businessStatus.storm", "Closed for a storm", "Cerrado por tormenta"],
      ["calls.detail.businessStatus.closed_day", "Closed (closed day)", "Cerrado (día cerrado)"],
      ["voice.knowledge.closedDays", "Closed days", "Días cerrados"],
      ["voice.knowledge.noClosedDays", "No closed days were planned.", "No había días cerrados planeados."],
      ["voice.knowledge.noClosedDaysRecorded", "No closed days were recorded in this version.", "En esta versión no se registraron días cerrados."],
    ];
    const cat = m as Record<string, string>;
    for (const [k, en, es] of pairs) expect([cat[k], cat[`${k}.es`]], k).toEqual([en, es]);
  });

  it("Spanish is usted, the persona is never typed, no plumbing word reaches the reader (mutations: 'tu' / 'Sofía' / 'business_status' into one line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(cat[`${k}.es`]).not.toMatch(/\b(tu|tus|contigo|escribe|intenta)\b/i);
      for (const s of [cat[k]!, cat[`${k}.es`]!]) {
        expect(s).not.toMatch(/Sofía|Sofia/);
        expect(s.replace(/\{\w+\}/g, "")).not.toMatch(/\b(business_status|closure_kind|null|RPC|set_at|running_late)\b/i);
      }
    }
  });
});

describe("S-47e: identity and shared-number copy, English and Spanish (plan Task 2)", () => {
  const EXPECTED_PARAMS: Record<string, readonly string[]> = {
    "voice.todo.identity": [],
    "contact.holding.label": ["number"],
    "conversation.holding.notice": ["number"],
    "conversation.holding.move": [],
    "conversation.holding.moveOther": [],
    "conversation.holding.moved": ["name"],
    "conversation.holding.movedBack": [],
    "conversation.holding.moveFailed": [],
    "conversation.holding.moveEmpty": [],
    "call.holding.openTexts": [],
    "conversation.holding.findLabel": [],
    "conversation.holding.findNone": [],
    "conversation.holding.findHint": [],
    "conversation.holding.findCustomer": [],
    "conversation.holding.findFailed": [],
    "conversation.holding.moveRole": [],
    "todo.sharedNumber.reply": [],
    "todo.sharedNumber.hold": ["excerpt", "number"],
  };
  const KEYS = Object.keys(EXPECTED_PARAMS) as (keyof typeof m)[];
  // The SET of names: a sentence may name one twice, and t() replaces every occurrence.
  const paramsOf = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!))].sort();

  it("the key list itself is the plan's 16 rows plus the design review's two (T17 M-4, M-7): one voice, one contact, thirteen conversation, one call, two todo (guards the loops below from vacuity)", () => {
    expect(KEYS.length).toBe(18);
  });

  it("every key exists with its Spanish twin, and none matches its twin (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    expect(KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`])).toEqual([]);
  });

  it("names exactly its params, the same set in both languages (mutation: {number} -> {num} in one .es -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(paramsOf(cat[k]!), `"${k}" (en)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
      expect(paramsOf(cat[`${k}.es`]!), `"${k}" (es)`).toEqual([...EXPECTED_PARAMS[k]!].sort());
    }
  });

  it("pins every sentence, both languages (mutation: change one word -> FAILS)", () => {
    const pairs: Array<[string, string, string]> = [
      ["voice.todo.identity", "Someone asked about an appointment and couldn't confirm who they are", "Alguien preguntó por una cita y no pudo confirmar quién es"],
      ["contact.holding.label", "Shared number {number}", "Número compartido {number}"],
      ["conversation.holding.notice", "These texts came from {number}, a phone more than one customer uses, so they aren't filed under anyone yet. Move them to the right person.", "Estos mensajes llegaron desde el {number}, un teléfono que usa más de un cliente, así que todavía no están en el registro de ningún cliente. Muévalos a la persona correcta."],
      ["conversation.holding.move", "Move to…", "Mover a…"],
      ["conversation.holding.moveOther", "Find another customer", "Buscar otro cliente"],
      ["conversation.holding.moved", "Moved to {name}.", "Los mensajes se movieron a {name}."],
      ["conversation.holding.movedBack", "Moved back.", "Los mensajes se regresaron."],
      ["conversation.holding.moveFailed", "That conversation couldn't be moved. Try again.", "No se pudo mover la conversación. Inténtelo de nuevo."],
      ["conversation.holding.moveEmpty", "These texts were already moved.", "Estos mensajes ya se movieron."],
      ["call.holding.openTexts", "Open the texts", "Abrir los mensajes"],
      ["conversation.holding.findLabel", "Search customers by name or phone", "Buscar clientes por nombre o teléfono"],
      ["conversation.holding.findNone", "No one found. Add them on Contacts first, then move these texts.", "No se encontró a nadie. Agréguelo primero en Contactos y luego mueva estos mensajes."],
      ["conversation.holding.findHint", "Pick who these texts belong to. They move as soon as you choose, and you can undo.", "Elija a quién pertenecen estos mensajes. Se mueven en cuanto elige, y puede deshacerlo."],
      ["conversation.holding.findCustomer", "Find a customer", "Buscar un cliente"],
      ["conversation.holding.findFailed", "Couldn't search customers. Try again.", "No se pudo buscar clientes. Inténtelo de nuevo."],
      ["conversation.holding.moveRole", "Only an Owner or Staff can move these texts.", "Solo un dueño o un empleado puede mover estos mensajes."],
      ["todo.sharedNumber.reply", "A reply from a shared number couldn't be matched to one appointment", "Una respuesta de un número compartido no se pudo asociar con una sola cita"],
      ["todo.sharedNumber.hold", "A text from the shared number {number} may have asked to stop texts: “{excerpt}”. Texts to that number are on hold.", "Un mensaje del número compartido {number} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes a ese número están en pausa."],
    ];
    const cat = m as Record<string, string>;
    for (const [k, en, es] of pairs) expect([cat[k], cat[`${k}.es`]], k).toEqual([en, es]);
  });

  it("Spanish is usted, the persona is never typed, no plumbing word reaches the reader (mutations: 'tu' / 'Sofía' / 'conversation_id' into one line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of KEYS) {
      expect(cat[`${k}.es`]).not.toMatch(/\b(tu|tus|contigo|escribe|intenta)\b/i);
      for (const s of [cat[k]!, cat[`${k}.es`]!]) {
        expect(s).not.toMatch(/Sofía|Sofia/);
        expect(s.replace(/\{\w+\}/g, "")).not.toMatch(/\b(holds_shared_number|holding record|RPC|null|conversation_id)\b/i);
      }
    }
  });

  it("\"dueño\", never \"propietario\", in conversation.holding.moveRole.es (P14)", () => {
    const cat = m as Record<string, string>;
    expect(cat["conversation.holding.moveRole.es"]).toMatch(/dueño/);
    expect(cat["conversation.holding.moveRole.es"]).not.toMatch(/propietario/);
  });

  it("the Spanish Notice never says \"asignar\" or \"archivados\" (T17 design review M-8)", () => {
    const cat = m as Record<string, string>;
    expect(cat["conversation.holding.notice.es"]).not.toMatch(/asign|archivad/i);
  });
});

/**
 * M7a PR-4 (plan Task 3): the pause's banners (client, agency), the client
 * Billing page, the agency's Billing card (pause + Lift pause + the nightly
 * reconciliation result), the automation hold/skip reasons and the SMS
 * composer's send-time refusal. billing.banner.* existed English-only
 * before this task (rollout step 3); here they gain their first Spanish
 * twin, which is why they leave catalogue-baseline.json once regenerated
 * (Step 3 of the task).
 */
describe("M7a PR-4 copy (billing pause, English and Spanish)", () => {
  const WANT: Record<string, string> = {
    "billing.banner.client": "Your payment didn't go through. Update your card to keep automations running.",
    "billing.banner.client.es": "Su pago no se completó. Actualice su tarjeta para que las automatizaciones sigan funcionando.",
    "billing.banner.clientAction": "Go to Billing",
    "billing.banner.clientAction.es": "Ir a Facturación",
    "billing.banner.agency": "This client's last payment didn't go through.",
    "billing.banner.agency.es": "El último pago de este cliente no se completó.",
    "billing.banner.agencyAction": "See billing",
    "billing.banner.agencyAction.es": "Ver facturación",
    "billing.paused.client.payment": "Your account is paused because a payment didn't go through. Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed until it's paid.",
    "billing.paused.client.payment.es": "Su cuenta está en pausa porque un pago no se completó. Su recepcionista no está contestando llamadas, los mensajes a sus clientes están detenidos, las automatizaciones están en espera y aquí no se puede cambiar nada hasta que se pague.",
    "billing.paused.client.ended": "Your plan has ended, so your account is paused. Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed.",
    "billing.paused.client.ended.es": "Su plan terminó, así que su cuenta está en pausa. Su recepcionista no está contestando llamadas, los mensajes a sus clientes están detenidos, las automatizaciones están en espera y aquí no se puede cambiar nada.",
    "billing.paused.client.action": "Go to Billing",
    "billing.paused.client.action.es": "Ir a Facturación",
    "billing.paused.client.staff": "The account owner can turn everything back on from the Billing page.",
    "billing.paused.client.staff.es": "El dueño de la cuenta puede volver a activar todo desde la página de Facturación.",
    "billing.paused.agency": "This client is paused: the receptionist isn't answering, texts to their customers are stopped, automations are waiting, and their dashboard is read-only.",
    "billing.paused.agency.es": "Este cliente está en pausa: la recepcionista no está contestando, los mensajes a sus clientes están detenidos, las automatizaciones están en espera y su panel es de solo lectura.",
    "billing.paused.agencyAction": "See billing",
    "billing.paused.agencyAction.es": "Ver facturación",
    "billing.page.paused.payment": "Your account is paused until the payment goes through. Update your card with the button below to turn everything back on.",
    "billing.page.paused.payment.es": "Su cuenta está en pausa hasta que se complete el pago. Actualice su tarjeta con el botón de abajo para volver a activar todo.",
    "billing.page.paused.ended": "Your plan has ended, so your account is paused. To start again, email {email}.",
    "billing.page.paused.ended.es": "Su plan terminó, así que su cuenta está en pausa. Para volver a empezar, escriba a {email}.",
    "billing.page.paused.endedNoContact": "Your plan has ended, so your account is paused. To start again, contact the team that set up your account.",
    "billing.page.paused.endedNoContact.es": "Su plan terminó, así que su cuenta está en pausa. Para volver a empezar, comuníquese con el equipo que configuró su cuenta.",
    "billing.card.pausedPayment": "Paused since {date}: the payment failed on {failed}.",
    "billing.card.pausedPayment.es": "En pausa desde el {date}: el pago falló el {failed}.",
    "billing.card.pausedEnded": "Paused since {date}: the plan ended.",
    "billing.card.pausedEnded.es": "En pausa desde el {date}: el plan terminó.",
    "billing.card.noForward": "Calls are no longer forwarded: the account has been paused for over 30 days.",
    "billing.card.noForward.es": "Las llamadas ya no se desvían: la cuenta lleva más de 30 días en pausa.",
    "billing.card.pauseOff": "Pausing is switched off for this app, so this pause changes nothing.",
    "billing.card.pauseOff.es": "La pausa está desactivada en esta aplicación, así que esta pausa no cambia nada.",
    "billing.card.lifted": "Pause lifted {date}.",
    "billing.card.lifted.es": "Pausa quitada el {date}.",
    "billing.card.liftPause": "Lift pause",
    "billing.card.liftPause.es": "Quitar la pausa",
    "billing.card.liftPauseHelp": "Turns calls, texts and automations back on now. It stays lifted until they pay or another payment fails.",
    "billing.card.liftPauseHelp.es": "Vuelve a activar llamadas, mensajes y automatizaciones ahora. Sigue así hasta que paguen o falle otro pago.",
    "billing.card.liftedToast": "Pause lifted.",
    "billing.card.liftedToast.es": "Pausa quitada.",
    "billing.card.repausedToast": "Paused again.",
    "billing.card.repausedToast.es": "En pausa de nuevo.",
    "billing.card.reconcile.title": "Usage doesn't match Stripe",
    "billing.card.reconcile.title.es": "El uso no coincide con Stripe",
    "billing.card.reconcile.line": "{meter}: Stripe counts {stripe}, BIS counts {bis}. Checked {when}.",
    "billing.card.reconcile.line.es": "{meter}: Stripe cuenta {stripe}, BIS cuenta {bis}. Revisado el {when}.",
    "billing.card.reconcile.help": "Check this client's invoice in Stripe before it's finalized. The billing runbook says how.",
    "billing.card.reconcile.help.es": "Revise la factura de este cliente en Stripe antes de que se cierre. La guía de facturación explica cómo.",
    "billing.card.reconcile.meter.voice_minutes": "Call minutes",
    "billing.card.reconcile.meter.voice_minutes.es": "Minutos de llamadas",
    "billing.card.reconcile.meter.sms": "Texts",
    "billing.card.reconcile.meter.sms.es": "Mensajes de texto",
    "billing.card.reconcile.meter.ai_chats": "Website chats",
    "billing.card.reconcile.meter.ai_chats.es": "Chats del sitio web",
    "billing.card.reconcile.unavailable": "Couldn't check usage against Stripe just now.",
    "billing.card.reconcile.unavailable.es": "No se pudo comparar el uso con Stripe en este momento.",
    "billing.error.notPaused": "This account isn't paused any more. Refresh to see its billing.",
    "billing.error.notPaused.es": "Esta cuenta ya no está en pausa. Actualice la página para ver su facturación.",
    "billing.error.cannotRepause": "This account's billing changed, so it can't be paused again from here. Refresh to see it.",
    "billing.error.cannotRepause.es": "La facturación de esta cuenta cambió, así que no se puede volver a pausar desde aquí. Actualice la página para verla.",
    "automations.reason.heldBillingPaused": "Held: the account is paused until a payment goes through",
    "automations.reason.heldBillingPaused.es": "En espera: la cuenta está en pausa hasta que se reciba un pago",
    "automations.reason.skippedBillingPaused": "Not sent: too late, the account was paused",
    "automations.reason.skippedBillingPaused.es": "No se envió: demasiado tarde, la cuenta estaba en pausa",
    "compose.smsBlockedPaused": "Texts are stopped while this account is paused.",
    "compose.smsBlockedPaused.es": "Los mensajes están detenidos mientras la cuenta está en pausa.",
  };

  // Agency-only (`work.agency.` prefix — lib/i18n/ratchet-scan.ts's
  // AGENCY_ONLY_KEY_PREFIXES): English only, no Spanish twin required.
  const AGENCY_WANT: Record<string, string> = {
    "work.agency.billing.paymentFailed": "Payment failed:",
    "work.agency.billing.paused": "Paused:",
    "work.agency.billing.pausedNoForward": "Paused 30+ days, calls are no longer forwarded:",
    "work.agency.billing.mismatch": "Usage doesn't match Stripe:",
    "work.agency.billing.more": "and {n} more",
    "work.agency.billing.unchecked": "Couldn't check usage against Stripe just now.",
  };

  it("every PR-4 key is the plan's wording, in both languages (mutation: change any one string → FAILS naming it)", () => {
    const cat = m as Record<string, string>;
    for (const [k, v] of Object.entries(WANT)) expect(cat[k], k).toBe(v);
    for (const [k, v] of Object.entries(AGENCY_WANT)) expect(cat[k], k).toBe(v);
  });

  it("every English key (outside the agency-only work.agency.billing.* lines) has its .es twin directly on the next line (mutation: move a twin → FAILS)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es"))) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("a placeholder in English is a placeholder in Spanish (mutation: drop {failed} from billing.card.pausedPayment.es → FAILS)", () => {
    const cat = m as Record<string, string>;
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es"))) {
      expect(holes(cat[`${k}.es`]!), k).toBe(holes(cat[k]!));
    }
  });

  it("the Spanish is usted, never tú (mutation: restore a tú verb/pronoun in any .es line → FAILS)", () => {
    const cat = m as Record<string, string>;
    const TU = /\b(actualiza|usa|ve|tu|tus)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(cat[k]!), `${k}: ${cat[k]}`).toBe(false);
    }
  });

  it("the paused banner never promises a forward — no .paused. value names a phone (M3: true whether or not the account has a transfer number, and whatever day of the pause it is) (mutation: add 'calls forward to your phone' to billing.paused.client.payment → FAILS)", () => {
    const cat = m as Record<string, string>;
    for (const k of Object.keys(WANT).filter((x) => x.includes(".paused."))) {
      expect(cat[k]!.toLowerCase(), k).not.toMatch(/\bphone\b|\btel[eé]fono\b/);
    }
  });
});

describe("tenant vetting copy (S-53)", () => {
  it("is the plan's wording in both languages (mutation: any word changed, or a tu form such as 'Elige' -> FAILS)", () => {
    expect([m["vetting.trade.label"], m["vetting.trade.label.es"]]).toEqual(["Trade", "Giro"]);
    expect([m["vetting.sofia.noTrade"], m["vetting.sofia.noTrade.es"]])
      .toEqual(["Set this company's trade first.", "Primero indique el giro de esta empresa."]);
    expect([m["vetting.turnOffFirst"], m["vetting.turnOffFirst.es"]])
      .toEqual(["Turn off Sofía and the web chat first.", "Primero apague a Sofía y el chat del sitio web."]);
    expect([m["vetting.crmOnlyCreated"], m["vetting.crmOnlyCreated.es"]])
      .toEqual(["Sofía and the web chat aren't available for this trade yet.", "Sofía y el chat del sitio web aún no están disponibles para este giro."]);
    for (const [k, v] of Object.entries(m)) {
      if (k.startsWith("vetting.") && k.endsWith(".es")) {
        expect(v, k).not.toMatch(/\b(elige|indica|apaga|escribe|di|recárgala|inténtalo|vuelve)\b/i);
      }
    }
  });

  it("the Trade card has its own title, its own usted crash line, and the number list its own word (final review M7, design checks M1 and M6)", () => {
    expect([m["vetting.card.title"], m["vetting.card.title.es"]]).toEqual(["Business trade", "Giro del negocio"]);
    expect(m["vetting.card.title"]).not.toBe(m["vetting.trade.label"]);
    expect(m["vetting.card.title.es"]).not.toBe(m["vetting.trade.label.es"]);
    expect([m["vetting.crashed"], m["vetting.crashed.es"]]).toEqual([
      m["common.actionCrashed"],
      "Eso no se completó: puede que esta página esté desactualizada. Vuelva a cargarla e inténtelo de nuevo.",
    ]);
    expect([m["vetting.numberStatusLocked"], m["vetting.numberStatusLocked.es"]]).toEqual(["not available", "no disponible"]);
  });
});

describe("F-048 part 2: the Bookings on your phone card speaks usted (final review I1)", () => {
  const WANT_ES: Record<string, string> = {
    "calendar.feed.title.es": "Sus citas en el teléfono",
    "calendar.feed.empty.es": "Ponga cada cita en el calendario de su teléfono: iPhone, Google u Outlook. Tiene su propio enlace privado.",
    "calendar.feed.linkLabel.es": "Su enlace privado",
    "calendar.feed.private.es": "Quien tenga este enlace puede ver las horas de sus citas y el nombre de sus clientes. No lo comparta.",
    "calendar.feed.technician.es": "Su enlace muestra las citas de los clientes asignados a usted.",
    "calendar.feed.lastChecked.es": "Su calendario pidió sus citas por última vez {when}.",
    "calendar.feed.stale.es": "Su enlace se tiene que crear de nuevo. El anterior sigue funcionando hasta que lo haga.",
    "calendar.feed.loadError.es": "No pudimos cargar su enlace. Inténtelo de nuevo.",
    "calendar.feed.iphone.steps.es": "1. En su iPhone, abra esta página y toque Agregar al iPhone. 2. Toque Suscribirse y luego OK. Para ver antes las citas nuevas: en Ajustes, abra Calendario y luego Obtener datos.",
    "calendar.feed.google.steps.es": "1. En una computadora, entre a calendar.google.com. La app del teléfono no puede agregarlo. 2. Junto a Otros calendarios, haga clic en + y luego en Desde URL. 3. Pegue su enlace y haga clic en Agregar calendario. Aparece solo en su teléfono.",
    "calendar.feed.outlook.steps.es": "1. Entre a outlook.com y abra Calendario. 2. Haga clic en Agregar calendario y luego en Suscribirse desde la web. 3. Pegue su enlace, póngale un nombre y haga clic en Importar.",
    "calendar.feed.toast.restored.es": "Su enlace volvió.",
    "calendar.feed.error.failed.es": "No se guardó. Inténtelo de nuevo.",
    "calendar.feed.error.undoLate.es": "Ya no se puede deshacer. Cree un enlace nuevo.",
  };

  it("has each reviewed Spanish sentence exactly (mutation: restore any tú sentence → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT_ES)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("no calendar.feed.*.es key uses tú (mutation: 'Inténtalo de nuevo' in error.failed.es → FAILS)", () => {
    const TU = /(?<![\p{L}])(tu|tus|ti|tienes|puedes|pon|ponle|toca|abre|entra|haz|pega|elige|crea un|compartas|hagas|inténtalo)(?![\p{L}])/iu;
    const keys = Object.keys(m).filter((k) => k.startsWith("calendar.feed.") && k.endsWith(".es"));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(TU.test((m as Record<string, string>)[k]!), `${k}: ${(m as Record<string, string>)[k]}`).toBe(false);
  });

  it("the iPhone steps name only a path anyone can find: Settings, Calendar, Fetch New Data (final review m8)", () => {
    expect(m["calendar.feed.iphone.steps"]).toBe(
      "1. On your iPhone, open this page and tap Add to iPhone. 2. Tap Subscribe, then Done. To see new bookings sooner: in Settings, open Calendar, then Fetch New Data.",
    );
  });
});

describe("contact archive copy, English and Spanish (plan Task 3, spec §6)", () => {
  const WANT: Record<string, string> = {
    "bulk.archive": "Archive",
    "bulk.archive.es": "Archivar",
    "bulk.archived": "Archived {count} contacts",
    "bulk.archived.es": "Se archivaron {count} contactos",
    "bulk.archivedOne": "Archived 1 contact",
    "bulk.archivedOne.es": "Se archivó 1 contacto",
    "bulk.restore": "Restore",
    "bulk.restore.es": "Restaurar",
    "bulk.restored": "Moved {count} contacts back to your list",
    "bulk.restored.es": "Se devolvieron {count} contactos a su lista",
    "bulk.restoredOne": "Moved 1 contact back to your list",
    "bulk.restoredOne.es": "Se devolvió 1 contacto a su lista",
    "bulk.deletedSkipped": "Deleted {count} · kept {skipped} that have a history with you. You can archive those instead.",
    "bulk.deletedSkipped.es": "Contactos borrados: {count} · conservados porque tienen un historial con usted: {skipped}. Puede archivarlos.",
    "bulk.archiveKept": "Archive them",
    "bulk.archiveKept.es": "Archivarlos",
    "contacts.archived.link": "Archived",
    "contacts.archived.link.es": "Archivados",
    "contacts.archived.title": "Archived contacts",
    "contacts.archived.title.es": "Contactos archivados",
    "contacts.archived.count": "{count} archived",
    "contacts.archived.count.es": "{count} archivados",
    "contacts.archived.countOne": "1 archived",
    "contacts.archived.countOne.es": "1 archivado",
    "contacts.archived.back": "Back to contacts",
    "contacts.archived.back.es": "Volver a contactos",
    "contacts.archived.emptyTitle": "Nothing archived",
    "contacts.archived.emptyTitle.es": "No hay contactos archivados",
    "contacts.archived.emptyBody":
      "Contacts you archive wait here, off your list, with every call and text kept. Archive one from your list when you no longer need to see it.",
    "contacts.archived.emptyBody.es":
      "Aquí quedan los contactos que archive: fuera de su lista y con todas sus llamadas y mensajes guardados. Archive uno desde su lista cuando ya no necesite verlo.",
    "contacts.archived.mark": "Archived",
    "contacts.archived.mark.es": "Archivado",
    "contacts.archive.failed": "Couldn't archive. Nothing changed. Try again.",
    "contacts.archive.failed.es": "No se pudo archivar. No cambió nada. Intente de nuevo.",
    "contacts.restore.failed": "Couldn't restore. Nothing changed. Try again.",
    "contacts.restore.failed.es": "No se pudo restaurar. No cambió nada. Intente de nuevo.",
    "contacts.archive.keepsAppointment": "They still have an appointment on {date}. Its reminders still go.",
    "contacts.archive.keepsAppointment.es": "Todavía tiene una cita el {date}. Sus recordatorios se siguen enviando.",
    "contacts.archive.keepsAppointments": "{count} of them still have appointments. Their reminders still go.",
    "contacts.archive.keepsAppointments.es": "{count} de ellos todavía tienen citas. Sus recordatorios se siguen enviando.",
    "contacts.delete.archiveOnly":
      "{name} can't be deleted because they have a history with you, and we keep it. Archive them instead: they leave your list and nothing is lost.",
    "contacts.delete.archiveOnly.es":
      "No se puede borrar a {name} porque tiene un historial con usted, y lo conservamos. Mejor archive este contacto: sale de su lista y no se pierde nada.",
    "contacts.delete.someKept": "{kept} of these have a history with you and will be kept.",
    "contacts.delete.someKept.es": "{kept} de estos tienen un historial con usted y se conservarán.",
    "contacts.delete.noneDeletable": "None of these can be deleted: they all have a history with you. Archive them instead.",
    "contacts.delete.noneDeletable.es": "Ninguno se puede borrar porque todos tienen un historial con usted. Mejor archívelos.",
    "contacts.delete.archiveInstead": "Archive instead",
    "contacts.delete.archiveInstead.es": "Archivar",
    "contacts.delete.blockersFailed": "Couldn't check which of these can be deleted. Close this and try again.",
    "contacts.delete.blockersFailed.es": "No se pudo revisar cuáles se pueden borrar. Cierre esto e intente de nuevo.",
    "contacts.delete.oneTitle": "Delete {name} for good?",
    "contacts.delete.oneTitle.es": "¿Borrar a {name} para siempre?",
    "contacts.delete.oneBody": "This removes them with their notes, tasks and files. It can't be undone. Type {name} to confirm.",
    "contacts.delete.oneBody.es":
      "Esto borra el contacto con sus notas, tareas y archivos. No se puede deshacer. Escriba {name} para confirmar.",
    "contacts.delete.oneBodyNoName": "This contact has no name. Type the last four digits of their phone, {digits}, to confirm.",
    "contacts.delete.oneBodyNoName.es":
      "Este contacto no tiene nombre. Escriba los últimos cuatro dígitos de su teléfono, {digits}, para confirmar.",
    // Task 10 review: one-forms, the Archived view's delete lines, the partial-failure lines, the none title.
    "bulk.deletedSkippedOne": "Deleted {count} · kept 1 that has a history with you. You can archive it instead.",
    "bulk.deletedSkippedOne.es": "Contactos borrados: {count} · conservado porque tiene un historial con usted: 1. Puede archivarlo.",
    "bulk.deletedSkippedArchived": "Deleted {count} · kept {skipped} that have a history with you. They stay archived.",
    "bulk.deletedSkippedArchived.es": "Contactos borrados: {count} · conservados porque tienen un historial con usted: {skipped}. Siguen archivados.",
    "bulk.deletedSkippedArchivedOne": "Deleted {count} · kept 1 that has a history with you. It stays archived.",
    "bulk.deletedSkippedArchivedOne.es": "Contactos borrados: {count} · conservado porque tiene un historial con usted: 1. Sigue archivado.",
    "contacts.archive.partial": "Some of them couldn't be archived. Try again.",
    "contacts.archive.partial.es": "Algunos no se pudieron archivar. Intente de nuevo.",
    "contacts.restore.partial": "Some of them couldn't be restored. Try again.",
    "contacts.restore.partial.es": "Algunos no se pudieron restaurar. Intente de nuevo.",
    "contacts.archive.keepsAppointmentsOne": "1 of them still has an appointment. Its reminders still go.",
    "contacts.archive.keepsAppointmentsOne.es": "1 de ellos todavía tiene una cita. Sus recordatorios se siguen enviando.",
    "contacts.delete.someKeptOne": "1 of these has a history with you and will be kept.",
    "contacts.delete.someKeptOne.es": "1 de estos tiene un historial con usted y se conservará.",
    "contacts.delete.paused": "Nothing can be deleted while this account is paused.",
    "contacts.delete.paused.es": "No se puede borrar nada mientras la cuenta está en pausa.",
    "contacts.delete.noneTitle": "These can't be deleted",
    "contacts.delete.noneTitle.es": "No se pueden borrar",
    "contacts.delete.noneTitleOne": "This contact can't be deleted",
    "contacts.delete.noneTitleOne.es": "Este contacto no se puede borrar",
    "contacts.delete.noneDeletableOne": "They have a history with you, so they can't be deleted. Archive them instead.",
    "contacts.delete.noneDeletableOne.es": "Tiene un historial con usted, así que no se puede borrar. Mejor archívelo.",
    "contacts.delete.noneDeletableArchived": "None of these can be deleted: they all have a history with you, so they stay archived.",
    "contacts.delete.noneDeletableArchived.es": "Ninguno se puede borrar porque todos tienen un historial con usted, así que siguen archivados.",
    "contacts.delete.noneDeletableArchivedOne": "They have a history with you, so they can't be deleted. They stay archived.",
    "contacts.delete.noneDeletableArchivedOne.es": "Tiene un historial con usted, así que no se puede borrar. Sigue archivado.",
    "record.archive": "Archive",
    "record.archive.es": "Archivar",
    "record.restore": "Restore",
    "record.restore.es": "Restaurar",
    "record.delete": "Delete…",
    "record.delete.es": "Borrar…",
    "record.archivedBanner": "Archived {date} by {name}. Their calls and texts are kept.",
    "record.archivedBanner.es": "Archivado el {date} por {name}. Sus llamadas y mensajes se conservan.",
    "record.archivedBannerShort": "Archived {date}. Their calls and texts are kept.",
    "record.archivedBannerShort.es": "Archivado el {date}. Sus llamadas y mensajes se conservan.",
    "record.archivedToast": "{name} archived",
    "record.archivedToast.es": "{name} se archivó",
    "record.restoredToast": "{name} is back on your list",
    "record.restoredToast.es": "{name} volvió a su lista",
    "timeline.archived": "archived this contact",
    "timeline.archived.es": "archivó este contacto",
    "timeline.restored": "moved this contact back to the list",
    "timeline.restored.es": "devolvió este contacto a la lista",
    "timeline.cameBack.text": "came back: sent you a text",
    "timeline.cameBack.text.es": "volvió: le envió un mensaje",
    "timeline.cameBack.email": "came back: sent you an email",
    "timeline.cameBack.email.es": "volvió: le envió un correo",
    "timeline.cameBack.call": "came back: called and talked with {persona}",
    "timeline.cameBack.call.es": "volvió: llamó y habló con {persona}",
    "timeline.cameBack.booking": "came back: booked an appointment",
    "timeline.cameBack.booking.es": "volvió: hizo una cita",
    "timeline.cameBack.form": "came back: filled out your form",
    "timeline.cameBack.form.es": "volvió: llenó su formulario",
    "timeline.cameBack.chat": "came back: wrote in your website chat",
    "timeline.cameBack.chat.es": "volvió: escribió en el chat de su sitio web",
    "timeline.what.archive": "archive history",
    "timeline.what.archive.es": "historial de archivo",
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

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve' in contacts.archive.failed.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  // Review I5: the bulk bar's skip toast used to list WHICH kinds of history blocked a delete
  // ("linked to bookings, deals, or conversations"). Review M8: a reason list reads as a form
  // and goes stale as the delete-blocker set (spec §5.1) grows, so the new copy names none —
  // not here, and not on any contacts.delete.* key either.
  it("the skip toast stops listing reasons, and no delete key lists reasons either (mutation: restore 'linked to bookings, deals, or conversations' → FAILS)", () => {
    expect(m["bulk.deletedSkipped"]).not.toContain("linked to");
    const REASON_LIST = /,\s*(messages|email|calls|texts|forms|consent|automations|bookings|deals|conversations)\b/i;
    for (const [k, v] of Object.entries(WANT)) {
      if (!k.startsWith("contacts.delete.")) continue;
      expect(REASON_LIST.test(v), k).toBe(false);
    }
  });
});

describe("duplicates and merge copy, English and Spanish (F-006 plan Task 2)", () => {
  const WANT: Record<string, string> = {
    "contacts.duplicates.title": "Possible duplicates",
    "contacts.duplicates.title.es": "Posibles duplicados",
    "contacts.duplicates.link": "Possible duplicates",
    "contacts.duplicates.link.es": "Posibles duplicados",
    "contacts.duplicates.count": "{count} possible duplicates",
    "contacts.duplicates.count.es": "{count} posibles duplicados",
    "contacts.duplicates.countOne": "1 possible duplicate",
    "contacts.duplicates.countOne.es": "1 posible duplicado",
    "contacts.duplicates.banner": "May be the same person as {name} · {reason}",
    "contacts.duplicates.banner.es": "Puede ser la misma persona que {name} · {reason}",
    "contacts.duplicates.bannerMore": "and {count} more",
    "contacts.duplicates.bannerMore.es": "y {count} más",
    "contacts.duplicates.bannerMoreOne": "and 1 more",
    "contacts.duplicates.bannerMoreOne.es": "y 1 más",
    "contacts.duplicates.compare": "Compare",
    "contacts.duplicates.compare.es": "Comparar",
    "contacts.duplicates.reason.samePhone": "same phone number",
    "contacts.duplicates.reason.samePhone.es": "mismo número de teléfono",
    "contacts.duplicates.reason.sameDigits": "same phone digits, saved as a US and a Mexican number",
    "contacts.duplicates.reason.sameDigits.es": "mismos dígitos, guardados como número de EE. UU. y de México",
    "contacts.duplicates.reason.sameEmail": "same email",
    "contacts.duplicates.reason.sameEmail.es": "mismo correo",
    "contacts.duplicates.reason.sameName": "same name",
    "contacts.duplicates.reason.sameName.es": "mismo nombre",
    "contacts.duplicates.reason.other": "found when a record was saved",
    "contacts.duplicates.reason.other.es": "se detectó al guardar un registro",
    "contacts.duplicates.foundOn": "Found {date}",
    "contacts.duplicates.foundOn.es": "Detectado el {date}",
    "contacts.duplicates.emptyTitle": "No possible duplicates",
    "contacts.duplicates.emptyTitle.es": "No hay posibles duplicados",
    "contacts.duplicates.emptyBody":
      "When two records look like the same customer (same phone, email or name), they show up here so you can merge them.",
    "contacts.duplicates.emptyBody.es":
      "Cuando dos registros parecen ser el mismo cliente (mismo teléfono, correo o nombre), aparecen aquí para que los una.",
    "contacts.duplicates.listFailed": "Couldn't load possible duplicates. Try again.",
    "contacts.duplicates.listFailed.es": "No se pudieron cargar los posibles duplicados. Intente de nuevo.",
    "contacts.duplicates.notSame": "Not the same person",
    "contacts.duplicates.notSame.es": "No es la misma persona",
    "contacts.duplicates.dismissed": "Got it. We won't suggest these two again.",
    "contacts.duplicates.dismissed.es": "Entendido. No volveremos a sugerir estos dos.",
    "contacts.duplicates.dismissFailed": "Couldn't save that. Nothing changed. Try again.",
    "contacts.duplicates.dismissFailed.es": "No se pudo guardar. No cambió nada. Intente de nuevo.",
    "contacts.duplicates.next": "Next",
    "contacts.duplicates.next.es": "Siguiente",
    "contacts.duplicates.first": "Back to the start",
    "contacts.duplicates.first.es": "Volver al principio",
    "work.duplicates": "{count} possible duplicate customers to check",
    "work.duplicates.es": "{count} posibles clientes duplicados por revisar",
    "work.duplicatesOne": "1 possible duplicate customer to check",
    "work.duplicatesOne.es": "1 posible cliente duplicado por revisar",
    "contacts.merge.title": "Merge two records",
    "contacts.merge.title.es": "Unir dos registros",
    "contacts.merge.keep": "Keep this one",
    "contacts.merge.keep.es": "Conservar este",
    "contacts.merge.swap": "Keep this one instead",
    "contacts.merge.swap.es": "Mejor conservar este",
    "contacts.merge.joins": "Joins the one you keep",
    "contacts.merge.joins.es": "Se une al que conserva",
    "contacts.merge.pick": "The two records don't agree on the {field}. Which one do we keep?",
    "contacts.merge.pick.es": "Los dos registros no coinciden en {field}. ¿Cuál conservamos?",
    "contacts.merge.field.firstName": "first name",
    "contacts.merge.field.firstName.es": "el nombre",
    "contacts.merge.field.lastName": "last name",
    "contacts.merge.field.lastName.es": "el apellido",
    "contacts.merge.field.email": "email",
    "contacts.merge.field.email.es": "el correo",
    "contacts.merge.field.phone": "phone number",
    "contacts.merge.field.phone.es": "el teléfono",
    "contacts.merge.field.assignedTo": "person it's assigned to",
    "contacts.merge.field.assignedTo.es": "la persona asignada",
    "contacts.merge.field.language": "language",
    "contacts.merge.field.language.es": "el idioma",
    "contacts.merge.field.custom": "“{label}” field",
    "contacts.merge.field.custom.es": "campo “{label}”",
    "contacts.merge.alsoKeeps": "Also keeps: {list}",
    "contacts.merge.alsoKeeps.es": "También conserva: {list}",
    "contacts.merge.otherNumber": "Calls and texts from {phone} will still reach {name}.",
    "contacts.merge.otherNumber.es": "Las llamadas y los mensajes de {phone} seguirán llegando a {name}.",
    "contacts.merge.otherEmail": "Email from {email} will still reach {name}.",
    "contacts.merge.otherEmail.es": "Los correos de {email} seguirán llegando a {name}.",
    "contacts.merge.moves": "Moves to {name}: {list}",
    "contacts.merge.moves.es": "Pasan a {name}: {list}",
    "contacts.merge.nothingMoves": "{name} has no history to move.",
    "contacts.merge.nothingMoves.es": "{name} no tiene historial que pasar.",
    "contacts.merge.count.messages": "{count} messages",
    "contacts.merge.count.messages.es": "{count} mensajes",
    "contacts.merge.count.messagesOne": "1 message",
    "contacts.merge.count.messagesOne.es": "1 mensaje",
    "contacts.merge.count.calls": "{count} calls",
    "contacts.merge.count.calls.es": "{count} llamadas",
    "contacts.merge.count.callsOne": "1 call",
    "contacts.merge.count.callsOne.es": "1 llamada",
    "contacts.merge.count.bookings": "{count} appointments",
    "contacts.merge.count.bookings.es": "{count} citas",
    "contacts.merge.count.bookingsOne": "1 appointment",
    "contacts.merge.count.bookingsOne.es": "1 cita",
    "contacts.merge.count.documents": "{count} files",
    "contacts.merge.count.documents.es": "{count} archivos",
    "contacts.merge.count.documentsOne": "1 file",
    "contacts.merge.count.documentsOne.es": "1 archivo",
    "contacts.merge.count.opportunities": "{count} deals",
    "contacts.merge.count.opportunities.es": "{count} oportunidades",
    "contacts.merge.count.opportunitiesOne": "1 deal",
    "contacts.merge.count.opportunitiesOne.es": "1 oportunidad",
    "contacts.merge.count.notes": "{count} notes",
    "contacts.merge.count.notes.es": "{count} notas",
    "contacts.merge.count.notesOne": "1 note",
    "contacts.merge.count.notesOne.es": "1 nota",
    "contacts.merge.count.tasks": "{count} to-dos",
    "contacts.merge.count.tasks.es": "{count} pendientes",
    "contacts.merge.count.tasksOne": "1 to-do",
    "contacts.merge.count.tasksOne.es": "1 pendiente",
    "contacts.merge.count.form_submissions": "{count} form answers",
    "contacts.merge.count.form_submissions.es": "{count} respuestas de formulario",
    "contacts.merge.count.form_submissionsOne": "1 form answer",
    "contacts.merge.count.form_submissionsOne.es": "1 respuesta de formulario",
    "contacts.merge.action": "Merge",
    "contacts.merge.action.es": "Unir",
    "contacts.merge.done": "Merged into {name}",
    "contacts.merge.done.es": "Se unió con {name}",
    "contacts.merge.stale": "One of these records changed while you were looking. Here it is again with the new details.",
    "contacts.merge.stale.es": "Uno de estos registros cambió mientras lo revisaba. Aquí está de nuevo con los datos nuevos.",
    "contacts.merge.failed": "Couldn't merge. Nothing changed. Try again.",
    "contacts.merge.failed.es": "No se pudo unir. No cambió nada. Intente de nuevo.",
    "contacts.merge.loadFailed": "Couldn't load these two records. Try again.",
    "contacts.merge.loadFailed.es": "No se pudieron cargar estos dos registros. Intente de nuevo.",
    "contacts.merge.undone": "Merge undone. {name} is back as their own record.",
    "contacts.merge.undone.es": "Se deshizo la unión. {name} volvió a tener su propio registro.",
    "contacts.merge.undoneKept": "{count} things that arrived after the merge stay with {name}.",
    "contacts.merge.undoneKept.es": "{count} cosas que llegaron después de la unión se quedan con {name}.",
    "contacts.merge.undoneKeptOne": "1 thing that arrived after the merge stays with {name}.",
    "contacts.merge.undoneKeptOne.es": "1 cosa que llegó después de la unión se queda con {name}.",
    "contacts.merge.undoneEdits": "Kept what was changed after the merge: {list}.",
    "contacts.merge.undoneEdits.es": "Se conservó lo que se cambió después de la unión: {list}.",
    "contacts.merge.undoExpired": "This merge is more than 30 days old and can't be undone.",
    "contacts.merge.undoExpired.es": "Esta unión tiene más de 30 días y ya no se puede deshacer.",
    "contacts.merge.undoLater":
      "This merge can't be undone yet: {name} was merged again since. Undo the newer merge first.",
    "contacts.merge.undoLater.es":
      "Esta unión todavía no se puede deshacer: {name} se volvió a unir después. Deshaga primero la unión más reciente.",
    "contacts.merge.undoFailed": "Couldn't undo the merge. Nothing changed. Try again.",
    "contacts.merge.undoFailed.es": "No se pudo deshacer la unión. No cambió nada. Intente de nuevo.",
    "timeline.merged": "merged {name} into this record: {list} moved here",
    "timeline.merged.es": "unió a {name} con este registro: {list} pasaron aquí",
    "timeline.mergedEmpty": "merged {name} into this record",
    "timeline.mergedEmpty.es": "unió a {name} con este registro",
    "timeline.mergeUndone": "undid the merge with {name}",
    "timeline.mergeUndone.es": "deshizo la unión con {name}",
    "timeline.undoMerge": "Undo merge",
    "timeline.undoMerge.es": "Deshacer unión",
    "timeline.mergeOtherHidden": "another record",
    "timeline.mergeOtherHidden.es": "otro registro",
    "timeline.what.merge": "merge history",
    "timeline.what.merge.es": "historial de uniones",
  };

  it("has every key with exactly this text (mutation: write 'Une' into contacts.merge.action.es → FAILS naming it)", () => {
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

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve' in contacts.merge.failed.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  // The toast's own Undo action is common.undo ("Undo") — these new strings describe the merge
  // and its reversal in prose, never re-mint that button as a word dropped mid-sentence (which
  // would read as a stray capital). A short label naming a SPECIFIC action ("Undo merge", the
  // timeline row's own link once the toast is long gone) or a sentence-initial imperative
  // ("Undo the newer merge first.") are both fine; "Undo" is only wrong capitalized after a
  // lower-case word with no sentence break before it.
  it("no copy says 'survivor', 'loser', draws an arrow, leaks template syntax, or drops a stray capitalized 'Undo' mid-sentence (mutation: write 'you can Undo this' into contacts.merge.undone → FAILS)", () => {
    const MIDSENTENCE_UNDO = /[a-z,:]\s+Undo\b/;
    for (const [k, v] of Object.entries(WANT)) {
      expect(v.includes("survivor"), k).toBe(false);
      expect(v.includes("loser"), k).toBe(false);
      expect(v.includes("→"), k).toBe(false);
      expect(v.includes("{{"), k).toBe(false);
      expect(MIDSENTENCE_UNDO.test(v), k).toBe(false);
    }
  });
});

describe("F-046 part 1: the agenda and job copy, English and Spanish (plan Task 2)", () => {
  const WANT: Record<string, string> = {
    "calendar.agenda.title": "Schedule",
    "calendar.agenda.title.es": "Agenda",
    "calendar.agenda.day": "Day",
    "calendar.agenda.day.es": "Día",
    "calendar.agenda.week": "Week",
    "calendar.agenda.week.es": "Semana",
    "calendar.agenda.viewLabel": "Schedule view",
    "calendar.agenda.viewLabel.es": "Vista de la agenda",
    "calendar.agenda.back": "Back",
    "calendar.agenda.back.es": "Anterior",
    "calendar.agenda.today": "Today",
    "calendar.agenda.today.es": "Hoy",
    "calendar.agenda.next": "Next",
    "calendar.agenda.next.es": "Siguiente",
    "calendar.agenda.daysLabel": "Days of this week",
    "calendar.agenda.daysLabel.es": "Días de esta semana",
    "calendar.agenda.addJob": "Add job",
    "calendar.agenda.addJob.es": "Agregar trabajo",
    "calendar.agenda.addAt": "Add job at {time}",
    "calendar.agenda.addAt.es": "Agregar trabajo a las {time}",
    "calendar.agenda.emptyTitle": "Nothing booked on {day}.",
    "calendar.agenda.emptyTitle.es": "No hay nada agendado para el {day}.",
    "calendar.agenda.emptyBody": "Jobs you add and bookings customers make show here. Add the first one.",
    "calendar.agenda.emptyBody.es":
      "Aquí aparecen los trabajos que usted agrega y las citas que hacen sus clientes. Agregue el primero.",
    "calendar.agenda.emptyTechnician": "None of your customers have a job on {day}.",
    "calendar.agenda.emptyTechnician.es": "Ninguno de sus clientes tiene trabajo el {day}.",
    "calendar.agenda.error": "Couldn't load your schedule.",
    "calendar.agenda.error.es": "No se pudo cargar su agenda.",
    "calendar.agenda.retry": "Try again",
    "calendar.agenda.retry.es": "Intentar de nuevo",
    "calendar.agenda.closed": "Closed · {reason}",
    "calendar.agenda.closed.es": "Cerrado · {reason}",
    "calendar.agenda.closedPlain": "Closed",
    "calendar.agenda.closedPlain.es": "Cerrado",
    "calendar.agenda.outsideHours": "Outside open hours",
    "calendar.agenda.outsideHours.es": "Fuera del horario",
    "calendar.agenda.overlaps": "Overlaps",
    "calendar.agenda.overlaps.es": "Se empalma",
    "calendar.agenda.addedBy": "Added by {name}",
    "calendar.agenda.addedBy.es": "Agregado por {name}",
    "calendar.agenda.addedByYou": "Added by you",
    "calendar.agenda.addedByYou.es": "Agregado por usted",
    "calendar.agenda.bookedOnline": "Booked online",
    "calendar.agenda.bookedOnline.es": "Reservada en línea",
    "calendar.agenda.bookedBy": "Booked by {persona}",
    "calendar.agenda.bookedBy.es": "Agendada por {persona}",
    "calendar.agenda.pastOpen": "{count} past jobs still need Completed or No-show · To do",
    "calendar.agenda.pastOpen.es": "{count} trabajos pasados aún necesitan Terminado o No llegó · Pendientes",
    "calendar.agenda.pastOpenOne": "1 past job still needs Completed or No-show · To do",
    "calendar.agenda.pastOpenOne.es": "1 trabajo pasado aún necesita Terminado o No llegó · Pendientes",
    "calendar.agenda.truncated": "Only the first {cap} jobs are shown here. Open a single day to see them all.",
    "calendar.agenda.truncated.es": "Aquí solo se muestran los primeros {cap} trabajos. Abra un solo día para verlos todos.",
    "calendar.job.titleAdd": "Add a job",
    "calendar.job.titleAdd.es": "Agregar un trabajo",
    "calendar.job.titleMove": "Move this job",
    "calendar.job.titleMove.es": "Cambiar el horario de este trabajo",
    "calendar.job.customer": "Customer",
    "calendar.job.customer.es": "Cliente",
    "calendar.job.search": "Search by name or phone",
    "calendar.job.search.es": "Busque por nombre o teléfono",
    "calendar.job.newCustomer": "New customer",
    "calendar.job.newCustomer.es": "Cliente nuevo",
    "calendar.job.name": "Name",
    "calendar.job.name.es": "Nombre",
    "calendar.job.phone": "Phone",
    "calendar.job.phone.es": "Teléfono",
    "calendar.job.phoneOwner": "{name} already has this number. Use {first}?",
    "calendar.job.phoneOwner.es": "{name} ya tiene este número. ¿Usar a {first}?",
    "calendar.job.useExisting": "Use {first}",
    "calendar.job.useExisting.es": "Usar a {first}",
    "calendar.job.addAsNew": "Add as new",
    "calendar.job.addAsNew.es": "Agregar como nuevo",
    "calendar.job.customerFallback": "the customer",
    "calendar.job.customerFallback.es": "el cliente",
    "calendar.job.date": "Date",
    "calendar.job.date.es": "Fecha",
    "calendar.job.start": "Starts",
    "calendar.job.start.es": "Empieza",
    "calendar.job.length": "How long",
    "calendar.job.length.es": "Duración",
    "calendar.job.minutes": "{minutes} min",
    "calendar.job.minutes.es": "{minutes} min",
    "calendar.job.what": "What's the job?",
    "calendar.job.what.es": "¿Qué trabajo es?",
    "calendar.job.whatHint": "Fix a leaking water heater",
    "calendar.job.whatHint.es": "Arreglar un calentador que gotea",
    "calendar.job.address": "Address",
    "calendar.job.address.es": "Dirección",
    "calendar.job.noAddress": "No address",
    "calendar.job.noAddress.es": "Sin dirección",
    "calendar.job.newAddress": "New address",
    "calendar.job.newAddress.es": "Dirección nueva",
    "calendar.job.meet": "How you'll meet",
    "calendar.job.meet.es": "Cómo se verán",
    "calendar.job.inPerson": "In person",
    "calendar.job.inPerson.es": "En persona",
    "calendar.job.byPhone": "Phone",
    "calendar.job.byPhone.es": "Por teléfono",
    "calendar.job.byVideo": "Video",
    "calendar.job.byVideo.es": "Por video",
    "calendar.job.sendConfirmation": "Send {first} a confirmation",
    "calendar.job.sendConfirmation.es": "Enviarle una confirmación a {first}",
    "calendar.job.sendMoved": "Email {first} the new time",
    "calendar.job.sendMoved.es": "Enviarle a {first} el nuevo horario por correo",
    "calendar.job.noEmail": "{first} has no email on file, so we can't send one.",
    "calendar.job.noEmail.es": "{first} no tiene correo registrado, así que no podemos enviarle uno.",
    "calendar.job.emailBlocked": "{first}'s email can't receive our emails.",
    "calendar.job.emailBlocked.es": "El correo de {first} no puede recibir nuestros mensajes.",
    "calendar.job.checkFirst": "Check before you save:",
    "calendar.job.checkFirst.es": "Revise antes de guardar:",
    "calendar.job.warn.outsideHours": "Outside your open hours",
    "calendar.job.warn.outsideHours.es": "Fuera de su horario",
    "calendar.job.warn.notice": "Sooner than your usual notice",
    "calendar.job.warn.notice.es": "Antes de su aviso habitual",
    "calendar.job.warn.closed": "You're closed that day",
    "calendar.job.warn.closed.es": "Ese día está cerrado",
    "calendar.job.warn.overlaps": "Overlaps {count} jobs",
    "calendar.job.warn.overlaps.es": "Se empalma con {count} trabajos",
    "calendar.job.warn.overlapsOne": "Overlaps a job at {time}",
    "calendar.job.warn.overlapsOne.es": "Se empalma con un trabajo a las {time}",
    "calendar.job.warn.noVideo": "Video calls aren't set up, so this job won't have a link.",
    "calendar.job.warn.noVideo.es": "Las videollamadas no están configuradas, así que este trabajo no tendrá enlace.",
    "calendar.job.past": "That time has already passed. Pick a time from now on.",
    "calendar.job.past.es": "Esa hora ya pasó. Elija una hora de ahora en adelante.",
    "calendar.job.noSuchTime": "That time doesn't exist that day because the clocks change. Pick another.",
    "calendar.job.noSuchTime.es": "Esa hora no existe ese día porque cambia el horario. Elija otra.",
    "calendar.job.changed": "Something changed while you were looking. Check the notes and save again.",
    "calendar.job.changed.es": "Algo cambió mientras revisaba. Revise los avisos y guarde de nuevo.",
    "calendar.job.save": "Add job",
    "calendar.job.save.es": "Agregar trabajo",
    "calendar.job.saveMove": "Save new time",
    "calendar.job.saveMove.es": "Guardar nuevo horario",
    "calendar.job.saveAnyway": "Add it anyway",
    "calendar.job.saveAnyway.es": "Agregarlo de todos modos",
    "calendar.job.moveAnyway": "Move it anyway",
    "calendar.job.moveAnyway.es": "Cambiarlo de todos modos",
    "calendar.job.saveFailed": "Couldn't save this job. Nothing changed. Try again.",
    "calendar.job.saveFailed.es": "No se pudo guardar este trabajo. No cambió nada. Intente de nuevo.",
    "calendar.job.added": "Job added for {first}, {when}. We'll email the confirmation when this closes.",
    "calendar.job.added.es":
      "Trabajo agregado para {first}, {when}. Le enviaremos la confirmación cuando se cierre este aviso.",
    "calendar.job.addedQuiet": "Job added for {first}, {when}.",
    "calendar.job.addedQuiet.es": "Trabajo agregado para {first}, {when}.",
    "calendar.job.undo": "Undo",
    "calendar.job.undo.es": "Deshacer",
    "calendar.job.undone": "Job removed. {first} wasn't told.",
    "calendar.job.undone.es": "Trabajo eliminado. No se le avisó a {first}.",
    "calendar.job.undoTooLate": "Too late to undo: the confirmation already went to {first}. Cancel the job instead.",
    "calendar.job.undoTooLate.es":
      "Ya es tarde para deshacer: la confirmación ya le llegó a {first}. Mejor cancele el trabajo.",
    "calendar.job.undoMovedSince": "This job was moved since, so it can't be undone from here.",
    "calendar.job.undoMovedSince.es":
      "Este trabajo se cambió de horario después, así que no se puede deshacer desde aquí.",
    "calendar.job.moved": "Moved to {when}. We'll email {first} when this closes.",
    "calendar.job.moved.es": "Se cambió a {when}. Le enviaremos un correo a {first} cuando se cierre este aviso.",
    "calendar.job.movedQuiet": "Moved to {when}.",
    "calendar.job.movedQuiet.es": "Se cambió a {when}.",
    "calendar.job.edited": "Job updated.",
    "calendar.job.edited.es": "Trabajo actualizado.",
    "calendar.job.moveUndone": "Back at {when}.",
    "calendar.job.moveUndone.es": "De vuelta: {when}.",
    "calendar.job.moveUndoTaken": "Another job took the old time, so it can't go back.",
    "calendar.job.moveUndoTaken.es": "Otro trabajo ocupó el horario anterior, así que no puede regresar.",
    "calendar.job.emailSent": "Confirmation emailed {time}",
    "calendar.job.emailSent.es": "Confirmación enviada {time}",
    "calendar.job.emailPending": "We'll email the confirmation in a few seconds",
    "calendar.job.emailPending.es": "Enviaremos la confirmación en unos segundos",
    "calendar.job.emailFailed": "Couldn't email the confirmation",
    "calendar.job.emailFailed.es": "No se pudo enviar la confirmación",
    "calendar.job.movedEmailSent": "New time emailed {time}",
    "calendar.job.movedEmailSent.es": "Nuevo horario enviado {time}",
    "calendar.job.movedEmailPending": "We'll email the new time in a few seconds",
    "calendar.job.movedEmailPending.es": "Enviaremos el nuevo horario en unos segundos",
    "calendar.job.movedEmailFailed": "Couldn't email the new time",
    "calendar.job.movedEmailFailed.es": "No se pudo enviar el nuevo horario",
    "calendar.job.openRecord": "Open record",
    "calendar.job.openRecord.es": "Abrir ficha",
    "calendar.job.gone": "This job isn't on the calendar any more.",
    "calendar.job.gone.es": "Este trabajo ya no está en la agenda.",
    // The twelve existing booking words the drawer reuses: English unchanged, Spanish added.
    "calendar.bookings.join": "Join",
    "calendar.bookings.join.es": "Unirse",
    "calendar.bookings.cancel": "Cancel",
    "calendar.bookings.cancel.es": "Cancelar",
    "calendar.bookings.markCompleted": "Mark completed",
    "calendar.bookings.markCompleted.es": "Marcar como terminado",
    "calendar.bookings.markNoShow": "No-show",
    "calendar.bookings.markNoShow.es": "No llegó",
    "calendar.bookings.statusUpdated": "Booking updated",
    "calendar.bookings.statusUpdated.es": "Cita actualizada",
    "calendar.bookings.cancelledToast": "Appointment cancelled. We haven't told the customer, so let them know.",
    "calendar.bookings.cancelledToast.es": "Cita cancelada. No le avisamos al cliente, así que avísele usted.",
    "calendar.bookings.restored": "Appointment is back on.",
    "calendar.bookings.restored.es": "La cita sigue en pie.",
    "calendar.bookings.restoreSlotTaken":
      "Someone else booked that time after you cancelled, so this appointment can't be put back.",
    "calendar.bookings.restoreSlotTaken.es":
      "Alguien más agendó ese horario después de que la canceló, así que esta cita no se puede restaurar.",
    "calendar.bookings.restoreRescheduled":
      "This appointment was moved to a new time, so the old one can't be put back.",
    "calendar.bookings.restoreRescheduled.es":
      "Esta cita se cambió a otro horario, así que la anterior no se puede restaurar.",
    "calendar.bookings.restoreNotOurs":
      "The customer cancelled this one themselves, by link or on a call, so it can't be put back from here.",
    "calendar.bookings.restoreNotOurs.es":
      "El cliente la canceló, por enlace o en una llamada, así que no se puede restaurar desde aquí.",
    "calendar.bookings.confirmed": "Confirmed by text",
    "calendar.bookings.confirmed.es": "Confirmó por mensaje",
    "calendar.bookings.confirmDeclined": "Asked for a different time",
    "calendar.bookings.confirmDeclined.es": "Pidió otro horario",
  };

  it("holds both tables of the plan: 88 new English keys and the 12 reused ones, each with its Spanish (positive control: the WANT is not empty or half-filled)", () => {
    const keys = Object.keys(WANT);
    expect(keys.filter((k) => !k.endsWith(".es")).length).toBe(100);
    expect(keys.filter((k) => k.endsWith(".es")).length).toBe(100);
    expect(keys.filter((k) => k.startsWith("calendar.bookings.") && !k.endsWith(".es")).length).toBe(12);
    for (const k of keys.filter((x) => !x.endsWith(".es"))) expect(WANT, k).toHaveProperty([`${k}.es`]);
  });

  it("has every key with exactly this text (mutation: write 'Agrega trabajo' into calendar.agenda.addJob.es → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("every English key has its .es twin on the very next line, the twelve reused booking words included (mutation: move calendar.job.save.es one line down → FAILS naming it)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es"))) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      // A long value wraps onto the line after its key; the twin follows the value's own line.
      const valueLine = src[i]!.trimEnd().endsWith(":") ? i + 1 : i;
      expect(src[valueLine + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("every {count} key has its One twin, in both languages (mutation: drop calendar.job.warn.overlapsOne → FAILS)", () => {
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es") && WANT[x]!.includes("{count}"))) {
      expect(m, k).toHaveProperty([`${k}One`]);
      expect(m, k).toHaveProperty([`${k}One.es`]);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Revisa' in calendar.job.changed.es → FAILS)", () => {
    // "agrega" is NOT on this list: "los trabajos que usted agrega" is usted's own indicative.
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  it("no copy draws an arrow, leaks template syntax, says 'survivor', uses tú, or names the persona (it is always {persona}) (mutation: write 'Agendada por Sofía' into calendar.agenda.bookedBy.es → FAILS)", () => {
    for (const [k, v] of Object.entries(WANT)) {
      for (const bad of ["→", "{{", "survivor", "tú", " tu ", "Sofía"]) expect(v.includes(bad), `${k}: ${bad}`).toBe(false);
    }
  });
});

describe("the BIS access copy (F-118 part 1)", () => {
  const keys = Object.keys(m).filter((k) => k.startsWith("accessLog.") && !k.endsWith(".es"));
  it("exists, and every key has its Spanish twin (positive control: the family is not empty)", () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(m, k).toHaveProperty(`${k}.es`);
  });
  it("cites no milestone, no ticket, no template syntax and no arrow, in either language (mutation: put 'F-118' in accessLog.intro -> FAILS)", () => {
    for (const k of keys) for (const v of [m[k as keyof typeof m], m[`${k}.es` as keyof typeof m]]) {
      expect(v, k).not.toMatch(/\bM\d[a-z]?\b|F-\d{3}|\{\{|[←-⇿]/);
    }
  });
  it("every counted phrase has its singular twin, in both languages", () => {
    for (const base of ["accessLog.total", "accessLog.count.customers", "accessLog.count.groups", "accessLog.count.calls",
      "accessLog.count.conversations", "accessLog.count.files", "accessLog.count.forms", "accessLog.summary.downloads", "accessLog.item.export"]) {
      expect(m, base).toHaveProperty(`${base}One`);
      expect(m, base).toHaveProperty(`${base}One.es`);
    }
  });
  it("the Owner-facing promises are the spec's words (mutation: restore 'Nobody, at BIS or here' -> FAILS; drop the agency-lists sentence -> FAILS)", () => {
    expect(m["accessLog.intro"]).toContain("These entries can't be changed or deleted from BIS or from your account.");
    expect(m["accessLog.intro.es"]).toContain("Estas entradas no se pueden cambiar ni borrar desde BIS ni desde su cuenta.");
    expect(m["accessLog.note.agencyLists"]).toContain("open work, screened calls and phone numbers");
    expect(m["accessLog.note.agencyLists.es"]).toContain("el trabajo pendiente, las llamadas filtradas y los números de teléfono");
    expect(m["accessLog.enter.ended.es"]).toBe("Su última visita aquí terminó al cabo de 2 horas.");
    // Review I5 (orchestrator decision, consistent with ruling 2): lists are part of the visit, not listed one by one.
    expect(m["accessLog.note.lists"]).toBe("Lists inside your account, like your customers, inbox and calls, are part of the visit and aren't listed one by one.");
    expect(m["accessLog.note.lists.es"]).toBe("Las listas dentro de su cuenta, como sus clientes, la bandeja de entrada y las llamadas, forman parte de la visita y no aparecen una por una.");
  });
});
