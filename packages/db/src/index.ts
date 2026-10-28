export { serviceDb } from "./service";
export { userDb } from "./user-client";
export type { SupabaseClient } from "@supabase/supabase-js";
export { emit, listRecentEvents, type ActorType, type EventRow } from "./events";
export { sanitizeSearchTerm, searchTermLength } from "./search-term";
export { createAccount, listAccounts, setClientAccess, renameAccount, getAccountByOrgId,
         setA2pRegistration, getA2pRegistration, a2pApprovalIsComplete,
         isMessagingProfileId, MessagingProfileTakenError } from "./accounts";
export type { A2pStatus, A2pRegistration, A2pRegistrationRecord } from "./accounts";
export { getAlertPhone, setAlertPhone } from "./accounts";
export { getTransferPhone, setTransferPhone } from "./accounts";
export { getAccountLanguage, setAccountLanguage, type Locale as DbLocale } from "./accounts";
export { getAccountTrade, setAccountTrade, type AccountTrade } from "./accounts";
export { ALERT_CODE_DIGITS, ALERT_CODE_MAX_ATTEMPTS, ALERT_CODE_TTL_MINUTES,
         generateAlertCode, hashAlertCode, ALERT_CODE_MAX_SENDS_PER_HOUR,
         countRecentAlertPhoneVerifications, startAlertPhoneVerification,
         discardAlertPhoneVerification,
         verifyAlertPhoneCode, type AlertPhoneVerificationOutcome } from "./alert-phone-verification";
export { createContact, updateContact, listContacts, getContact,
         addTagToContact, removeTagFromContact, listContactTags, fillContactBlanks, fillContactBlanksReport,
         countContacts, deleteContacts, addTagToContacts, removeTagFromContacts, listTags,
         listTagNamesForContacts, flagMatchesOf,
         type ContactInput, type CreateContactInput, type SortKey, type SortDir } from "./contacts";
// item 8c: a field's own Undo (the compare-and-swap restore) and who most recently edited it.
export { restoreContactFieldIf, lastFieldEditor } from "./contacts";
export { readPhoneCountryFlag, setContactPhoneCountry, phoneFields } from "./contacts";
export { emailKey } from "./contacts";
export { recordLanguageSignal, setContactLanguage, restoreContactLanguage, keepContactLanguageHint, isLanguageTriple, LANGUAGE_SOURCES,
         type ContactLanguage, type LanguageSource, type LanguageSignalSource, type LanguageTriple } from "./contacts";
export { consentStateOf, readConsentState, appendConsentEvent, recordCarrierBlock,
         appendConsentEventGuarded, newestDecidingRow, readConsentHistory, readConsentEvent,
         readConsentActions, consentWriteArgs, consentAppendSql, emailLedgerAddress, readBlockedAddresses,
         CONSENT_METHODS, DECIDING_ACTIONS, CUSTOMER_STOP_METHODS,
         EMAIL_SUPPRESSION_METHODS, emailSuppressionOf, readEmailSuppression, recordEmailSuppression,
         type EmailSuppressionMethod, type EmailSuppression, type EmailSuppressionInput,
         type ConsentChannel, type ConsentAction, type ConsentMethod, type ConsentRow,
         type ConsentState, type ConsentEventInput, type ConsentGuard, type ConsentAppend,
         type PriorDecidingRow, type ConsentHistoryRow, type ConsentEventRow } from "./consent";
export { buildMatchIndex, applyImportBatch,
         type MatchIndex, type ImportRow } from "./contact-import";
export { addNote, listNotes, addTask, listContactTasks, completeTask, reopenTask,
         ensureConsentTask, completeTasksForConsentEvents, reopenTasks,
         HoldUndecidedError, holdOpenTaskIds, readTaskContact, deleteTaskForUndo } from "./activities";
export { listAccountWork, listAgencyWork, type WorkRow, type WorkSource, type AgencyWorkRow } from "./work-queue";
export { listCustomFields, createCustomField, listCustomValues, upsertCustomValue,
         ensureDefaultPipeline, listPipelinesWithStages, type CustomFieldDef } from "./crm-config";
