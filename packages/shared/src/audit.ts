import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { roleSchema } from './roles.js';

/**
 * Every action the API writes to the audit log, by group (task 2.6a, pull
 * request #75). `AuditEntry.action` of the API is typed `AuditAction`, so an
 * action without a name on the screen does not compile; each has a text under
 * `audit.actions.<action>` in the three locale files (a locale test checks).
 * The groups are the "Kind" filter of the Audit log page.
 */
export const AUDIT_ACTION_GROUPS = {
  sign_in: [
    'auth.sign_in',
    'auth.sign_in_failed',
    'auth.sign_in_locked',
    'auth.sign_in_inactive',
    'auth.second_step_passed',
    'auth.second_step_failed',
    'auth.recovery_code_used',
    'auth.sign_out',
    'auth.sign_out_everywhere',
    'auth.session_idle',
    'auth.session_expired',
    'auth.device_trusted',
    'auth.trust_ended',
    'auth.trusted_device_removed',
    'auth.password_change',
    'auth.password_change_failed',
    'auth.password_reset_requested',
    'auth.password_reset_mail_sent',
    'auth.password_reset_by_email',
  ],
  accounts: [
    'account.create',
    'account.linked',
    'account.language_changed',
    'account.locked',
    'account.unlocked',
    'account.password_reset',
    'account.rehire_password',
    'account.second_step_started',
    'account.second_step_on',
    'account.second_step_off',
    'account.second_step_reset',
    'account.second_step_unreadable',
    'assignment.given',
    'assignment.end',
    'assignment.end_withdrawn',
    'assignment.ended',
    'assignment.subjects_changed',
  ],
  setup: [
    'branch.create',
    'branch.edit',
    'branch.go_live',
    'travel_time.set',
    'building.create',
    'building.edit',
    'building.archive',
    'building.restore',
    'floor.create',
    'floor.edit',
    'floor.archive',
    'floor.restore',
    'room.create',
    'room.edit',
    'division.create',
    'division.edit',
    'division.archive',
    'division.restore',
    'department.create',
    'department.edit',
    'department.archive',
    'department.restore',
    'academic_year.create',
    'academic_year.edit',
    'academic_year.start',
    'quarters.edit',
    'quarter.attendance_values',
    'calendar_entry.create',
    'calendar_entry.edit',
    'calendar_entry.archive',
    'calendar_entry.restore',
    'slot_type.create',
    'slot_type.rename',
    'slot_type.length_change',
    'slot_type.archive',
    'slot_type.restore',
    'day_template.create',
    'day_template.rename',
    'day_template.version_create',
    'day_template.archive',
    'day_template.restore',
    'day_template_assignment.set',
    'day_template_assignment.end',
    'settings.edit_days',
    'settings.early_warning',
    'subject.create',
    'subject.edit',
    'subject.archive',
    'subject.restore',
    'subject_daily_weights.set',
    'subject_quarter_weights.set',
  ],
  people: [
    'staff.create',
    'staff.edit',
    'staff.teaching',
    'staff.branches',
    'staff.status',
    'staff.photo',
    'staff.availability_set',
    'staff.availability_end',
    'vacancy.create',
    'vacancy.edit',
    'vacancy.close',
    'vacancy.reopen',
    'vacancy.delete',
    'student.create',
    'student.edit',
    'student.uid_corrected',
    'student.photo',
    'student.leave',
    'student.leave_cancelled',
    'student.leave_undone',
    'student.return',
    'student.graduate_restored',
    'student.delete',
    'student.class_joined',
    'student.class_withdrawn',
    'student.group_joined',
    'student.group_withdrawn',
    'student.group_reviewed',
    'student.class_transferred',
    'student.class_transfer_changed',
    'student.class_transfer_cancelled',
    'student.class_transfer_undone',
    'student.group_transferred',
    'student.group_transfer_changed',
    'student.group_transfer_cancelled',
    'student.group_transfer_undone',
    'student.branch_released',
    'student.branch_release_cancelled',
    'student.branch_release_declined',
    'student.branch_left',
    'student.branch_moved',
    'student.merged',
    'relative.create',
    'relative.edit',
    'relative.archive',
    'relative.restore',
    'relative.link',
    'relative.link_edit',
    'relative.link_moved',
    'relative.unlink',
    'relative.merge',
    'relative.merged',
    'relative.phone_released',
    'relative.same_person',
    'relative.same_person_removed',
  ],
  classes: [
    'class.create',
    'class.edit',
    'class.archive',
    'class.restore',
    'class.tutor_given',
    'class.tutor_ended',
    'group.create',
    'group.edit',
    'group.archive',
    'group.restore',
  ],
  // Task 3.4a: draft timetable versions and their teaching load.
  timetable: [
    'timetable_version.create',
    'timetable_version.edit',
    'teaching_load.create',
    'teaching_load.edit',
    'teaching_load.delete',
  ],
  exports: [
    'building.export',
    'room.export',
    'division.export',
    'subject.export',
    'staff.export',
    'vacancy.export',
    'student.export',
    'class.export',
    'group.export',
    'student.personal_data_report',
    'staff.personal_data_report',
    'relative.personal_data_report',
  ],
  shows: ['staff.identity_shown', 'student.identity_shown', 'relative.show', 'audit.entry_shown'],
} as const;

