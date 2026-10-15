import { describe, expect, it } from "vitest";
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
    "customerDocs.why.limit": ["That's a lot of files for one day. Try again tomorrow.", "Son muchos archivos para un día. Intente mañana."],
    "customerDocs.failed": ["Didn't upload. Try again.", "No se subió. Intente de nuevo."],
    "customerDocs.done": ["Thank you. {business} has everything it asked for.", "Gracias. {business} ya tiene todo lo que pidió."],
    "customerDocs.expired": ["This link has expired.", "Este enlace venció."],
    "customerDocs.revoked": ["This link is no longer active.", "Este enlace ya no está activo."],
    "customerDocs.notFound": ["This link doesn't work.", "Este enlace no funciona."],
    "customerDocs.ask": ["Ask {business} for a new link.", "Pida a {business} un enlace nuevo."],
    "customerDocs.call": ["Questions? Call {business} at {phone}.", "¿Preguntas? Llame a {business} al {phone}."],
    "customerDocs.callNoPhone": ["Questions? Contact {business}.", "¿Preguntas? Comuníquese con {business}."],
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