export { createOpportunity, moveOpportunityStage, moveOpportunityToStage,
         updateOpportunity, setOpportunityStatus,
         listBoard, listContactOpportunities,
         listOpportunityValuesCreatedBetween, sumOpenOpportunities,
         listOpenDealsFor, GROUP_DEALS_SHOWN, type OpenDealRow } from "./opportunities";
export { ensureConversation, createMessage, updateMessageStatus,
         updateMessageStatusByProviderId, findMessageByProviderId, hasRecentOutboundSms,
         listFailedOutboundSms,
         listConversations, getConversationSummary, findConversationForContact, listMessages,
         listContactMessages, incrementUnreadCount, clearUnreadCount,
         type MessageStatus, type NewMessage, type ConversationSummary,
         type ConversationCursor, type FailedOutboundSms, type TextbackWindow,
         sumUnreadCount, searchConversations,
         fileWebchatTurns, type WebchatFileResult } from "./messaging";
export { recipientLanguage, chooseBody, spanishIsStale, nextSpanishBox, type RecipientLanguage, type BodyDefaults } from "./messaging";
// NOTE: searchCalls needs no line here — voice is `export * from "./voice"` below.
export { newPublicId, createForm, listForms, getForm, getPublishedFormByPublicId,
         getFormByPublicId, isFormLive,
         updateForm, createSubmission, recordRejectedSubmission, countRecentSubmissions,
         listSubmissionCreationsBetween,
         shouldRecordRateLimit, findRecentDuplicate, linkSubmissionContact,
         setSubmissionProcessingError, emitFormSubmitted, listSubmissions, listContactSubmissions,
         countFormsMissingNotify, findConciergeDestinationName, republishFormIfUnchanged,
         type FormField, type FormFieldKind, type FormTheme, type FormStatus,
         type FormRow, type FormSummary,
         type SubmissionInput, type SubmissionRow, type SubmissionConsent } from "./forms";
export { captureBlueprint, listBlueprints, getBlueprint, blueprintKey, applyBlueprint,
         BUNDLE_SCHEMA_VERSION,
         type BlueprintBundle, type BlueprintRow, type BlueprintSummary, type ApplyReport } from "./blueprints";
export { listChecklistState, setChecklistItem, addCustomChecklistItem,
         type ChecklistStateRow } from "./checklist";
export { uploadBrandLogo, removeBrandLogo, sweepOrphanedLogos, restoreBrandLogoIfCleared, logoExists,
         brandLogoUrl, setBranding, getBranding, brandDisplayName,
         type Branding } from "./branding";
export { getMailingAddress } from "./branding";
export { getSendingIdentity, setFromEmail, type SendingIdentity } from "./sending-identity";
// S-06 part 1: inbound email (0082).
export {
  INBOUND_MODES, BIS_REPLY_DOMAIN, REPLY_TOKEN_PATTERN, INBOUND_EMAIL_COLLISION, newReplyToken, getInboundSettings, setInboundSettings,
  ensureReplyToken, readReplyToken, findReplyThread, recordInboundEmail, getInboundEmail, findInboundEmailByProviderId, setInboundMessage, decideInboundEmail,
  unfileInboundEmail, listHeldInboundEmails, countHeldInboundEmails, matchSender, deleteInboundMessageByProviderId,
  matchTeamSender,
  type InboundMode, type InboundSettings, type ReplyThread, type InboundStatus, type HoldReason, type InboundAuthRecord,
  type InboundEmailRow, type NewInboundEmail, type HeldInboundEmail, type SenderMatch, type TeamSender,
} from "./inbound-email";
// S-06 part 2: the Never record list (0083).
export { listNeverLog, addNeverLog, removeNeverLog, type NeverLogEntry, type AddNeverLogResult } from "./never-log";
export { NEVER_LOG_MAX, parseNeverLogPattern, neverLogMatches, type NeverLogKind, type NeverLogPattern } from "./never-log-rules";
export { getOrCreateCalendar, getCalendarForAccount, getCalendarByPublicId, updateCalendarSettings,
         listBookedRanges, createBooking, cancelBookingByToken, setBookingStatus,
         listCalendarBookings, nextBookedStart, countRecentBookings, listDueReminders, stampReminderSent,
         listDueFollowups, stampFollowupSent, listBookingCreationsBetween,
         newCancelToken, SlotTakenError,
         getDueReminderById, getDueFollowupById,
         REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
         type CalendarRow, type BookingRow, type BookingStatus, type CalendarSettingsPatch,
         type CreateBookingInput, type DueReminder, type DueFollowup, type DueLookup } from "./booking";