export const AUDIT_GROUPS = Object.keys(
  AUDIT_ACTION_GROUPS,
) as (keyof typeof AUDIT_ACTION_GROUPS)[];

export type AuditGroup = keyof typeof AUDIT_ACTION_GROUPS;

export type AuditAction = (typeof AUDIT_ACTION_GROUPS)[AuditGroup][number];

export const AUDIT_ACTIONS: readonly AuditAction[] = Object.values(AUDIT_ACTION_GROUPS).flat();

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * The events of the own sign-in history (pull request #75, decision 10; the
 * same list as `own_sign_in_history` of db/migrations/0039).
 */
export const SIGN_IN_HISTORY_ACTIONS = [
  'auth.sign_in',
  'auth.sign_in_failed',
  'auth.sign_in_locked',
  'auth.sign_in_inactive',
  'auth.second_step_passed',
  'auth.second_step_failed',
  'auth.recovery_code_used',
  'auth.sign_out',
  'auth.sign_out_everywhere',
  'auth.session_idle',
  'auth.session_expired',
  'auth.device_trusted',
  'auth.trust_ended',
  'auth.trusted_device_removed',
  'auth.password_change',
  'auth.password_change_failed',
  'auth.password_reset_requested',
  'auth.password_reset_by_email',
  'account.password_reset',
  'account.rehire_password',
  'account.locked',
  'account.unlocked',
  'account.second_step_on',
  'account.second_step_off',
  'account.second_step_reset',
] as const satisfies readonly AuditAction[];

export type SignInHistoryAction = (typeof SIGN_IN_HISTORY_ACTIONS)[number];

/** Entries per page of the log and of the own history (decision 8). */
export const AUDIT_PAGE_SIZE = 50;

/** The longest date range of one search, in days (decision 5). */
export const AUDIT_MAX_RANGE_DAYS = 366;

/** The default range of the page, in days, today included (decision 5). */
export const AUDIT_DEFAULT_RANGE_DAYS = 30;

/** Which log the Super Admin reads (decision 4); the other readers read `branch` only. */
export const AUDIT_SCOPES = ['branch', 'all', 'school'] as const;

export type AuditScope = (typeof AUDIT_SCOPES)[number];

/** The kinds of person a search names (decision 5). */
export const AUDIT_PERSON_KINDS = ['staff', 'student', 'relative'] as const;

export type AuditPersonKind = (typeof AUDIT_PERSON_KINDS)[number];

