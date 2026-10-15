import { z } from 'zod';
import { studentMergeFieldSchema } from './student-merges.js';
import { schoolDateSchema } from './academic-year.js';
import { auditEntrySchema } from './audit.js';
import { relationshipSchema } from './relatives.js';
import { roleSchema } from './roles.js';
import { instructionLanguageSchema } from './settings.js';
import {
  contractTypeSchema,
  educationLevelSchema,
  sexSchema,
  staffIdSchema,
  staffStatusSchema,
} from './staff.js';
import {
  documentTypeSchema,
  regionSchema,
  scholarshipSchema,
  statusCauseSchema,
  studentGradeSchema,
  studentStatusSchema,
} from './students.js';

/**
 * The personal data report per person (task 2.6b, pull request #76;
 * edge-cases/people-roles-accounts, Personal data and the audit log: "The
 * Super Admin can produce a personal data report per person"). Every schema
 * is strict, so an answer that carries a key not named here (a password hash,
 * a second-step secret, a token) fails to parse (decision 6).
 */

/** The kinds of person a report is produced for. */
export const PERSONAL_DATA_KINDS = ['student', 'staff', 'relative'] as const;

export const personalDataKindSchema = z.enum(PERSONAL_DATA_KINDS);

export type PersonalDataKind = z.infer<typeof personalDataKindSchema>;

/** The most audit entries one report holds, newest first (decision 11). */
export const PERSONAL_DATA_ENTRY_LIMIT = 2000;

/** A school-wide record's three names, as stored. */
const namesSchema = z.strictObject({ uz: z.string(), ru: z.string(), en: z.string() });

/** The Parent or Student account of the portal: created, and switched off until Release 2. */
const portalAccountSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  switchedOn: z.boolean(),
});

/** What every report holds besides the person. */
const reportBase = {
  /** From the injected clock. */
  producedAt: z.iso.datetime(),
  /** The name of the Super Admin who produced it. */
  producedBy: z.string().nullable(),
  /** The branch of the request, and its time zone, in which moments are shown (decision 11 of #75). */
  branch: z.strictObject({ id: z.uuid(), name: z.string(), timeZone: z.string() }),
  /** Every audit entry about the person, newest first, at most `PERSONAL_DATA_ENTRY_LIMIT`. */
  entries: z.array(auditEntrySchema),
  /** The entries beyond the limit: how many, and the moment of the oldest (decision 11). */
  entriesLeftOut: z.strictObject({ count: z.int().min(1), oldestAt: z.iso.datetime() }).nullable(),
};

const studentLinkSchema = z.strictObject({
  relationship: relationshipSchema,
  mainContact: z.boolean(),
  portalAccess: z.boolean(),
  receivesNotices: z.boolean(),
  linkedAt: z.iso.datetime(),
  unlinkedAt: z.iso.datetime().nullable(),
});

export const studentReportSchema = z.strictObject({
  kind: z.literal('student'),
  ...reportBase,
  student: z.strictObject({
    id: z.uuid(),
    uid: z.string(),
    /** Every UID the student held, the current one included. */
    uids: z.array(
      z.strictObject({
        uid: z.string(),
        heldFrom: z.iso.datetime(),
        releasedAt: z.iso.datetime().nullable(),
      }),
    ),
    firstName: z.string(),
    lastName: z.string(),
    paternalName: z.string().nullable(),
    sex: sexSchema,
    grade: studentGradeSchema,
    startsOn: schoolDateSchema,
    photoId: z.uuid().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    birthDate: schoolDateSchema,
    documentType: documentTypeSchema.nullable(),
    documentNumber: z.string().nullable(),
    jshshir: z.string().nullable(),
    address: z.string().nullable(),
    region: regionSchema.nullable(),
    previousSchool: z.string().nullable(),
    diagnosticScore: z.int().nullable(),
    consentSignedOn: schoolDateSchema.nullable(),
    scholarship: scholarshipSchema,
    contracts: z.array(z.strictObject({ number: z.string(), signedOn: schoolDateSchema })),
    /**
     * The records merged into this one (task 3.3d, pull request #98): each
     * merged record's UIDs, the moment and reason of the merge, and the
     * personal values it held, archived on the merge (decision 1).
     */
    merged: z.array(
      z.strictObject({
        uids: z.array(z.string()),
        mergedAt: z.iso.datetime(),
        reason: z.string(),
        values: z.array(z.strictObject({ field: studentMergeFieldSchema, value: z.string() })),
      }),
    ),
    statuses: z.array(
      z.strictObject({
        status: studentStatusSchema,
        from: schoolDateSchema,
        until: schoolDateSchema.nullable(),
        cause: statusCauseSchema,
        reason: z.string().nullable(),
      }),
    ),
    account: portalAccountSchema.nullable(),
  }),
  /** Every relative ever linked to the student, with every link (decision 2). */
  relatives: z.array(
    z.strictObject({
      id: z.uuid(),
      fullName: z.string(),
      phone: z.string().nullable(),
      extraPhones: z.array(z.string()),
      workplace: z.string().nullable(),
      email: z.string().nullable(),
      phoneInvalidSince: z.iso.datetime().nullable(),
      archivedAt: z.iso.datetime().nullable(),
      merged: z.boolean(),
      account: portalAccountSchema.nullable(),
      links: z.array(studentLinkSchema),
    }),
  ),
});