export { LATE_REMINDER_WINDOW_START_MS, LATE_REMINDER_WINDOW_END_MS, LATE_REMINDER_MIN_AGE_MS, isLateBooking } from "./booking";
export { BookingNotStartedError, BookingNotRestorableError, undoOperatorCancel } from "./booking";
export { claimCancelNotice, rescheduleChain, bookingContactEmail, loadAccountBrandInfo, type AccountBrandInfo } from "./booking";
export { discardQueuedNotice, noticeMessageStatus } from "./booking";
export {
  savePendingCancelNotice, listDueCancelNotices, deletePendingCancelNotice, readBookingStatus,
  type PendingCancelNotice, type PendingCancelNoticeWrite,
} from "./booking";
export { moveBooking, BookingNotMovableError, bookingWasMoved } from "./booking";
export { countContactBookingsMade, listContactUpcomingBookings, countBookingsMadeFor, type UpcomingBooking } from "./booking";
export { rescheduleRoots, listFeedBookings, FEED_PAST_DAYS, FEED_FUTURE_DAYS, FEED_FUTURE_CAP, FEED_PAST_CAP, type FeedBookingRow } from "./booking";
export {
  CALENDAR_FEED_FETCH_MAX, CALENDAR_FEED_FETCH_WINDOW_SECONDS, CALENDAR_FEED_UNDO_SECONDS,
  readLiveCalendarFeed, createCalendarFeed, revokeCalendarFeed, replaceCalendarFeed, restoreCalendarFeed,
  claimCalendarFeedFetch, type CalendarFeedRow, type FeedClaim,
} from "./calendar-feeds";
export { getAutomation, upsertAutomation, parseReviewRequestConfig,
         listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
         REVIEW_REQUEST_MAX_AGE_MS,
         parseNoShowNudgeConfig, listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed,
         countNoShowNudgesSince, NO_SHOW_NUDGE_MAX_AGE_MS,
         listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
         SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
         parseInstantReplyConfig, stampInstantReplySent, countInstantRepliesSince,
         getDueReviewRequestById, getDueNoShowNudgeById, getDueSmsReminderById,
         listDueAppointmentConfirms, getDueAppointmentConfirmById,
         stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed,
         matchConfirmationReply, applyConfirmationReply, listOutstandingConfirmAsks,
         APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS,
         APPOINTMENT_CONFIRM_MIN_LEAD_MS,
         parseReferralAskConfig, listDueReferralAsks, getDueReferralAskById,
         stampReferralAsked, stampReferralAskSmsFailed, countReferralAsksSince,
         REFERRAL_ASK_MAX_AGE_MS,
         type ReferralAskChannel, type ReferralAskConfig, type DueReferralAsk,
         parseReactivationConfig, reactivationCutoff, listDueReactivations, getDueReactivationById,
         conversationQuietSince, stampReactivationSent, countReactivationsSince,
         missingForMarketingEmail,
         REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS, REACTIVATION_DEFAULT_MONTHS,
         REACTIVATION_CANDIDATE_LIMIT, REACTIVATION_CANDIDATE_PAGES, REACTIVATION_SURVIVOR_TARGET,
         type ReactivationConfig, type DueReactivation,
         parseQuoteFollowupConfig, listDueQuoteFollowups, getDueQuoteFollowupById,
         latestInboundByContact, stampQuoteFollowupSent, stampQuoteFollowupSmsFailed,
         countQuoteFollowupsSince,
         QUOTE_FOLLOWUP_MAX_AGE_MS, QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS,
         QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS, QUOTE_FOLLOWUP_CANDIDATE_LIMIT,
         type QuoteFollowupChannel, type QuoteFollowupConfig, type DueQuoteFollowup,
         type DueAppointmentConfirm, type ConfirmationAnswer,
         type RecipeKey, type AutomationRow, type ReviewRequestChannel,
         type ReviewRequestConfig, type DueReviewRequest,
         type NoShowNudgeChannel, type NoShowNudgeConfig, type DueNoShowNudge,
         type DueSmsReminder, type InstantReplyConfig } from "./automations";
