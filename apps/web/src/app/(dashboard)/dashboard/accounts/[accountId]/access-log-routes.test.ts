import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * F-118 part 1 (spec 4.2; plan Task 11; review I2, I3). Every way into an account's records is classified:
 * the entry files of the two account trees, every exported server action in an account-scoped "use server"
 * file or in any "use server" file under src/ that calls a guard, every inline "use server" function under
 * src/ (final review M1), and every other file under app/ that calls a guard. A RECORD must call the one
 * logger in real code, in a shape that cannot fail open, handing it its own guard's answer (final review M2). Anything else states why it is not a record. A new file, action or
 * guarded file in no list fails BY NAME.
 *
 * Everything here reads the `typescript` AST, never a regex over text: comments are trivia and never
 * become nodes, so a logger or a guard named only in a comment or a string cannot satisfy a rule
 * (lib/documents/read-gate.test.ts's walker).
 */
const SRC = join(__dirname, "../../../../..");                 // apps/web/src
const A = "app/(dashboard)/dashboard/accounts/[accountId]";
const API = "app/api/accounts/[accountId]";
const ENTRY_ROOTS = [A, "app/api/accounts"];
const ACTION_ROOTS = [A, "lib"];
const ENTRY_RE = /^(page|route|layout|template|default)\.[jt]sx?$/;
const GUARDS = new Set(["requireAccountAccess", "requireAccountOwner", "requireAgencyOnlyAccountAccess", "requireNotTechnician", "apiAccountAccess"]);
const AUTH = "lib/auth.ts";
/** The cases that read every app source file: gate.test.ts's budget, since beside the whole suite they run slower than alone. */
const WHOLE_TREE = 30_000;
const rel = (p: string, base = SRC) => relative(base, p).split(sep).join("/");
/** A finding's line with the src prefix dropped (the parser reports forward-slash file names). */
const short = (line: string) => line.replace(`${SRC.split(sep).join("/")}/`, "");

/* ---------- the lists ---------- */

const RECORD: Record<string, "noteOpened" | "noteOpenedApi"> = {
  [`${A}/contacts/[contactId]/page.tsx`]: "noteOpened",
  [`${A}/groups/[groupId]/page.tsx`]: "noteOpened",
  [`${A}/calls/[callId]/page.tsx`]: "noteOpened",
  [`${A}/conversations/page.tsx`]: "noteOpened",
  [`${A}/forms/[formId]/page.tsx`]: "noteOpened",
  // F-006 part 1 (plan Task 10/13, F-118 reconcile; spec §9): the compare screen shows two customers at
  // once, so it notes both — after both are proven (not missing, not holding, not a tombstone) and
  // before any markup returns, same shape as contacts/[contactId]/page.tsx's own call.
  [`${A}/contacts/merge/page.tsx`]: "noteOpened",
  // F-046 part 1 (spec 8.2): the agenda is a list; opening a job's drawer (`?job=`) shows its customer's name, phone
  // and address, so the page notes that customer, after the job is read on the caller's own client.
  [`${A}/calendar/page.tsx`]: "noteOpened",
  [`${A}/contacts/export/route.ts`]: "noteOpenedApi",   // review m5: a 409, never a redirect, on a download
  ...Object.fromEntries(["ai-summary", "document-requests", "document-requirements", "documents", "email", "groups", "places",
    "relationships", "summary", "texts"].map((r) => [`${API}/contacts/[contactId]/${r}/route.ts`, "noteOpenedApi" as const])),
  ...Object.fromEntries(["document-requests", "documents", "places"].map((r) => [`${API}/groups/[groupId]/${r}/route.ts`, "noteOpenedApi" as const])),
};
const LIST = "a list (owner ruling 2)";
const SETTINGS = "settings";
const NOT_A_RECORD: Record<string, string> = {
  [`${A}/layout.tsx`]: "the account's chrome (name, language, billing banner); the gate runs here too",
  [`${A}/activity/page.tsx`]: LIST, [`${A}/calls/page.tsx`]: LIST,
  [`${A}/contacts/page.tsx`]: `${LIST}; its drawer's routes are records`, [`${A}/forms/page.tsx`]: LIST,
  [`${A}/pipeline/page.tsx`]: LIST, [`${A}/tasks/page.tsx`]: LIST,
  [`${A}/documents/page.tsx`]: `${LIST}; opening a file is logged by getDocumentUrlAction`,
  [`${A}/automations/page.tsx`]: SETTINGS, [`${A}/billing/page.tsx`]: SETTINGS, [`${A}/branding/page.tsx`]: SETTINGS,
  [`${A}/settings/page.tsx`]: SETTINGS, [`${A}/setup/page.tsx`]: SETTINGS, [`${A}/voice/page.tsx`]: SETTINGS,
  [`${A}/website/page.tsx`]: SETTINGS,
  [`${A}/team/page.tsx`]: `${SETTINGS}; the BIS access section lives here`,
  [`${A}/checklist/page.tsx`]: "agency work about the client, not a client record",
  [`${A}/contacts/import/page.tsx`]: "writes rows; shows no stored record",
  [`${A}/dashboard/page.tsx`]: "totals",
  [`${A}/voice/knowledge/[version]/page.tsx`]: "the business's own facts, not a customer's",
  [`${API}/search/route.ts`]: "returns names like a list; opening a result opens a logged record",
  // The agency refresh loop (2026-10-30): the shell's badges moved off a server action onto this GET.
  [`${API}/shell/route.ts`]: "the shell's counts and status (a list read inside the visit); no record",
};

const RECORD_ACTIONS: Record<string, "noteOpened"> = {
  [`${A}/contacts/documents-actions.ts#getDocumentUrlAction`]: "noteOpened",
  [`${A}/contacts/document-shares-actions.ts#createDocumentShareAction`]: "noteOpened",   // review I1
};
const W = "a write; its reads prove the target and return nothing a logged page has not already shown";
const AG = "agency settings (requireAgency or requireAgencyOnlyAccountAccess); no customer record";
const CFG = "the account's or a person's configuration; no customer record";
const FIND = "returns names or counts like a list (owner ruling 2); opening a result opens a logged record";
const each = (file: string, names: string[], why: string) => Object.fromEntries(names.map((n) => [`${file}#${n}`, why]));
const NOT_A_RECORD_ACTIONS: Record<string, string> = {
  ...each(`${A}/automations/actions.ts`, ["saveReviewRequestAction", "saveNoShowNudgeAction", "saveReferralAskAction",
    "saveReactivationAction", "saveQuoteFollowupAction", "saveSmsReminderAction", "saveAppointmentConfirmAction", "saveInstantReplyAction"], AG),
  ...each(`${A}/billing/actions.ts`, ["openBillingPortalAction"], "the Stripe portal; no customer record"),
  ...each(`${A}/branding/actions.ts`, ["setBrandingAction", "removeBrandLogoAction", "restoreBrandLogoAction"], CFG),
  ...each(`${A}/business-status-actions.ts`, ["setBusinessStatusAction", "undoBusinessStatusAction"], CFG),
  ...each(`${A}/calendar/actions.ts`, ["updateCalendarSettingsAction"], CFG),
  ...each(`${A}/calendar/actions.ts`, ["setBookingStatusAction", "cancelBookingAction", "keepAppointmentAction", "undoCancelBookingAction"], W),
  ...each(`${A}/calendar/actions.ts`, ["cancelNoticeOptionAction"], "Cancel's notice check, from the calendar (a list, owner ruling 2)"),
  ...each(`${A}/calendar/agenda-actions.ts`, ["addJobAction", "undoAddJobAction", "moveJobAction", "undoMoveJobAction", "undoEditJobAction"], W),
  ...each(`${A}/calendar/agenda-actions.ts`, ["jobNoticeOptionAction"], "the Add job sheet's notice check, from the calendar (a list, owner ruling 2)"),
  ...each(`${A}/calendar/closed-days-actions.ts`, ["addClosedDayAction", "removeClosedDayAction"], CFG),
  ...each(`${A}/calendar/feed-actions.ts`, ["makeFeedLinkAction", "replaceFeedLinkAction", "turnOffFeedLinkAction", "undoFeedLinkAction"], CFG),
  ...each(`${A}/checklist/actions.ts`, ["setChecklistItemAction", "setA2pRegistrationAction", "addChecklistItemAction"], AG),
  ...each(`${A}/contacts/[contactId]/actions.ts`, ["updateContactAction", "addTagAction", "removeTagAction", "addNoteAction", "addTaskAction", "completeTaskAction"], W),
  ...each(`${A}/contacts/[contactId]/forwarding-actions.ts`, ["getForwardingAddressAction"], "the record's forwarding address, on the record page that logged the customer"),
  ...each(`${A}/contacts/actions.ts`, ["createContactAction", "assignContactsAction", "undoAssignContactsAction", "setContactBusinessAction",
    "undoContactBusinessAction", "setContactLanguageAction", "restoreContactLanguageAction", "keepContactLanguageHintAction",
    "updateContactFieldAction", "bulkAddTagAction", "bulkRemoveTagAction", "bulkDeleteContactsAction", "setPhoneCountryAction",
    "undoPhoneCountryAction", "undoInlinePhoneEditAction"], W),
  ...each(`${A}/contacts/actions.ts`, ["countContactDocumentsAction"], FIND),
  ...each(`${A}/contacts/archive-actions.ts`, ["archiveContactsAction", "restoreContactsAction"], W),
  ...each(`${A}/contacts/archive-actions.ts`, ["contactDeleteBlockersAction"], FIND),
  ...each(`${A}/contacts/document-requests-actions.ts`, ["createDocumentRequestAction", "revokeDocumentRequestAction", "undoRevokeDocumentRequestAction"], W),
  ...each(`${A}/contacts/document-requests-actions.ts`, ["documentRequestLinkAction"], "the customer's upload link; returns no stored record content"),
  ...each(`${A}/contacts/document-requirements-actions.ts`, ["skipDocumentRequirementAction", "undoSkipDocumentRequirementAction",
    "unskipDocumentRequirementAction", "undoUnskipDocumentRequirementAction"], W),
  ...each(`${A}/contacts/document-shares-actions.ts`, ["stopSharingAction", "undoStopSharingAction"], W),
  ...each(`${A}/contacts/documents-actions.ts`, ["startDocumentUploadAction", "startDocumentVersionUploadAction", "finishDocumentUploadAction",
    "abandonDocumentUploadAction", "updateDocumentFieldAction", "undoDocumentFieldAction", "setOwnersOnlyAction", "undoOwnersOnlyAction",
    "trashDocumentAction", "restoreDocumentAction", "purgeDocumentAction"], W),
  ...each(`${A}/contacts/email-actions.ts`, ["stopEmailsAction", "undoStopEmailsAction", "resumeEmailsAction"], W),
  ...each(`${A}/contacts/groups-actions.ts`, ["createGroupAction", "addToGroupAction", "setRoleAction", "setBillingAction", "makePrimaryAction",
    "removeMembershipAction", "restoreMembershipAction", "renameGroupAction", "setBillingAddressAction", "setGroupPrimaryContactAction"], W),
  ...each(`${A}/contacts/groups-actions.ts`, ["searchGroupsAction"], FIND),
  ...each(`${A}/contacts/import/actions.ts`, ["importContactsBatchAction"], W),
  // F-006 part 1 (plan Task 10/13): merge, undo and dismiss/undismiss a possible-duplicate pair are
  // writes, each logged in contact_merges (merge/undo) or contact_duplicate_flags (dismiss/undismiss);
  // none of them opens a customer record for the agency to look at.
  ...each(`${A}/contacts/merge-actions.ts`, ["mergeContactsAction", "undoMergeAction", "dismissPairAction", "undismissPairAction"],
    "a write, logged in contact_merges (merge/undo) or contact_duplicate_flags (dismiss); opens nothing"),
  ...each(`${A}/contacts/places-actions.ts`, ["addPlaceAction", "updatePlaceFieldAction", "setPlaceOwnerAction", "removePlaceAction",
    "undoRemovePlaceAction", "setPlaceArchivedAction", "addEquipmentAction", "replaceEquipmentAction", "updateEquipmentFieldAction",
    "removeEquipmentAction", "undoRemoveEquipmentAction"], W),
  ...each(`${A}/contacts/relationship-actions.ts`, ["addRelationshipAction", "setRelationshipAction", "undoSetRelationshipAction",
    "removeRelationshipAction", "undoRemoveRelationshipAction"], W),
  ...each(`${A}/contacts/relationship-actions.ts`, ["searchRelatableContactsAction"], FIND),
  ...each(`${A}/contacts/texts-actions.ts`, ["stopTextsAction", "undoStopTextsAction", "resumeTextsAction", "confirmStopAction",
    "notAStopAction", "undoHoldDecisionAction"], W),
  ...each(`${A}/conversations/actions.ts`, ["sendEmailAction", "sendSmsAction", "moveHoldingThreadAction", "undoMoveHoldingThreadAction"], W),
  ...each(`${A}/conversations/actions.ts`, ["markConversationReadAction"], "read state on a thread whose page logged it"),
  ...each(`${A}/conversations/inbound-actions.ts`, ["undoReplyStopAction", "stopEmailsFromReplyAction", "fileHeldEmailAction",
    "dismissHeldEmailAction", "undoHeldEmailAction"], W),
  ...each(`${A}/documents/required-documents-actions.ts`, ["undoRequiredDocumentsAction"], CFG),
  ...each(`${A}/forms/actions.ts`, ["createFormAction", "saveFormAction", "republishFormAction"], "the form's own settings; its answers are the logged page"),
  ...each(`${A}/never-log-actions.ts`, ["addNeverLogAction", "removeNeverLogAction"], CFG),
  ...each(`${A}/pipeline/actions.ts`, ["createOpportunityAction", "moveOppToStageAction", "updateOpportunityAction"], W),
  ...each(`${A}/settings/actions.ts`, ["createFieldAction", "setClientAccessAction", "setFromEmailAction", "setReportEmailsAction",
    "setAccountLanguageAction", "setAlertPhoneAction", "startAlertPhoneVerificationAction", "confirmAlertPhoneVerificationAction",
    "setInboundModeAction", "checkInboundDnsAction"], AG),
  ...each(`${A}/settings/actions.ts`, ["upsertValueAction"], W),
  ...each(`${A}/settings/ai-actions.ts`, ["saveAccountAiAction", "undoAccountAiAction", "setGlobalAiAction"], AG),
  // Spec 3.1 (review m11): requireAgency() alone, not behind the visit; billing configuration only.
  ...each(`${A}/settings/billing-actions.ts`, ["sendBillingLinkAction", "markComplimentaryAction", "removeComplimentaryAction",
    "liftPauseAction", "undoLiftPauseAction", "changePlanAction"], AG),
  ...each(`${A}/settings/document-requirements-actions.ts`, ["setRequiredDocumentCategoriesAction"], CFG),
  ...each(`${A}/settings/trade-actions.ts`, ["setTradeAction"], AG),
  ...each(`${A}/setup/actions.ts`, ["setSetupTickAction", "goLiveAction", "renameAccountAction"], AG),
  ...each(`${A}/tasks/actions.ts`, ["completeWorkTask", "reopenWorkTask", "dismissToTask", "closeOutBooking", "confirmStopFromTask",
    "notAStopFromTask", "undoHoldDecisionFromTask", "setTaskAssigneeAction"], W),
  ...each(`${A}/team/actions.ts`, ["inviteTeamMemberAction", "setTeamRoleAction", "setTeamLanguageAction", "removeTeamMemberAction",
    "undoRemoveTeamMemberAction", "revokeTeamInvitationAction", "undoRevokeTeamInvitationAction"], "the team, not customers"),
  ...each(`${A}/voice/actions.ts`, ["saveVoiceProfileAction", "saveBusinessHoursAction", "saveServicesAction", "assignNumberAction",
    "moveNumberAction", "setNumberStatusAction", "setTransferPhoneAction", "enableConciergeAction", "disableConciergeAction", "setForwardCallsAction"], AG),
  ...each(`${A}/website/actions.ts`, ["saveSiteAction", "unlinkSiteAction", "testSiteConnectionAction"], AG),
  ...each("lib/ai-acts/actions.ts", ["undoAiActAction", "redoAiFieldFillAction"], W),
  ...each("lib/proposals/actions.ts", ["acceptSuggestionAction", "editAcceptSuggestionAction", "discardSuggestionAction", "undoSuggestionAction"],
    `${W}; from /dashboard/work these run with no visit (owner ruling 3, plan C11)`),
  // Spec 3.1 (review m11): captureBlueprintAction is requireAgency() alone and copies configuration.
  ...each("app/(dashboard)/dashboard/blueprints/actions.ts", ["captureBlueprintAction", "applyBlueprintAction"], AG),
  // Final review M1: an inline "use server" function is an action too. The styleguide's billing specimen
  // answers its own failure sentence and reads nothing.
  "app/(dashboard)/dashboard/styleguide/page.tsx#styleguidePortalFailed": "the styleguide's specimen; reads and writes nothing",
};
const OTHER_GUARDED: Record<string, string> = {
  [`${A}/settings/ai-section.tsx`]: "the Settings page's AI card, after Settings' own guard; agency settings",
};

/* ---------- the AST helpers ---------- */

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, keep, out); }
    else if (keep(e.name)) out.push(p);
  }
  return out;
}
const isSource = (n: string) => /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n);
const parsed = new Map<string, ts.SourceFile>();
const parse = (p: string) => {
  let sf = parsed.get(p);
  if (!sf) {
    sf = ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    parsed.set(p, sf);
  }
  return sf;
};
/** Every real call to `name` (an identifier callee) under `node`. One walk per node, indexed by callee name:
 *  the whole-tree cases ask the same ~2,000 files for six names, and six walks each ran close to vitest's
 *  default timeout beside the rest of the suite. */