const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** A cursor: the moment and id of the last entry of the page before, `<ISO moment>_<id>`. */
export const auditCursorSchema = z
  .string()
  .regex(new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z_${uuidPattern}$`, 'i'))
  .transform((value) => {
    const [at, id] = value.split('_') as [string, string];
    return { at, id: id.toLowerCase() };
  });

export type AuditCursor = z.infer<typeof auditCursorSchema>;

export function auditCursorOf(entry: { occurredAt: string; id: string }): string {
  return `${entry.occurredAt}_${entry.id}`;
}

/** `staff:<id>`, `student:<id>` or `relative:<id>`. */
export const auditPersonSchema = z
  .string()
  .regex(new RegExp(`^(staff|student|relative):${uuidPattern}$`, 'i'))
  .transform((value) => {
    const [kind, id] = value.split(':') as [AuditPersonKind, string];
    return { kind: kind.toLowerCase() as AuditPersonKind, id: id.toLowerCase() };
  });

/** The record types a search may name. */
export const AUDIT_RECORD_TYPE_MAX_LENGTH = 40;

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * The search of the Audit log page (decision 5): a person, a record, school
 * dates inclusive (at most `AUDIT_MAX_RANGE_DAYS`; left out, the last
 * `AUDIT_DEFAULT_RANGE_DAYS` days), a group, the scope and the cursor.
 */
export const auditQuerySchema = z
  .strictObject({
    person: auditPersonSchema.optional(),
    recordType: z
      .string()
      .regex(/^[a-z_]+$/)
      .max(AUDIT_RECORD_TYPE_MAX_LENGTH)
      .optional(),
    recordId: z.uuid().optional(),
    from: schoolDateSchema.optional(),
    to: schoolDateSchema.optional(),
    group: z.enum(AUDIT_GROUPS as [AuditGroup, ...AuditGroup[]]).optional(),
    scope: z.enum(AUDIT_SCOPES).default('branch'),
    before: auditCursorSchema.optional(),
  })
  .refine((query) => (query.recordType === undefined) === (query.recordId === undefined), {
    path: ['recordId'],
    message: 'A record is a type and an id.',
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ['to'],
    message: 'The range ends before it begins.',
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      daysBetween(query.from, query.to) < AUDIT_MAX_RANGE_DAYS,
    { path: ['to'], message: 'The range is longer than allowed.' },
  );

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** The query as the page sends it, before the schema transforms it. */
export type AuditQueryInput = z.input<typeof auditQuerySchema>;

const namedSchema = z.object({ id: z.uuid(), name: z.string().nullable() });

/** One entry as the page shows it. */
export const auditEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  /** `null` for an entry of the school-wide log. */
  branchId: z.uuid().nullable(),
  action: z.string(),
  /** `null` for the system (a server command, a job). */
  actor: namedSchema.nullable(),
  /** The assignment that allowed the action, with its role, when the reader may see it. */
  assignment: z.object({ id: z.uuid(), role: roleSchema }).nullable(),
  person: namedSchema.nullable(),
  record: z.object({ type: z.string(), id: z.uuid(), name: z.string().nullable() }).nullable(),
  // Stored JSON as written by each route; `z.json()` is recursive, which the
  // generated client of OpenAPI cannot follow.
  oldValue: z.unknown(),
  newValue: z.unknown(),
  details: z.unknown(),
  reason: z.string().nullable(),
  /** The paths of the values hidden from this reader, `oldValue.birthDate`; a Show reveals them. */
  hidden: z.array(z.string()),
});

export type AuditEntryAnswer = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  entries: z.array(auditEntrySchema),
  /** The cursor of the next page, `null` on the last. */
  next: z.string().nullable(),
  /**
   * Whether the reader may choose the log (a current Super Admin assignment,
   * decision 4): the page follows this answer, not the role on display.
   */
  chooseScope: z.boolean(),
  /** The dates searched, as the server read them (the defaults filled in). */
  from: schoolDateSchema,
  to: schoolDateSchema,
});

export type AuditPage = z.infer<typeof auditPageSchema>;

export const auditEntryParamsSchema = z.object({ id: z.uuid() });

export type AuditEntryParams = z.infer<typeof auditEntryParamsSchema>;

export const signInHistoryQuerySchema = z.strictObject({
  before: auditCursorSchema.optional(),
});

export type SignInHistoryQuery = z.infer<typeof signInHistoryQuerySchema>;

export const signInEventSchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  action: z.enum(SIGN_IN_HISTORY_ACTIONS),
  /** The name of the administrator who acted on the account; `null` for the person's own events. */
  by: z.string().nullable(),
  /** The browser of the session of a sign-in; `null` otherwise. */
  browser: z.string().nullable(),
});

export type SignInEvent = z.infer<typeof signInEventSchema>;

export const signInHistorySchema = z.object({
  events: z.array(signInEventSchema),
  next: z.string().nullable(),
});

export type SignInHistory = z.infer<typeof signInHistorySchema>;

/**
 * The record types and action prefixes of entries about people: their
 * values are hidden from a reader without Identity, except the keys known to
 * be outside it (decision 6, fail closed).
 */
const PEOPLE_PREFIXES = ['staff.', 'student.', 'relative.', 'account.', 'assignment.', 'auth.'];

const PEOPLE_RECORD_TYPES = new Set(['staff', 'student', 'relative', 'account']);

/**
 * The keys of people values that are not Identity (Basic, Contact,
 * Financial, and the technical keys of the entries), in both spellings the
 * log holds: the camelCase values of the routes and the snake_case row of
 * `student.delete`. A key not listed is hidden: Identity is "document
 * numbers, address, date of birth" (edge/people-roles-accounts), the region
 * (task 2.4a, decision 4), the JSHSHIR, and a relative's workplace and email
 * (task 2.5a, decision 5).
 */
const NOT_IDENTITY_KEYS = new Set([
  // ids and links
  'id',
  'ids',
  'staffId',
  'staff_id',
  'studentId',
  'student_id',
  'relativeId',
  'relative_id',
  'branchId',
  'branch_id',
  'accountId',
  'account_id',
  'assignmentId',
  'assignment_id',
  'newOwnerId',
  'mergedInto',
  'merged_into',
  'otherId',
  'keptId',
  'entryId',
  'sessionId',
  // a class of a student and its rows (task 3.1b)
  'classId',
  'class_id',
  'memberships',
  'membershipId',
  'ownUntil',
  'own_until',
  'endedBy',
  'ended_by',
  'leavingId',
  'leaving_id',
  'notRestored',
  // a group of a student and its rows (task 3.2b, decision 5 of pull request #92)
  'groupId',
  'group_id',
  'groupMemberships',
  'subject_id',
  'review',
  'cut',
  'was',
  // the moves of a student (task 3.3a, pull request #95)
  'moves',
  'moveId',
  'movesCancelled',
  'fromClassId',
  'toClassId',
  'fromGroupId',
  'toGroupId',
  'confirmLanguage',
  'pastAssignmentId',
  'written',
  'kept',
  'emptied',
  'effectiveOn',
  'madeAt',
  'cancelledAt',
  'undoneAt',
  'cancelledByLeavingId',
  'writtenByMoveId',
  'endedByMoveId',
  // the class of a return or a graduate restore (task 3.3b, decision 4)
  'classMembershipId',
  'languageConfirmed',
  'groupsPlaced',
  // the move to another branch (task 3.3c, pull request #97)
  'branchMoveId',
  'branchMoveCancelled',
  'branchMoves',
  'fromBranchId',
  'toBranchId',
  'releasedAt',
  'declinedAt',
  'acceptedAt',
  'groupsChosen',
  // nested records: the student and the links kept by `student.delete`
  'student',
  'relatives',
  // Basic
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'fatherName',
  'father_name',
  'paternalName',
  'paternal_name',
  'fullName',
  'full_name',
  'name',
  'name_key',
  'uid',
  'uids',
  'grade',
  'sex',
  'startsOn',
  'starts_on',
  'photoId',
  'photo_id',
  'photoType',
  'photo_type',
  'type',
  'width',
  'height',
  'bytes',
  'kind',
  'login',
  'role',
  'roles',
  'category',
  // Contact
  'phone',
  'extraPhones',
  'extra_phones',
  'phoneInvalid',
  'phone_invalid_since',
  'email',
  // Financial and the student's history
  'contract',
  'contracts',
  'number',
  'signedOn',
  'signed_on',
  'scholarship',
  'scholarshipType',
  'scholarship_type',
  'scholarshipCoverage',
  'scholarship_coverage',
  'scholarshipAmount',
  'scholarship_amount',
  'coverage',
  'amount',
  'previousSchool',
  'previous_school',
  'diagnosticScore',
  'diagnostic_score',
  'consentSignedOn',
  'consent_signed_on',
  'status',
  'statuses',
  'cause',
  'reason',
  'from',
  'until',
  'lastDay',
  'validFrom',
  'valid_from',
  'validUntil',
  'valid_until',
  'held_from',
  // Staff work record
  'admissionDate',
  'admission_date',
  'contractType',
  'contract_type',
  'contractDate',
  'contract_date',
  'weeklyLessons',
  'weekly_lessons',
  'dailyLessons',
  'daily_lessons',
  'educationLevel',
  'education_level',
  'vacancyName',
  'vacancy_name',
  'divisions',
  'divisionId',
  'departmentId',
  'department',
  'main',
  'isMain',
  'branches',
  'subjects',
  'subjectId',
  'grades',
  'languages',
  'entries',
  'ranges',
  'weekday',
  'start',
  'end',
  // Links of a relative
  'relationship',
  'mainContact',
  'main_contact',
  'portalAccess',
  'portal_access',
  'receivesNotices',
  'receives_notices',
  'linkedAt',
  'linked_at',
  'unlinkedAt',
  'unlinked_at',
  'archived',
  'archivedAt',
  'archived_at',
  'created_at',
  'createdAt',
  'created_by',
  'createdBy',
  // Exports
  'list',
  'selection',
  'filters',
  'columns',
  'leftOut',
  'rows',
  // Sign-in, accounts and roles: counts, moments and ids, nothing of a person
  'secondStep',
  'trustRequested',
  'trustedUntil',
  'endedSessions',
  'with',
  'left',
  'subjectIds',
  'mergedId',
  // A logged show: which entry and which fields were shown
  'entryAction',
  'fields',
]);

/** A relative's email is Identity (task 2.5a, decision 5); a student's or staff member's is Contact. */
const RELATIVE_IDENTITY_KEYS = new Set(['email']);

export interface HideableEntry {
  action: string;
  recordType: string | null;
  personId: string | null;
  oldValue: unknown;
  newValue: unknown;
  details: unknown;
}

export interface HiddenValues {
  oldValue: unknown;
  newValue: unknown;
  details: unknown;
  /** The paths of the values hidden, `newValue.birthDate`, `oldValue.student.birth_date`. */
  hidden: string[];
}

function isPeopleEntry(entry: HideableEntry): boolean {
  return (
    entry.personId !== null ||
    (entry.recordType !== null && PEOPLE_RECORD_TYPES.has(entry.recordType)) ||
    PEOPLE_PREFIXES.some((prefix) => entry.action.startsWith(prefix))
  );
}

function hideIn(
  value: unknown,
  path: string,
  hidden: string[],
  identityKeys: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => hideIn(item, `${path}.${index}`, hidden, identityKeys));
  }
  if (value !== null && typeof value === 'object') {
    const kept: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const at = `${path}.${key}`;
      if (!NOT_IDENTITY_KEYS.has(key) || identityKeys.has(key)) {
        if (inner !== null) {
          hidden.push(at);
        }
        kept[key] = null;
      } else {
        kept[key] = hideIn(inner, at, hidden, identityKeys);
      }
    }
    return kept;
  }
  return value;
}

/**
 * The values of an entry as a reader without Identity sees them (decision
 * 6): in an entry about people, every key not known to be outside Identity is
 * emptied, nested objects and arrays included, and named in `hidden`; the
 * typed search of an export is hidden too, since it may hold a document
 * number. Other entries are unchanged.
 */
export function hideIdentity(entry: HideableEntry): HiddenValues {
  const hidden: string[] = [];
  const identityKeys: ReadonlySet<string> =
    entry.recordType === 'relative' || entry.action.startsWith('relative.')
      ? RELATIVE_IDENTITY_KEYS
      : new Set();
  // An export holds no values of a record, only its filters and counts.
  if (AUDIT_ACTION_GROUPS.exports.some((action) => action === entry.action)) {
    let details = entry.details;
    if (details !== null && typeof details === 'object' && !Array.isArray(details)) {
      const search = (details as Record<string, unknown>).search;
      if (typeof search === 'string' && search !== '') {
        hidden.push('details.search');
        details = { ...details, search: null };
      }
    }
    return { oldValue: entry.oldValue, newValue: entry.newValue, details, hidden };
  }
  if (!isPeopleEntry(entry)) {
    return { oldValue: entry.oldValue, newValue: entry.newValue, details: entry.details, hidden };
  }
  return {
    oldValue: hideIn(entry.oldValue, 'oldValue', hidden, identityKeys),
    newValue: hideIn(entry.newValue, 'newValue', hidden, identityKeys),
    details: hideIn(entry.details, 'details', hidden, identityKeys),
    hidden,
  };
}