export * from "./voice";
export * from "./voice-knowledge";
export * from "./business-status";
export * from "./screened-calls";
export * from "./forwarded-calls";
export { getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced,
         listTrafficDays, listTrafficBreakdown, countTrafficDays, unlinkSite,
         type SiteRow, type TrafficDay, type TrafficDimension, type TrafficBreakdownRow } from "./sites";
export * from "./weekly-report";
export * from "./automation-log";
export * from "./automation-settings";

// The demo tenant's fiction — data only, no seeder. `seed.ts` deliberately
// stays out of the package's public surface: it DELETES the account it finds,
// and nothing in apps/web has any business reaching it. The one export the
// app genuinely needs is the forwarding tick key, which
// setup-status.test.ts asserts against its own copy so the two cannot drift.
export {
  DEMO_ORG_ID, DEMO_ACCOUNT_NAME, DEMO_TIMEZONE, DEMO_BRAND_COLOR,
  DEMO_BUSINESS_LINE, DEMO_FROM_EMAIL, DEMO_OPEN_HOURS,
  DEMO_FORWARDING_TICK_KEY,
} from "./demo/fiction";
export * from "./timezone";
export * from "./zone-resolution";
// Item 8b-1: one table for every AI suggestion (0088). The pure rules are also the subpath
// `@bis/db/proposal-rules`, which web code imports them from (no bare vi.mock factory can blank them).
export * from "./proposal-rules";
export {
  insertProposal, listProposalsForCall, listPendingProposals, listPendingProposalsForAgency, getProposal,
  listPendingSiblings, decideProposal, revertProposalDecision, setAppliedRef, expireProposals,
  undoProposalDecision, expireAfterUndoCollision, restoreSiblings,
  // Item 8b-2: the record's "Waiting for you" and the timeline's accepted suggestions.
  listPendingProposalsForContact, listContactAcceptedSuggestions,
} from "./proposals";
export * from "./voice-web-sessions";
export * from "./concierge";
// S-06 part 3: a lead's website chat on the customer's thread. See ./webchat.ts and ./webchat-plan.ts.
export { resolveWebchatThread, listWebchatKeys, syncWebchatTurns, type WebchatThread, type WebchatSyncResult } from "./webchat";
export {
  planWebchatRows, matchedExistingCustomer, webchatKey, parseWebchatKey, WEBCHAT_ACTOR_ID, WEBCHAT_KEY_PREFIX,
  WEBCHAT_MAX_ROWS_PER_CHAT, type WebchatTurn, type WebchatKey, type WebchatRowMeta, type PlannedWebchatRow,
} from "./webchat-plan";
export * from "./profile-ready";

// The account-teardown cascade. Exported not for the app — nothing in
// apps/web's PRODUCTION code should ever delete an account this way — but for
// apps/web's own tests, which create throwaway accounts against the shared
// Supabase project and until now each hand-maintained a private copy of the
// FK-ordered delete list. Both copies had already drifted (the returning-lead
// one omitted `messages`/`conversations` after M1c started creating them, and
// 11 orphaned accounts accumulated in the shared project before anyone
// noticed). `packages/db`'s test fixtures are not a public subpath, which is
// why those copies existed; this list is not a fixture, it is the schema's own
// FK order, and there is now exactly one of it. A fourth caller reads
// `ACCOUNT_OWNED_TABLES` without importing `deleteAccountCascade`:
// `apps/web/e2e/fixtures/sweep.ts` (its own `deleteAccountCascade`, not this
// one — sweep.ts imports `serviceDb` from this package same as any other
// caller; the reason it keeps a private version is that it REPORTS each
// table's delete error instead of throwing on the first one, as
// `sweep.ts:98-100`'s own comment says, so a sweep that clears most of an
// account still does more good than one that stops at the first FK it hits)
// — outside `apps/web/src`, so `cascade-export-boundary.test.ts`'s walk
// rightly allows it.
export { deleteAccountCascade, ACCOUNT_OWNED_TABLES } from "./account-teardown";