const callIndex = new WeakMap<ts.Node, Map<string, ts.CallExpression[]>>();
function calls(node: ts.Node, name: string): readonly ts.CallExpression[] {
  let index = callIndex.get(node);
  if (!index) {
    const idx = new Map<string, ts.CallExpression[]>();
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const list = idx.get(n.expression.text);
        if (list) list.push(n); else idx.set(n.expression.text, [n]);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    callIndex.set(node, (index = idx));
  }
  return index.get(name) ?? [];
}
const callsAny = (node: ts.Node, names: ReadonlySet<string>) => [...names].some((n) => calls(node, n).length > 0);
const importsFrom = (sf: ts.SourceFile) => sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
const isUseServer = (sf: ts.SourceFile) => {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
};
const hasModifier = (s: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === kind);
/** The names a binding pattern (`export const { a, b: [c] } = …`) declares. */
const boundNames = (n: ts.BindingName): string[] => (ts.isIdentifier(n) ? [n.text]
  : n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : boundNames(e.name))));
/**
 * Review r2: every exported VALUE binding of a file, because Next makes every one of them a server action
 * in a "use server" file: `export (async) function f`, `export const f = <anything>` (a wrapped
 * `wrap(async …)` included), `export { f }` and `export { f as g }` (keyed by the EXPORTED name, its node the
 * LOCAL declaration's, so a record action written that way is still read for its note), `export default …`
 * (keyed `default`) and `export * from …` (keyed `*`: it cannot be enumerated here, so it is refused by being
 * in no list). Types and interfaces are not values and are skipped, `export { type T }` included; an overload
 * signature (no body) is not a second action.
 */