export type StudentReport = z.infer<typeof studentReportSchema>;

export const staffReportSchema = z.strictObject({
  kind: z.literal('staff'),
  ...reportBase,
  staff: z.strictObject({
    id: z.uuid(),
    staffId: staffIdSchema,
    firstName: z.string(),
    lastName: z.string(),
    fatherName: z.string().nullable(),
    sex: sexSchema.nullable(),
    birthDate: schoolDateSchema.nullable(),
    jshshir: z.string().nullable(),
    educationLevel: educationLevelSchema.nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    admissionDate: schoolDateSchema.nullable(),
    contractType: contractTypeSchema.nullable(),
    contractDate: schoolDateSchema.nullable(),
    weeklyLessons: z.int().nullable(),
    dailyLessons: z.int().nullable(),
    photoId: z.uuid().nullable(),
    branches: z.array(z.strictObject({ name: z.string(), main: z.boolean() })),
    divisions: z.array(
      z.strictObject({
        division: namesSchema,
        department: namesSchema.nullable(),
        main: z.boolean(),
      }),
    ),
    subjects: z.array(z.strictObject({ subject: namesSchema, grades: z.array(z.int()) })),
    languages: z.array(instructionLanguageSchema),
    statuses: z.array(
      z.strictObject({
        status: staffStatusSchema,
        from: schoolDateSchema,
        until: schoolDateSchema.nullable(),
      }),
    ),
    /** Availability of every branch, each entry with its dates and time ranges. */
    availability: z.array(
      z.strictObject({
        branch: z.string(),
        from: schoolDateSchema,
        /** `null` while open-ended. */
        until: schoolDateSchema.nullable(),
        ranges: z.array(
          z.strictObject({
            /** 1 Monday … 7 Sunday. */
            weekday: z.int().min(1).max(7),
            startMinutes: z.int().min(0),
            endMinutes: z.int().min(0),
          }),
        ),
      }),
    ),
  }),
  /** The relative record marked as the same person (task 2.5b-2). */
  sameAsRelative: z.strictObject({ id: z.uuid(), fullName: z.string() }).nullable(),
  account: z
    .strictObject({
      login: z.string(),
      createdAt: z.iso.datetime(),
      /** The latest sign-in that opened a session; `null` when there was none. */
      lastSignInAt: z.iso.datetime().nullable(),
      /** No sign-in since the start of the current employment period (task 2.3c-1). */
      neverUsed: z.boolean(),
      language: z.string(),
      lockedAt: z.iso.datetime().nullable(),
      lockReason: z.string().nullable(),
      mustChangePassword: z.boolean(),
      passwordChangedAt: z.iso.datetime().nullable(),
      passwordResetAt: z.iso.datetime().nullable(),
      secondStepOn: z.boolean(),
      /** Every role given, ended ones too, oldest first. */
      roles: z.array(
        z.strictObject({
          role: roleSchema,
          /** `null` for a role with no branch (Super Admin, Senior Head Teacher). */
          branch: z.string().nullable(),
          from: z.iso.datetime(),
          until: z.iso.datetime().nullable(),
          /** The subjects of a Head Teacher's appointment, each with its own dates. */
          subjects: z.array(
            z.strictObject({
              subject: namesSchema,
              from: z.iso.datetime(),
              until: z.iso.datetime().nullable(),
            }),
          ),
        }),
      ),
    })
    .nullable(),
});

export type StaffReport = z.infer<typeof staffReportSchema>;

export const relativeReportSchema = z.strictObject({
  kind: z.literal('relative'),
  ...reportBase,
  relative: z.strictObject({
    id: z.uuid(),
    fullName: z.string(),
    phone: z.string().nullable(),
    extraPhones: z.array(z.string()),
    workplace: z.string().nullable(),
    email: z.string().nullable(),
    phoneInvalidSince: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    account: portalAccountSchema.nullable(),
  }),
  /** The staff record marked as the same person (task 2.5b-2). */
  samePerson: z
    .strictObject({ id: z.uuid(), name: z.string(), staffId: staffIdSchema.nullable() })
    .nullable(),
  /** Every link to a student in every branch, live and ended (decision 1). */
  links: z.array(
    studentLinkSchema.extend({
      student: z.strictObject({
        id: z.uuid(),
        uid: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        branch: z.string(),
      }),
    }),
  ),
});

export type RelativeReport = z.infer<typeof relativeReportSchema>;

export const personalDataReportSchema = z.discriminatedUnion('kind', [
  studentReportSchema,
  staffReportSchema,
  relativeReportSchema,
]);

export type PersonalDataReport = z.infer<typeof personalDataReportSchema>;

export const personalDataParamsSchema = z.object({ id: z.uuid() });

export type PersonalDataParams = z.infer<typeof personalDataParamsSchema>;