// The throwaway-org-id prefix and its predicate. Exported because the two
// sides that must agree on it live in different packages: the fixture sweep
// here deletes accounts carrying it, and `createClientAccount` in apps/web
// refuses to create one. See ./org-id.ts.
export { TEST_ORG_ID_PREFIX, isTestOrgId } from "./org-id";

// Client billing plans (0051) — the agency Plans page. See ./billing.ts.
export { METER_KEYS, listPlans, getPlan, insertPlan, updatePlan, setPlanArchived, countBilledAccountsByPlan,
         type MeterKey, type MeterAmounts, type PlanFeatures, type PlanPriceKey, type StripePriceIds,
         type PlanTerms, type Plan, type PlanWrite } from "./billing";

// Client billing usage ledger (0051's usage_events): recorded where each
// billable fact happens, reported to Stripe by the cron. See ./usage.ts.
export { recordUsage, reportableFrom, usageRangeFilter, listBilledUsageAccounts, listReportableUsage,
         markUsageReported, staleUsageAccountIds, countExpiredUsage, listAccountsWithStaleUsage,
         USAGE_SOURCE_PREFIX, USAGE_REPORT_WINDOW_MS, USAGE_STALE_AFTER_MS, USAGE_ACCOUNTS_PER_READ,
         USAGE_ACCOUNTS_PER_BOUNDED_READ, USAGE_FUTURE_GRACE_MS, STALE_PROBE_ROWS,
         USAGE_HOLD_AFTER_MS, readUsageBands,
         type UsageInput, type UsageRow, type UsageRange, type BilledUsageAccount, type UsageBands } from "./usage";

// Client billing state (0051 account_billing + stripe_webhook_events, 0052
// billing_links): the webhook mirror, complimentary, links, the event ledger.
export { SUBSCRIPTION_STATUSES, ENDED_STATUSES, PAST_DUE_STATUSES, isSubscriptionStatus,
         getAccountBilling, getBillingLink, saveBillingLink, markBillingLinkExpired,
         decideMirror, mirrorSubscription, MIRROR_ATTEMPTS, markComplimentary, unmarkComplimentary, changeComplimentaryPlan,
         claimWebhookEvent, markWebhookEventProcessed,
         PAID_STATUSES, nextVersion, readBillingStanding, listPauseCandidates, pauseBilling, clearBillingPause,
         undoLiftBillingPause, healPermissions, listBillingAlerts, listReconcilableAccounts,
         PAUSE_ALERT_FORWARD_MS, PAUSE_ALERT_END_MS, RECONCILE_ALERT_FRESH_MS,
         type BillingStanding, type BillingAlert, type BillingAlerts,
         type SubscriptionStatus, type AccountBilling, type BillingLink, type BillingLinkWrite,
         type SubscriptionItemSnapshot, type SubscriptionSnapshot, type MirrorRefusal, type MirrorDecision,
         type MirrorOutcome, type MirrorPlan } from "./account-billing";
export { sumUsageSince } from "./usage";

// The nightly comparison of usage with Stripe (0099 billing_reconciliations),
// M7a PR-4. See ./billing-reconciliations.ts.
export * from "./billing-reconciliations";

// Heartbeats (0057 ops_heartbeats): written by the cron harness and the
// webhook routes, read by the alert pass and the health route. See ./ops.ts.
export { recordHeartbeat, listHeartbeats, markAlerted, HEARTBEAT_KEYS, passHeartbeatKey,
         HEARTBEAT_KEY_PATTERN, isHeartbeatKey, HEARTBEAT_ERROR_MAX_CHARS, boundHeartbeatError,
         type HeartbeatRow } from "./ops";