function exportedBindings(sf: ts.SourceFile): { name: string; node: ts.Node }[] {
  const locals = new Map<string, ts.Node | "type">();
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name && !(ts.isFunctionDeclaration(s) && !s.body)) locals.set(s.name.text, s);
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) for (const n of boundNames(d.name)) locals.set(n, d.initializer ?? d);
    if ((ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && !locals.has(s.name.text)) locals.set(s.name.text, "type");
  }
  const out: { name: string; node: ts.Node }[] = [];
  for (const s of sf.statements) {
    if (ts.isExportAssignment(s)) {
      const local = ts.isIdentifier(s.expression) ? locals.get(s.expression.text) : undefined;
      out.push({ name: "default", node: local && local !== "type" ? local : s.expression });
      continue;
    }
    if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      if (!s.exportClause) { out.push({ name: "*", node: s }); continue; }
      if (ts.isNamespaceExport(s.exportClause)) { out.push({ name: s.exportClause.name.text, node: s }); continue; }
      for (const el of s.exportClause.elements) {
        if (el.isTypeOnly) continue;
        const local = s.moduleSpecifier ? undefined : locals.get((el.propertyName ?? el.name).text);
        if (local === "type") continue;
        out.push({ name: el.name.text, node: local ?? el });
      }
      continue;
    }
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue;
    const name = hasModifier(s, ts.SyntaxKind.DefaultKeyword) ? "default" : null;
    if (ts.isFunctionDeclaration(s) && s.body) out.push({ name: name ?? s.name!.text, node: s });
    if (ts.isClassDeclaration(s)) out.push({ name: name ?? s.name!.text, node: s });
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
      for (const n of boundNames(d.name)) out.push({ name: n, node: d.initializer ?? d });
    }
  }
  return out;
}
const unwrap = (n: ts.Node): ts.Node => (ts.isParenthesizedExpression(n) ? unwrap(n.parent) : n);
const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
  || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isAccessor(n);
/** A function the module itself exports: a top-level exported (or default) function, or an exported top-level const's or default's own value. */
function isExportedFunction(fn: ts.FunctionLikeDeclaration): boolean {
  if (ts.isFunctionDeclaration(fn)) return ts.isSourceFile(fn.parent) && hasModifier(fn, ts.SyntaxKind.ExportKeyword);
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  const holder = unwrap(fn.parent);
  if (ts.isExportAssignment(holder)) return true;
  return ts.isVariableDeclaration(holder) && holder.initializer === fn && ts.isVariableStatement(holder.parent.parent)
    && ts.isSourceFile(holder.parent.parent.parent) && hasModifier(holder.parent.parent, ts.SyntaxKind.ExportKeyword);
}
/** A `return` that belongs to `node`'s own function (one inside a nested function returns from that one). */
function returnsHere(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found || isFunctionLike(n)) return;
    if (ts.isReturnStatement(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}
/** A top-level function's name: `function f` or `const f = (…) => …`; null for anything nested. */
function topLevelName(fn: ts.FunctionLikeDeclaration): ts.Identifier | null {
  if (ts.isFunctionDeclaration(fn)) return ts.isSourceFile(fn.parent) && fn.name ? fn.name : null;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const holder = unwrap(fn.parent);
  return ts.isVariableDeclaration(holder) && holder.initializer === fn && ts.isIdentifier(holder.name)
    && ts.isVariableStatement(holder.parent.parent) && ts.isSourceFile(holder.parent.parent.parent) ? holder.name : null;
}
/** Every other mention of `name` in the file (the declaration's own name excluded). */
function referencesTo(sf: ts.SourceFile, name: ts.Identifier): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n !== name && n.text === name.text) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/**
 * What makes an otherwise well-shaped call fail OPEN: it sits in a function a caller need not wait for,
 * or a `try` around it swallows its throw.
 * - The function holding it must be one the module exports (Next awaits those), or a top-level helper that
 *   is mentioned ONLY as the callee of a call that is awaited or returned (`return answer(req, ctx, false)`,
 *   the ai-summary route's GET and POST), each such call held to these same rules in its turn. An inner
 *   function, or a helper ever run as `void log()`, passed as a value or never called, is refused.
 * - Review r1: a catch must END in a `return` or a `throw` (a catch that logs and carries on, or rethrows
 *   only sometimes, lets the record open with no log), and a `finally` must never `return` (that discards
 *   the throw). A catch that returns hands back its own answer, never the record.
 */