// Staff and roles (0066): the team data layer, the Clerk role rule and
// reconcile. See ./team.ts.
export { roleFromClerk, languageFromClerk, isAgencyMetadata,
         readAccountRole, upsertUserFromClerk, addAccountMember, deleteAccountMembership,
         setAccountMemberRole, removeAccountMember, setMemberLanguage, listAccountTeam,
         reconcileMembership, INVITE_ACCEPT_ALLOWANCE_MS,
         type AccountRole, type PersonLanguage, type TeamMember,
         MEMBER_REMOVED_EVENT, type ClerkTeamPort, type ReconcileOutcome } from "./team";

// A person's own preferences (0067): language + theme, read and write. See ./preferences.ts.
export { PERSON_THEMES, PERSON_LANGUAGES, NO_PREFS, isPersonTheme, isPersonLanguageValue,
         prefsFromRow, readPersonPrefs, readAccountRoleAndPrefs, savePersonPreference,
         type PersonTheme, type PersonPrefs, type PreferenceWrite, type PersonProfile } from "./preferences";

// Mine, Unassigned and the Technician (0068): who holds a customer or a task. See ./assignment.ts.
export {
  readPersonId, taskAssigneeFor, assignContacts, undoAssignContacts, setTaskAssignee, releaseMemberAssignments, reassignReleased,
  releaseTasksOffCustomers,
  type AssigneeFilter, type ReleasedAssignments, type PreviousAssignee,
} from "./assignment";

// Client groups (S-02 part 1, 0069): households and business customers. See ./client-groups.ts.
export {
  GROUP_NAME_MAX, GROUP_ROLE_MAX, BILLING_ADDRESS_MAX, dbTrimmedLength,
  listContactGroups, searchGroups, readMembership, readGroup,
  createGroupWithMember, addContactToGroup, setContactsBusiness, undoSetBusiness,
  setPrimaryMembership, removeMembership, restoreMembership, updateMembership, updateGroup,
  type GroupKind, type GroupMemberSnapshot, type ContactGroup, type ContactGroupMember,
  type GroupSearchHit, type BusinessResult,
  listGroupMembers, countGroupMembers, listGroupPeople, setGroupPrimaryContact, GROUP_MEMBERS_PAGE_SIZE, GROUP_ACTIVITY_CAP,
  type GroupMember, type GroupMembersPage, type GroupPerson,
} from "./client-groups";

// Relationships between customers (0070). See ./relationships.ts and ./relationship-keys.ts.
export {
  listContactRelationships, getRelationship, addRelationship, setRelationshipSides, removeRelationship,
  restoreRelationship, RelationshipDbError, MAX_RELATIONSHIPS_READ, type NewRelationship,
} from "./relationships";
export {
  RELATIONSHIP_KEYS, SIDE_COLUMNS, isRelationshipKey,
  type RelationshipKey, type WordForm, type RelationshipRow, type RelatedPerson, type RelationshipSidesPatch, type SideColumn,
} from "./relationship-keys";
// Properties and equipment (0071). See ./places.ts.
export {
  listContactPlaces, getPlace, getEquipment, addPlace, updatePlace, setPlaceOwner, removePlace, setPlaceArchived,
  restorePlace, addEquipment, replaceEquipment, updateEquipment, removeEquipment, restoreEquipment,
  PlaceDbError, MAX_PLACES_READ, MAX_EQUIPMENT_READ,
  type PlaceRow, type EquipmentRow, type PlaceOwner, type PlaceFields, type PlacePatch, type EquipmentFields,
  type EquipmentPatch, type ContactPlaceGroup, type ContactPlaces, type PlaceCtx,
  listGroupPlaces,
} from "./places";
// The document vault (0077). See ./documents.ts and ./document-rules.ts.
export {
  listRecordDocuments, getDocument, getDocumentVersion, getUploadingVersion, createDocument, reserveDocumentVersion,
  markDocumentVersionReady, discardDocumentUpload, updateDocumentField, setDocumentOwnersOnly, trashDocument, restoreDocument,
  listAbandonedUploads, deleteAbandonedVersion, listPurgeableDocuments, purgeDocumentRow, listDocumentTimeline, MAX_DOCUMENTS_READ,
  countContactDocuments, purgeContactDocuments, type ContactPurge,
  documentSpaceUsed, listDocumentVersionStates, claimDocumentForPurge, deletePurgedDocument, listDocumentVersionTimeline,
  DOCUMENT_PURGING_MARK,
  signedDocumentReadUrl, signedScannerUrl, recordDocumentScan, listPendingScans, oldestPendingScanAt, listDocumentScanTimeline, SCANNER_URL_SECONDS,
  type DocumentRecordRef, type DocumentRow, type DocumentVersionRow, type ListedDocument, type RecordDocuments, type ReserveOutcome,
  type DocumentField, type CasOutcome, type SweepVersion, type PurgeCandidate, type TimelineDocument,
  type DocumentVersionState, type TimelineDocumentVersion,
  type ScanStatus, type ReadUrlOutcome, type ScanVerdictInput, type RecordScanOutcome, type PendingScan, type TimelineDocumentScan,
} from "./documents";
export {
  DOCUMENT_BUCKET, DOCUMENT_QUOTA_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_CONTENT_TYPES, DOCUMENT_CATEGORIES, DOCUMENT_SOURCES,
  DOCUMENT_TITLE_MAX, DOCUMENT_TRASH_DAYS, isDocumentCategory, isDocumentContentType,
  removedReason, PASSWORD_SIGNATURE_PREFIX,
  type DocumentCategory, type DocumentContentType, type DocumentSource, type RemovedReason,
  // S-07 2b: customer upload links. See ./document-requests.ts.
  STAFF_DOCUMENT_SOURCES, CUSTOMER_AUTHOR_PREFIX, isCustomerAuthor,
  DOCUMENT_REQUEST_DAYS, DOCUMENT_REQUEST_DAILY_STARTS, DOCUMENT_REQUEST_MAX_ITEMS, DOCUMENT_REQUEST_NOTE_MAX,
  cleanRequestItems, documentRequestState,
  type DocumentRequestItem, type DocumentRequestChannel, type DocumentRequestState,
  // S-07 2c: the required-documents checklist.
  REQUIRABLE_DOCUMENT_CATEGORIES, isRequirableCategory, REQUIREMENT_STATES, isRequirementState, DOCUMENT_REQUIREMENT_UNDO_MS,
  cleanRequiredCategories, requirementsMeter, type RequirableCategory, type RequirementState,
  // S-07 3a: the expiry To-dos.
  DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay,
} from "./document-rules";
export {
  createDocumentRequest, findDocumentRequestByTokenHash, getDocumentRequest, startDocumentRequestUpload,
  getRequestDocument, listRequestFiles, listOpenDocumentRequests, revokeDocumentRequest, restoreDocumentRequest,
  listDocumentRequestTimeline, documentRequestTarget, ensureDocumentRequestTask, getDocumentRequestForVersion,
  listRequestsMissingReceivedTask, claimDocumentRequestSend, clearDocumentRequestSend,
  type DocumentRequestRow, type RequestStartOutcome, type RequestDocument, type RequestFile,
  type OpenDocumentRequest, type TimelineDocumentRequest, type DocumentRequestTarget,
} from "./document-requests";
// S-07 2c: the required-documents checklist. See ./document-requirements.ts.
export {
  listDocumentRequirements, getRequiredDocumentCategories, setRequiredDocumentCategories, getActiveDocumentSkip, getDocumentSkip,
  skipDocumentRequirement, undoDocumentSkip, unskipDocumentRequirement, undoDocumentUnskip, listDocumentSkipTimeline,
  restoreRequiredDocumentCategories,
  type DocumentRequirement, type DocumentSkipRow, type TimelineDocumentSkip,
} from "./document-requirements";
// S-07 3a: the expiry To-dos. See ./document-expiry.ts.
export {
  listExpiringDocuments, listDocumentExpiryTaskKeys, ensureDocumentExpiryTask, expiryTaskKey, deleteOpenExpiryTasks, deleteExpiryTasksOfHiddenDocuments, type ExpiringDocument,
} from "./document-expiry";
// S-07 3a: the account-wide Documents page. See ./account-documents.ts.
export {
  listAccountDocuments, countAccountDocuments, ACCOUNT_DOCUMENTS_SHOWS,
  type AccountDocumentsShow, type AccountDocumentsFilter, type AccountDocumentsCursor, type AccountDocument,
} from "./account-documents";
// S-07 3b: share links. See ./document-shares.ts.
export {
  DOCUMENT_SHARE_HOURS, createDocumentShare, findDocumentShareByTokenHash, documentShareState, getShareTarget,
  listLiveDocumentShares, revokeDocumentShares, restoreDocumentShares, claimDocumentShareDownload, listDocumentShareTimeline,
  listReadyVersionScans, shareableVersion, type ReadyVersionScan, type Shareable, type CreateShareOutcome, type RestoreSharesOutcome,
  type DocumentShareRow, type DocumentShareLife, type ShareTarget, type ShareClaim, type TimelineDocumentShare,
} from "./document-shares";
// Item 8a-1: the AI gateway's ledger, switches and budget. See ./ai-gateway.ts.
export {
  AI_FEATURES, AI_OUTCOMES, DEFAULT_MONTHLY_BUDGET_CENTS, MAX_MONTHLY_BUDGET_CENTS,
  aiGateCheck, recordAiLedger, getAiSettings, countAiSkipsSince, firstOverBudgetSince, setAccountAiSettings, setGlobalAiEnabled,
  type AiFeature, type AiOutcome, type AiGate, type AiLedgerEntry, type AiSettingsRead,
} from "./ai-gateway";
// Item 8a-2: the record page's AI paragraph cache (0087). See ./record-summaries.ts.
export {
  getRecordSummary, claimRecordSummary, saveRecordSummary, releaseRecordSummaryLease,
  type SummaryLanguage, type RecordSummaryKey, type RecordSummaryRow, type RecordSummaryClaim,
} from "./record-summaries";