function swallowed(call: ts.CallExpression, depth = 0): string | null {
  let child: ts.Node = call;
  for (let n = call.parent; ; child = n, n = n.parent) {
    if (ts.isSourceFile(n)) return "is not inside a function";
    if (isFunctionLike(n)) {
      if (isExportedFunction(n)) return null;
      const name = topLevelName(n);
      if (!name || depth > 4) return "is inside an inner function (a caller need not await it)";
      const refs = referencesTo(call.getSourceFile(), name);
      if (refs.length === 0) return `is inside ${name.text}, which nothing calls`;
      for (const r of refs) {
        const site = r.parent;
        const held = ts.isCallExpression(site) && site.expression === r ? unwrap(site.parent) : null;
        const waited = !!held && (ts.isAwaitExpression(held) || ts.isReturnStatement(held) || (ts.isArrowFunction(held) && held.body === site));
        if (!waited) return `is inside ${name.text}, which is used other than as an awaited or returned call`;
        const why = swallowed(site as ts.CallExpression, depth + 1);
        if (why) return `is inside ${name.text}, whose call ${why}`;
      }
      return null;
    }
    if (ts.isTryStatement(n) && child === n.tryBlock) {
      const last = n.catchClause?.block.statements.at(-1);
      if (n.catchClause && !(last && (ts.isReturnStatement(last) || ts.isThrowStatement(last)))) {
        return "is inside a try whose catch neither returns nor rethrows (review r1)";
      }
      if (n.finallyBlock && returnsHere(n.finallyBlock)) return "is inside a try whose finally returns (it discards the throw)";
    }
  }
}
/**
 * Review I3: a logger call a caller could skip is refused. noteOpened must be `await noteOpened(…)` as a
 * statement or in an expression, or an element of an array literal that is the argument of a `Promise.all`
 * call that is itself directly awaited. noteOpenedApi must be `if (!(await noteOpenedApi(…))) return …`.
 * Anything else (void, .catch, .then, an unawaited value, an un-negated if, a branch that does not return)
 * is reported with its line, and so is a well-shaped call that `swallowed` finds can still fail open.
 */