// The contact record page: facts, Next up (S-03 part 1) and the paged timeline (1b). See ./record.ts.
export {
  contactFacts, contactNextUp, OPEN_DEALS_SUM_CAP,
  listContactTimelinePage, listPeopleNames, compareTimelineEntries, TIMELINE_SOURCES, TIMELINE_PAGE_SIZE,
  type Fact, type ContactFacts, type LastTalked, type LastTalkedChannel, type OpenDeals, type FactName,
  type ContactNextUp, type NextUpTask,
  type TimelineSource, type TimelineNote, type TimelineTask, type TimelineDeal, type TimelineSubmission,
  type TimelineMessage, type TimelineChat, type TimelineEntry, type TimelinePage, type TimelineCursor, type ContactBookingRow,
  type TimelineSuggestion,
  type ContactMessageRow,
  // S-03 part 2b: the household and business page reads its members as one set.
  listTimelinePage, groupActivityMembers, groupFacts, groupNextUp, GROUP_ACTIVITY_SCAN,
  type GroupActivity, type GroupFacts, type GroupLastTalked, type GroupNextUp,
} from "./record";

// Who made a timeline row (S-03 part 1, 1b; migration 0073). See ./provenance.ts.
export { AUTHOR_KINDS, messageAuthor, bookingAuthor, type AuthorKind, type RowAuthor } from "./provenance";
// Who created a contact (item 8c, migration 0091). See ./provenance.ts.
export { contactAuthor, SEED_ACTORS } from "./provenance";

// item 8c: Sofia's live acts, visible and reversible (migration 0091). The pure model is also the
// subpath `@bis/db/ai-act-rules`, which web code imports from (no bare vi.mock factory can blank it).
export * from "./ai-act-rules";
export {
  insertAiActs, getAiAct, listContactAiActs, undoAiBookingAct, aiContactHeldBy, undoAiContactCreated,
  stampAiActUndone, clearAiActUndone, markAiActNotified,
  type AiBookingUndoOutcome, type AiContactUndoOutcome,
} from "./ai-acts";

// F-196: the background job queue (migration 0102 `public.jobs`), claimed with leases and a dead letter. See ./jobs.ts.
export {
  insertJob, claimJob, completeJob, retryJob, killJob, sweepJobs, deadJobCounts, oldestDueJob,
  JOB_ERROR_MAX_CHARS, boundJobError, JobPayloadTooLarge, DEAD_JOB_COUNT_CAP,
  type JobState, type JobRow, type NewJob, type JobFence, type DeadJobCounts,
} from "./jobs";