function badLoggerCalls(sf: ts.SourceFile): string[] {
  const bad: string[] = [];
  const at = (n: ts.Node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  for (const c of [...calls(sf, "noteOpened"), ...calls(sf, "noteOpenedApi")]) {
    const why = swallowed(c);
    if (why) bad.push(`${at(c)} ${(c.expression as ts.Identifier).text} ${why}`);
  }
  for (const c of calls(sf, "noteOpened")) {
    const p = unwrap(c.parent);
    const awaited = ts.isAwaitExpression(p);
    const inAll = ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && p.parent.arguments[0] === p
      && ts.isPropertyAccessExpression(p.parent.expression) && ts.isIdentifier(p.parent.expression.expression)
      && p.parent.expression.expression.text === "Promise" && p.parent.expression.name.text === "all"
      && ts.isAwaitExpression(unwrap(p.parent.parent));
    if (!awaited && !inAll) bad.push(`${at(c)} noteOpened is neither awaited nor in an awaited Promise.all`);
  }
  for (const c of calls(sf, "noteOpenedApi")) {
    const aw = unwrap(c.parent);
    const not = ts.isAwaitExpression(aw) ? unwrap(aw.parent) : null;
    const iff = not && ts.isPrefixUnaryExpression(not) && not.operator === ts.SyntaxKind.ExclamationToken ? unwrap(not.parent) : null;
    const ok = !!iff && ts.isIfStatement(iff) && !iff.elseStatement
      && (ts.isReturnStatement(iff.thenStatement)
        || (ts.isBlock(iff.thenStatement) && iff.thenStatement.statements.length > 0 && ts.isReturnStatement(iff.thenStatement.statements[0]!)));
    if (!ok) bad.push(`${at(c)} noteOpenedApi is not \`if (!(await noteOpenedApi(…))) return …\``);
  }
  return bad;
}
/**
 * Final review M2: the logger reads only `isAgency` from its first argument, so `noteOpened({ isAgency: false }, …)`
 * would type-check and skip the log for the agency. The first argument must therefore be an identifier declared
 * exactly once in the call's OWN function (not a parameter, not an outer function's, not shadowed in a block),
 * by a `const` whose initializer is a guard call or an awaited guard call.
 */
function badLoggerArgs(sf: ts.SourceFile): string[] {
  const bad: string[] = [];
  const at = (n: ts.Node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const ownFunction = (n: ts.Node): ts.FunctionLikeDeclaration | null => {
    for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) if (isFunctionLike(p)) return p;
    return null;
  };
  const isGuardResult = (init: ts.Expression | undefined): boolean => {
    let e: ts.Expression | undefined = init;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (e && ts.isAwaitExpression(e)) e = e.expression;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    return !!e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && GUARDS.has(e.expression.text);
  };
  for (const c of [...calls(sf, "noteOpened"), ...calls(sf, "noteOpenedApi")]) {
    const logger = (c.expression as ts.Identifier).text;
    const arg = c.arguments[0];
    const fn = ownFunction(c);
    if (!arg || !ts.isIdentifier(arg) || !fn) { bad.push(`${at(c)} ${logger}'s first argument is not a name bound to a guard's answer`); continue; }
    if (fn.parameters.some((p) => boundNames(p.name).includes(arg.text))) { bad.push(`${at(c)} ${logger}'s first argument is a parameter`); continue; }
    const decls: ts.VariableDeclaration[] = [];
    const visit = (n: ts.Node): void => {
      if (n !== fn && isFunctionLike(n)) return;
      if (ts.isVariableDeclaration(n) && boundNames(n.name).includes(arg.text)) decls.push(n);
      ts.forEachChild(n, visit);
    };
    visit(fn);
    const d = decls.length === 1 ? decls[0]! : null;
    const ok = !!d && ts.isIdentifier(d.name) && (d.parent.flags & ts.NodeFlags.Const) !== 0 && isGuardResult(d.initializer);
    if (!ok) bad.push(`${at(c)} ${logger}'s first argument \`${arg.text}\` is not one const, in this function, holding a guard call's answer`);
  }
  return bad;
}
const isLiteralValue = (n: ts.Expression) => ts.isStringLiteral(n) || ts.isNumericLiteral(n)
  || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword;
/**
 * T3 review m1: gate.test.ts pins the "not-required" STRING, which a template literal (`not-${"required"}`)
 * or forwarded options (`requireAccountAccess(id, opts)`) would dodge. So the CALL is pinned instead: outside
 * lib/auth.ts (which forwards on purpose, and is the guards' own home) every guard call has one argument, or
 * a second that is an object literal of plain `name: literal` properties (a quoted or bare name, a string,
 * number, boolean or null value; no spread, shorthand, computed name, method, template or variable). And a
 * guard is never reached any other way: its name appears only as a call's callee, in an unaliased import,
 * or in a type's `typeof`, so `import { … as gate }`, `auth.requireAccountAccess` and `const g = …` all fail.
 */
function badGuardCalls(sf: ts.SourceFile): string[] {
  const bad: string[] = [];
  const at = (n: ts.Node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && GUARDS.has(n.text)) {
      const p = n.parent;
      const callee = ts.isCallExpression(p) && p.expression === n;
      const plainImport = ts.isImportSpecifier(p) && p.name === n && !p.propertyName;
      const typeOnly = ts.isTypeQueryNode(p);
      if (!callee && !plainImport && !typeOnly) bad.push(`${at(n)} ${n.text} is reached other than by a direct call or a plain import`);
      if (callee) {
        const [, opts, ...rest] = p.arguments;
        const literal = !opts || (ts.isObjectLiteralExpression(opts) && opts.properties.every((q) => ts.isPropertyAssignment(q)
          && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name)) && isLiteralValue(q.initializer)));
        if (rest.length > 0 || !literal || p.arguments.some(ts.isSpreadElement)) bad.push(`${at(n)} ${n.text}'s options are not a literal object of literal values`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bad;
}

function unclassifiedEntries(base: string, roots: readonly string[], known: ReadonlySet<string>): string[] {
  return roots.flatMap((r) => walk(join(base, r), (n) => ENTRY_RE.test(n))).map((p) => rel(p, base)).filter((f) => !known.has(f)).sort();
}
function missingLogger(base: string, record: Readonly<Record<string, string>>): string[] {
  return Object.entries(record).filter(([f, fn]) => calls(parse(join(base, f)), fn).length === 0).map(([f]) => f).sort();
}
/** A function whose own body opens with the "use server" directive: Next makes it a server action wherever it sits. */
function startsWithUseServer(fn: ts.FunctionLikeDeclaration): boolean {
  const first = fn.body && ts.isBlock(fn.body) ? fn.body.statements[0] : undefined;
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}
/** Final review M1: every inline server action in a file, keyed by its own name, the const holding it, or its line. */
function inlineActions(sf: ts.SourceFile): { name: string; node: ts.Node }[] {
  const out: { name: string; node: ts.Node }[] = [];
  const visit = (n: ts.Node): void => {
    if (isFunctionLike(n) && startsWithUseServer(n)) {
      const holder = unwrap(n.parent);
      const name = (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name ? n.name.text
        : ts.isVariableDeclaration(holder) && holder.initializer === n && ts.isIdentifier(holder.name) ? holder.name.text
        : `<inline at line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}>`;
      out.push({ name, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/**
 * Every `file#action` in scope (final review M1: the whole of src/, not only app/ and lib/): the exported
 * bindings of "use server" files under `roots` or calling a guard anywhere, plus every inline "use server"
 * function anywhere (one already counted as an export is not counted twice).
 */
function actionKeys(base: string, roots: readonly string[] = ACTION_ROOTS): { key: string; node: ts.Node }[] {
  const sources = walk(base, isSource);
  const files = sources.filter((p) => isUseServer(parse(p)))
    .filter((p) => roots.some((r) => rel(p, base).startsWith(`${r}/`)) || callsAny(parse(p), GUARDS));
  const exported = files.flatMap((p) => exportedBindings(parse(p)).map((f) => ({ key: `${rel(p, base)}#${f.name}`, node: f.node })));
  const seen = new Set(exported.map((e) => e.node));
  const inline = sources.flatMap((p) => inlineActions(parse(p)).filter((f) => !seen.has(f.node))
    .map((f) => ({ key: `${rel(p, base)}#${f.name}`, node: f.node })));
  return [...exported, ...inline];
}

/* ---------- the cases ---------- */

describe("every entry file in the account trees is classified (spec 4.2 item 1)", () => {
  const known = new Set([...Object.keys(RECORD), ...Object.keys(NOT_A_RECORD)]);
  it("walks a real tree (positive control: more than 30 entry files, and it finds the account layout)", () => {
    const all = ENTRY_ROOTS.flatMap((r) => walk(join(SRC, r), (n) => ENTRY_RE.test(n))).map((p) => rel(p));
    expect(all.length).toBeGreaterThan(30);
    expect(all).toContain(`${A}/layout.tsx`);
  });
  it("no unclassified page, route, layout, template or default (mutation: add ACCT/zzprobe/page.tsx, or ACCT/zzprobe/layout.tsx -> FAILS naming it)", () => {
    expect(unclassifiedEntries(SRC, ENTRY_ROOTS, known)).toEqual([]);
  });
  it("no stale entry, and no file in both lists", () => {
    const now = new Set(ENTRY_ROOTS.flatMap((r) => walk(join(SRC, r), (n) => ENTRY_RE.test(n))).map((p) => rel(p)));
    expect([...known].filter((f) => !now.has(f))).toEqual([]);
    expect(Object.keys(RECORD).filter((f) => f in NOT_A_RECORD)).toEqual([]);
  });
  it("every record calls its logger in real code, imported from @/lib/access-log/note (mutation: delete noteOpened from calls/[callId]/page.tsx -> FAILS naming it)", () => {
    expect(missingLogger(SRC, RECORD)).toEqual([]);
    for (const f of Object.keys(RECORD)) expect(importsFrom(parse(join(SRC, f))), f).toContain("@/lib/access-log/note");
  });
  it("no not-a-record entry calls the logger (the list stays honest)", () => {
    for (const f of Object.keys(NOT_A_RECORD)) {
      const sf = parse(join(SRC, f));
      expect([...calls(sf, "noteOpened"), ...calls(sf, "noteOpenedApi")].length, f).toBe(0);
    }
  });
});

describe("every server action and every guarded file is classified (spec 4.2 item 4, review I2)", () => {
  const keys = actionKeys(SRC);
  it("enumerates a real set (positive control: more than 150 actions, getDocumentUrlAction among them)", () => {
    expect(keys.length).toBeGreaterThan(150);
    expect(keys.map((k) => k.key)).toContain(`${A}/contacts/documents-actions.ts#getDocumentUrlAction`);
  });
  it("no unclassified action (mutation: export a new async function from contacts/[contactId]/actions.ts -> FAILS naming it)", () => {
    const known = new Set([...Object.keys(RECORD_ACTIONS), ...Object.keys(NOT_A_RECORD_ACTIONS)]);
    expect(keys.map((k) => k.key).filter((k) => !known.has(k)).sort()).toEqual([]);
  });
  it("no stale action, and none in both lists", () => {
    const now = new Set(keys.map((k) => k.key));
    expect([...Object.keys(RECORD_ACTIONS), ...Object.keys(NOT_A_RECORD_ACTIONS)].filter((k) => !now.has(k))).toEqual([]);
    expect(Object.keys(RECORD_ACTIONS).filter((k) => k in NOT_A_RECORD_ACTIONS)).toEqual([]);
  });
  it("every record action calls noteOpened inside its own body; no other action does (mutation: delete the note from createDocumentShareAction -> FAILS)", () => {
    for (const { key, node } of keys) {
      const n = calls(node, "noteOpened").length;
      if (key in RECORD_ACTIONS) expect(n, key).toBeGreaterThan(0);
      else expect(n, key).toBe(0);
    }
  });
  it("every other file under app/ that calls a guard has a reason (mutation: call requireAccountAccess from a new app/ component -> FAILS naming it)", () => {
    const entries = new Set([...Object.keys(RECORD), ...Object.keys(NOT_A_RECORD)]);
    const actionFiles = new Set(keys.map((k) => k.key.split("#")[0]!));
    const guarded = walk(join(SRC, "app"), isSource).filter((p) => callsAny(parse(p), GUARDS)).map((p) => rel(p))
      .filter((f) => !entries.has(f) && !actionFiles.has(f));
    expect(guarded.sort()).toEqual(Object.keys(OTHER_GUARDED).sort());
  }, WHOLE_TREE);
});

describe("every logger call is unskippable (spec 4.2 item 5, review I3)", () => {
  it("no void, .catch, .then, unawaited, un-negated or non-returning logger call anywhere in the app (mutation: `void noteOpened(...)` on the call page, or `.catch(() => {})` on the contact page's -> FAILS naming the line)", () => {
    const users = walk(SRC, isSource).filter((p) => calls(parse(p), "noteOpened").length + calls(parse(p), "noteOpenedApi").length > 0);
    expect(users.length).toBeGreaterThan(15);   // positive control: it checked the real callers
    expect(users.flatMap((p) => badLoggerCalls(parse(p))).map(short)).toEqual([]);
  }, WHOLE_TREE);
});

describe("every logger call is handed its own guard's answer (final review M2)", () => {
  it("noteOpened / noteOpenedApi's first argument is a const bound in the same function to a guard call's result, never a literal or a value from elsewhere (mutation: `noteOpened({ isAgency: false }, …)` on the call page -> FAILS naming the line)", () => {
    const users = walk(SRC, isSource).filter((p) => calls(parse(p), "noteOpened").length + calls(parse(p), "noteOpenedApi").length > 0);
    expect(users.length).toBeGreaterThan(15);   // positive control: it checked the real callers
    expect(users.flatMap((p) => badLoggerArgs(parse(p))).map(short)).toEqual([]);
  }, WHOLE_TREE);
});

describe("the visit carve-out cannot be smuggled through a guard call (T3 review m1)", () => {
  const files = walk(SRC, isSource).map((p) => ({ p, f: rel(p) })).filter((x) => x.f !== AUTH);
  it("every guard call outside lib/auth.ts has one argument, or a second that is an object literal of literal values (mutations: forward `opts`, or pass `{ agencyVisit: `not-${\"required\"}` }` -> FAILS naming the line)", () => {
    const guardCalls = files.reduce((n, x) => n + [...GUARDS].reduce((m, g) => m + calls(parse(x.p), g).length, 0), 0);
    expect(guardCalls).toBeGreaterThan(100);   // positive control: it read the real callers
    expect(files.flatMap((x) => badGuardCalls(parse(x.p))).map(short)).toEqual([]);
  }, WHOLE_TREE);
  it("`agencyVisit` is named outside lib/auth.ts only once, in lib/proposals/actions.ts (mutation: pass it from contacts/[contactId]/page.tsx -> FAILS naming the file)", () => {
    const hits: Record<string, number> = {};
    for (const x of files) {
      const visit = (n: ts.Node): void => {
        if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === "agencyVisit") hits[x.f] = (hits[x.f] ?? 0) + 1;
        ts.forEachChild(n, visit);
      };
      visit(parse(x.p));
    }
    expect(hits).toEqual({ "lib/proposals/actions.ts": 1 });
  }, WHOLE_TREE);
});

describe("files: logged once really opening, before the URL leaves; shares logged before the token (spec 4.2 item 2)", () => {
  const fn = (file: string, name: string) => {
    const sf = parse(join(SRC, file));
    const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
    expect(f, name).toBeDefined();
    return f!;
  };
  it("getDocumentUrlAction: the mint, then the note, then the return that carries the URL (mutations: note before the mint -> FAILS; return the URL before the note -> FAILS)", () => {
    const f = fn(`${A}/contacts/documents-actions.ts`, "getDocumentUrlAction");
    const mint = calls(f, "signedDocumentReadUrl");
    const note = calls(f, "noteOpened");
    expect([mint.length, note.length]).toEqual([1, 1]);
    const urlReturns: number[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)
        && n.expression.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "url")) urlReturns.push(n.getStart());
      ts.forEachChild(n, visit);
    };
    visit(f);
    expect(urlReturns).toHaveLength(1);
    expect(mint[0]!.getStart()).toBeLessThan(note[0]!.getStart());
    expect(note[0]!.getStart()).toBeLessThan(urlReturns[0]!);
  });
  it("createDocumentShareAction: the note before newShareToken (mutation: move it after createDocumentShare -> FAILS)", () => {
    const f = fn(`${A}/contacts/document-shares-actions.ts`, "createDocumentShareAction");
    const note = calls(f, "noteOpened");
    const token = calls(f, "newShareToken");
    expect([note.length, token.length]).toEqual([1, 1]);
    expect(note[0]!.getStart()).toBeLessThan(token[0]!.getStart());
  });
  it("the read-URL mint has exactly two app callers: the file action and a customer's share link (mutation: call it from a third file -> FAILS)", () => {
    const callers = walk(SRC, isSource).filter((p) => calls(parse(p), "signedDocumentReadUrl").length > 0).map((p) => rel(p)).sort();
    expect(callers).toEqual([`${A}/contacts/documents-actions.ts`, "lib/document-shares/public-share.ts"]);
  }, WHOLE_TREE);
});

describe("who may reach the logger (spec 2.2, spec 4.2 item 3)", () => {
  const all = walk(SRC, isSource).map((p) => ({ f: rel(p), imports: importsFrom(parse(p)) }));
  it("the importers of @/lib/access-log/note are exactly the records and the two record actions' files (mutation: import it into lib/automations/fanout.ts -> FAILS)", () => {
    expect(all.filter((x) => x.imports.includes("@/lib/access-log/note")).map((x) => x.f).sort())
      .toEqual([...Object.keys(RECORD), `${A}/contacts/documents-actions.ts`, `${A}/contacts/document-shares-actions.ts`].sort());
  }, WHOLE_TREE);
  it("no public, cron, webhook or voice tree imports any access-log module", () => {
    const PUBLIC = ["app/api/cron/", "app/api/webhooks/", "app/api/voice/", "app/api/sms/", "app/api/concierge/", "app/api/d/",
      "app/api/s/", "app/api/unsubscribe/", "app/api/ops/", "app/b/", "app/c/", "app/f/", "app/u/", "app/d/", "app/s/", "app/cal/",
      "lib/automations/", "lib/voice/"];
    expect(all.filter((x) => PUBLIC.some((p) => x.f.startsWith(p)) && x.imports.some((i) => /access-log/.test(i))).map((x) => x.f)).toEqual([]);
  }, WHOLE_TREE);
});

describe("the walk itself (self-tests on a throwaway tree)", () => {
  const base = mkdtempSync(join(tmpdir(), "access-log-routes-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const put = (f: string, body: string) => { mkdirSync(join(base, f, ".."), { recursive: true }); writeFileSync(join(base, f), body); };
  const IMPORT = "import { noteOpened, noteOpenedApi } from \"@/lib/access-log/note\";\n";
  const REF = "{ isAgency: true }, \"a\", { kind: \"call\", recordId: \"b\" }";
  put("app/x/[accountId]/known/page.tsx", "export default function P() { return null; }\n");
  put("app/x/[accountId]/new/page.tsx", "export default function P() { return null; }\n");
  put("app/x/[accountId]/new/layout.tsx", "export default function L({ children }: { children: unknown }) { return children; }\n");
  put("app/x/[accountId]/rec/page.tsx", "// noteOpened(access, a, ref) is mentioned only here\nconst s = \"noteOpened(\";\nexport default function P() { return s; }\n");
  put("app/x/[accountId]/ok/page.tsx", `${IMPORT}export default async function P() { await noteOpened(${REF}); const [x] = await Promise.all([Promise.resolve(1), noteOpened(${REF})]); return x; }\n`);
  const SHAPES: Record<string, string> = {
    "void.ts": `${IMPORT}export async function f() { void noteOpened(${REF}); }\n`,
    "catch.ts": `${IMPORT}export async function f() { await noteOpened(${REF}).catch(() => undefined); }\n`,
    "then.ts": `${IMPORT}export async function f() { noteOpened(${REF}).then(() => 1); }\n`,
    "unawaited.ts": `${IMPORT}export async function f() { const p = noteOpened(${REF}); return p; }\n`,
    "all-caught.ts": `${IMPORT}export async function f() { await Promise.all([noteOpened(${REF})]).catch(() => []); }\n`,
    "api-unnegated.ts": `${IMPORT}export async function f() { if (await noteOpenedApi(${REF})) return 1; return 2; }\n`,
    "api-no-return.ts": `${IMPORT}export async function f() { if (!(await noteOpenedApi(${REF}))) console.log("x"); return 1; }\n`,
    "api-ignored.ts": `${IMPORT}export async function f() { await noteOpenedApi(${REF}); return 1; }\n`,
    // Review r1: an awaited call inside a try whose catch neither returns nor rethrows fails OPEN.
    "try-empty-catch.ts": `${IMPORT}export async function f() { try { await noteOpened(${REF}); } catch {} return 1; }\n`,
    "try-logging-catch.ts": `${IMPORT}export async function f() { try { await noteOpened(${REF}); } catch (e) { console.error(e); } return 1; }\n`,
    "try-maybe-rethrow.ts": `${IMPORT}export async function f(x: boolean) { try { await noteOpened(${REF}); } catch (e) { if (x) throw e; } return 1; }\n`,
    "try-all-catch.ts": `${IMPORT}export async function f() { try { await Promise.all([noteOpened(${REF})]); } catch { /* swallowed */ } return 1; }\n`,
    "try-outer-catch.ts": `${IMPORT}export async function f() { try { try { await noteOpened(${REF}); } catch (e) { throw e; } } catch { } return 1; }\n`,
    "try-finally-return.ts": `${IMPORT}export async function f() { try { await noteOpened(${REF}); } finally { return 1; } }\n`,
    "api-try-empty-catch.ts": `${IMPORT}export async function f() { try { if (!(await noteOpenedApi(${REF}))) return 404; } catch {} return 200; }\n`,
    // The call hidden in a function the caller never awaits: the awaited shape holds inside it, not outside.
    "nested-iife.ts": `${IMPORT}export async function f() { void (async () => { await noteOpened(${REF}); })(); return 1; }\n`,
    "nested-helper.ts": `${IMPORT}async function log() { await noteOpened(${REF}); }\nexport async function f() { void log(); return 1; }\n`,
    "helper-as-value.ts": `${IMPORT}async function log() { await noteOpened(${REF}); }\nexport const later = [log];\nexport async function f() { await log(); return 1; }\n`,
    "helper-uncalled.ts": `${IMPORT}const log = async () => { await noteOpened(${REF}); };\nexport async function f() { return 1; }\n`,
    "helper-in-empty-catch.ts": `${IMPORT}async function log() { await noteOpened(${REF}); }\nexport async function f() { try { await log(); } catch {} return 1; }\n`,
  };
  for (const [n, b] of Object.entries(SHAPES)) put(`lib/shapes/${n}`, b);
  put("lib/shapes/api-ok.ts", `${IMPORT}export async function f() { if (!(await noteOpenedApi(${REF}))) return 404; return 200; }\n`);
  put("lib/shapes/try-ok.ts", `${IMPORT}declare function unstable_rethrow(e: unknown): void;\n`
    + `export async function f() { try { await noteOpened(${REF}); return 1; } catch (e) { unstable_rethrow(e); console.error(e); return 2; } }\n`
    + `export async function g() { try { if (!(await noteOpenedApi(${REF}))) return 404; return 200; } catch (e) { throw e; } }\n`
    + `export const h = async () => { try { await noteOpened(${REF}); } finally { console.log("done"); } };\n`);
  // The ai-summary route's shape: one helper, returned by GET and POST (and awaited, and as an arrow's body).
  put("lib/shapes/helper-ok.ts", `${IMPORT}async function answer(force: boolean) { if (!(await noteOpenedApi(${REF}))) return 404; return force ? 201 : 200; }\n`
    + "export function GET() { return answer(false); }\nexport async function PUT() { return await answer(true); }\nexport const POST = () => answer(true);\n");

  // Review r2: every exported VALUE binding of a "use server" file is an action, however it is written.
  const US = "\"use server\";\n";
  put("lib/acts/forms.ts", `${US}import { wrap } from "./wrap";\nimport { other } from "./other";\n`
    + "export async function decl() { return 1; }\n"
    + "export function overloaded(a: string): string;\nexport function overloaded(a: string) { return a; }\n"
    + "export const arrow = async () => 1;\n"
    + "export const wrapped = wrap(async () => 1);\n"
    + "export let later = async () => 1;\n"
    + "const local = async () => 1;\nasync function hidden() { return 1; }\n"
    + "export { local, hidden as renamed };\n"
    + "export { other as forwarded };\n"
    + "export type NotAnAction = { a: 1 };\nexport interface AlsoNot { a: 1 }\ntype T = 1;\nexport { type T };\ntype U = 2;\nexport { U };\n"
    + "export default async function () { return 1; }\n");
  put("lib/acts/default-expr.ts", `${US}import { wrap } from "./wrap";\nexport default wrap(async () => 1);\n`);
  put("lib/acts/star.ts", `${US}export * from "./forms";\n`);

  // T3 review m1: the guard's options are a literal, or nothing.
  const GIMPORT = "import { requireAccountAccess, requireAccountOwner, type AccessOptions } from \"@/lib/auth\";\n";
  const GUARD_SHAPES: Record<string, string> = {
    "template.ts": `${GIMPORT}export async function f(a: string) { await requireAccountAccess(a, { agencyVisit: \`not-\${"required"}\` as "not-required" }); }\n`,
    "no-sub-template.ts": `${GIMPORT}export async function f(a: string) { await requireAccountAccess(a, { agencyVisit: \`not-required\` }); }\n`,
    "forwarded.ts": `${GIMPORT}export async function f(a: string, opts: AccessOptions) { await requireAccountOwner(a, opts); }\n`,
    "const-opts.ts": `${GIMPORT}const o = { agencyVisit: "not-required" } as const;\nexport async function f(a: string) { await requireAccountAccess(a, o); }\n`,
    "spread.ts": `${GIMPORT}export async function f(a: string, o: AccessOptions) { await requireAccountAccess(a, { ...o }); }\n`,
    "shorthand.ts": `${GIMPORT}export async function f(a: string, agencyVisit: "not-required") { await requireAccountAccess(a, { agencyVisit }); }\n`,
    "computed.ts": `${GIMPORT}const k = "agencyVisit";\nexport async function f(a: string) { await requireAccountAccess(a, { [k]: "not-required" }); }\n`,
    "variable-value.ts": `${GIMPORT}const v = "not-required" as const;\nexport async function f(a: string) { await requireAccountAccess(a, { agencyVisit: v }); }\n`,
    "three-args.ts": `${GIMPORT}export async function f(a: string) { await (requireAccountAccess as (...x: unknown[]) => unknown)(a, {}, 1); await requireAccountAccess(a, {}, ...[]); }\n`,
    "alias.ts": "import { requireAccountAccess as gate } from \"@/lib/auth\";\nexport async function f(a: string, o: never) { await gate(a, o); }\n",
    "namespace.ts": "import * as auth from \"@/lib/auth\";\nexport async function f(a: string, o: never) { await auth.requireAccountAccess(a, o); }\n",
    "held.ts": `${GIMPORT}const g = requireAccountAccess;\nexport async function f(a: string, o: never) { await g(a, o); }\n`,
  };
  for (const [n, b] of Object.entries(GUARD_SHAPES)) put(`lib/guards/${n}`, b);
  put("lib/guards/ok.ts", `${GIMPORT}export async function f(a: string) {\n  await requireAccountAccess(a);\n`
    + "  await requireAccountAccess(a, { duringPause: \"allow\" });\n  await requireAccountOwner(a, { \"agencyVisit\": \"not-required\" });\n"
    + "  type R = ReturnType<typeof requireAccountAccess>;\n  return null as unknown as R;\n}\n");

  it("reports an unclassified page AND an unclassified layout by name", () => {
    expect(unclassifiedEntries(base, ["app/x"], new Set(["app/x/[accountId]/known/page.tsx", "app/x/[accountId]/rec/page.tsx", "app/x/[accountId]/ok/page.tsx"])))
      .toEqual(["app/x/[accountId]/new/layout.tsx", "app/x/[accountId]/new/page.tsx"]);
  });
  it("a record whose only noteOpened is in a comment or a string is reported; a real call is not", () => {
    expect(missingLogger(base, { "app/x/[accountId]/rec/page.tsx": "noteOpened", "app/x/[accountId]/ok/page.tsx": "noteOpened" }))
      .toEqual(["app/x/[accountId]/rec/page.tsx"]);
  });
  it.each(Object.keys(SHAPES))("the shape check refuses %s", (n) => {
    expect(badLoggerCalls(parse(join(base, "lib/shapes", n))).length).toBeGreaterThan(0);
  });
  it("the shape check accepts the good shapes: an awaited call, an element of an awaited Promise.all, the API shape, and a try whose catch returns or rethrows", () => {
    expect(badLoggerCalls(parse(join(base, "app/x/[accountId]/ok/page.tsx")))).toEqual([]);
    expect(badLoggerCalls(parse(join(base, "lib/shapes/api-ok.ts")))).toEqual([]);
    expect(badLoggerCalls(parse(join(base, "lib/shapes/try-ok.ts")))).toEqual([]);
    expect(badLoggerCalls(parse(join(base, "lib/shapes/helper-ok.ts")))).toEqual([]);
  });
  it("counts every exported value binding of a \"use server\" file, and no type (review r2)", () => {
    expect(actionKeys(base, ["lib/acts"]).map((k) => k.key).sort()).toEqual([
      "lib/acts/default-expr.ts#default",
      "lib/acts/forms.ts#arrow", "lib/acts/forms.ts#decl", "lib/acts/forms.ts#default", "lib/acts/forms.ts#forwarded",
      "lib/acts/forms.ts#later", "lib/acts/forms.ts#local", "lib/acts/forms.ts#overloaded", "lib/acts/forms.ts#renamed",
      "lib/acts/forms.ts#wrapped",
      "lib/acts/star.ts#*",
    ]);
  });
  it("a renamed export is checked against its local body, so a record action written that way is still read (review r2)", () => {
    put("lib/acts2/renamed.ts", `${US}${IMPORT}async function opener() { await noteOpened(${REF}); }\nexport { opener as openAction };\n`);
    const [k] = actionKeys(base, ["lib/acts2"]);
    expect(k?.key).toBe("lib/acts2/renamed.ts#openAction");
    expect(calls(k!.node, "noteOpened")).toHaveLength(1);
  });
  it.each(Object.keys(GUARD_SHAPES))("the guard-call check refuses %s (T3 review m1)", (n) => {
    expect(badGuardCalls(parse(join(base, "lib/guards", n))).length).toBeGreaterThan(0);
  });
  it("the guard-call check accepts no options, a literal object of literal values, and a typeof in a type", () => {
    expect(badGuardCalls(parse(join(base, "lib/guards/ok.ts")))).toEqual([]);
  });
});

describe("the walk itself, final review M1 and M2 (self-tests on their own throwaway tree)", () => {
  const base = mkdtempSync(join(tmpdir(), "access-log-routes-m-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const put = (f: string, body: string) => { mkdirSync(join(base, f, ".."), { recursive: true }); writeFileSync(join(base, f), body); };
  const GIMPORT = "import { requireAccountAccess, apiAccountAccess } from \"@/lib/auth\";\n";
  const NIMPORT = "import { noteOpened, noteOpenedApi } from \"@/lib/access-log/note\";\n";
  const ITEM = "\"a\", { kind: \"call\", recordId: \"b\" }";

  // M1: a guard-calling "use server" file OUTSIDE app/ and lib/, and an inline "use server" function anywhere.
  put("components/x/guarded-actions.ts", `"use server";\n${GIMPORT}export async function act(a: string) { await requireAccountAccess(a); }\n`);
  put("components/x/plain-actions.ts", "\"use server\";\nexport async function quiet() { return 1; }\n");
  put("app/y/list/page.tsx", "async function inlineAct() { \"use server\"; return 1; }\n"
    + "const held = async () => { \"use server\"; return 2; };\n"
    + "export default function P() { return [inlineAct, held, async () => { \"use server\"; return 3; }]; }\n"
    + "function notAnAction() { const s = \"use server\"; return s; }\nexport const x = notAnAction;\n");

  it("a guard-calling \"use server\" file under components/ is enumerated, one that calls no guard outside the roots is not (M1)", () => {
    const keys = actionKeys(base, ["lib/acts"]).map((k) => k.key);
    expect(keys).toContain("components/x/guarded-actions.ts#act");
    expect(keys).not.toContain("components/x/plain-actions.ts#quiet");
  });
  it("every function whose body starts with a \"use server\" directive is an action, named or not; a string that is not a directive is not (M1)", () => {
    const keys = actionKeys(base, ["lib/acts"]).map((k) => k.key).filter((k) => k.startsWith("app/y/"));
    expect(keys.sort()).toEqual(["app/y/list/page.tsx#<inline at line 3>", "app/y/list/page.tsx#held", "app/y/list/page.tsx#inlineAct"]);
  });

  // M2: the logger's first argument.
  const M2_BAD: Record<string, string> = {
    "literal.ts": `${NIMPORT}export async function f() { await noteOpened({ isAgency: false }, ${ITEM}); }\n`,
    "held-literal.ts": `${NIMPORT}export async function f() { const access = { isAgency: false }; await noteOpened(access, ${ITEM}); }\n`,
    "parameter.ts": `${NIMPORT}export async function f(access: { isAgency: boolean }) { await noteOpened(access, ${ITEM}); }\n`,
    "let-bound.ts": `${GIMPORT}${NIMPORT}export async function f(a: string) { let access = await requireAccountAccess(a); access = { ...access, isAgency: false }; await noteOpened(access, ${ITEM}); }\n`,
    "outer-function.ts": `${GIMPORT}${NIMPORT}export async function f(a: string) { const access = await requireAccountAccess(a); const inner = async () => { await noteOpened(access, ${ITEM}); }; await inner(); }\n`,
    "shadowed.ts": `${GIMPORT}${NIMPORT}export async function f(a: string) { const access = await requireAccountAccess(a); { const access = { isAgency: false }; await noteOpened(access, ${ITEM}); } }\n`,
    "spread.ts": `${GIMPORT}${NIMPORT}export async function f(a: string) { const access = await requireAccountAccess(a); await noteOpened({ ...access }, ${ITEM}); }\n`,
    "api-literal.ts": `${NIMPORT}export async function f() { if (!(await noteOpenedApi({ isAgency: false }, ${ITEM}))) return 404; return 200; }\n`,
    "not-a-guard.ts": `${NIMPORT}declare function lookAlike(a: string): Promise<{ isAgency: boolean }>;\nexport async function f(a: string) { const access = await lookAlike(a); await noteOpened(access, ${ITEM}); }\n`,
  };
  for (const [n, b] of Object.entries(M2_BAD)) put(`lib/args/${n}`, b);
  put("lib/args/ok.ts", `${GIMPORT}${NIMPORT}export async function f(a: string) { const access = await requireAccountAccess(a); await noteOpened(access, ${ITEM}); }\n`
    + `export async function g(a: string) { const access = await apiAccountAccess(a); if (!access) return 404; if (!(await noteOpenedApi(access, ${ITEM}))) return 404; return 200; }\n`);

  it.each(Object.keys(M2_BAD))("the argument check refuses %s (M2)", (n) => {
    expect(badLoggerArgs(parse(join(base, "lib/args", n))).length).toBeGreaterThan(0);
  });
  it("the argument check accepts a const bound to an awaited guard call in the same function, page and API shapes (M2)", () => {
    expect(badLoggerArgs(parse(join(base, "lib/args/ok.ts")))).toEqual([]);
  });
});
