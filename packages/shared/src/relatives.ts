import { z } from 'zod';
import { staffPhoneSchema } from './staff.js';
import { spellingKey, storedStudentName, validName } from './names.js';

/**
 * Close relatives, the "Parents" of the platform (docs/spec/04-people.md,
 * Close relatives; edge/close-relatives; task 2.5a, pull request #72). The
 * database keeps the same bounds and lists (db/migrations/0036); tests
 * compare them.
 */

/** A relative's full name, one field typed as on the document (decision 15). */
export const RELATIVE_NAME_MAX_LENGTH = 120;
export const RELATIVE_WORKPLACE_MAX_LENGTH = 120;
/** The relatives a student is created with, at most. */
export const STUDENT_RELATIVES_MAX = 10;

/** The relationship, kept on the link (`04`: "the same person can be father of one student and uncle of another"). */
export const RELATIONSHIPS = [
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'uncle',
  'aunt',
  'brother',
  'sister',
  'guardian',
  'other',
] as const;

export const relationshipSchema = z.enum(RELATIONSHIPS);

export type Relationship = z.infer<typeof relationshipSchema>;

/** Decision 15: one full name, Latin or Cyrillic, stored as a student's name is. */
export const relativeNameSchema = z
  .string()
  .transform(storedStudentName)
  .pipe(z.string().min(1).max(RELATIVE_NAME_MAX_LENGTH).refine(validName));

/** The folded name, as `relatives.name_key` stores it and the search compares it. */
export function relativeNameKey(fullName: string): string {
  return spellingKey(fullName);
}

/** The main phone with its country code (decision 9: the staff and student shape). */
export const relativePhoneSchema = staffPhoneSchema;

/**
 * Answer 24: "The \"cannot receive SMS\" warning shows for a number that is
 * not a Uzbek mobile number (+998 followed by 9 and eight digits) and for any
 * foreign number." A warning only.
 */
export function smsCapable(phone: string): boolean {
  return /^\+9989[0-9]{8}$/.test(phone);
}

/**
 * Whether a link sends notices (decision 8): its switch is on and the
 * relative has a phone of their own. The stored switch stays as set.
 */
export function receivesNotices(link: { receivesNotices: boolean }, phone: string | null): boolean {
  return link.receivesNotices && phone !== null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .transform((text) => (text === '' ? null : text))
    .pipe(z.string().max(max).nullable())
    .nullable();

const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((text) => (text === '' ? null : text))
  .pipe(z.email().max(254).nullable())
  .nullable();

/**
 * What is typed for a relative: the full name, the main phone (`null`: "no
 * phone of their own", decision 8), the workplace and the email (`04`).
 */
export const relativeRecordSchema = z.strictObject({
  fullName: relativeNameSchema,
  phone: relativePhoneSchema.nullable(),
  workplace: optionalText(RELATIVE_WORKPLACE_MAX_LENGTH),
  email: optionalEmailSchema,
});

export type RelativeRecord = z.infer<typeof relativeRecordSchema>;

/** What each link carries (`edge`): relationship, main contact, portal access and "receives notices". */
const linkFields = {
  relationship: relationshipSchema,
  mainContact: z.boolean(),
  portalAccess: z.boolean(),
  receivesNotices: z.boolean(),
};

/**
 * One relative linked to a student: a new record, or the existing one the
 * phone match showed, with the phone it was found by (decision 18: the save
 * is refused `relative_phone_changed` when that phone moved meanwhile).
 */
export const relativeLinkInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('new'), relative: relativeRecordSchema, ...linkFields }),
  z.strictObject({
    kind: z.literal('existing'),
    relativeId: z.uuid(),
    phone: relativePhoneSchema,
    ...linkFields,
  }),
]);

export type RelativeLinkInput = z.infer<typeof relativeLinkInputSchema>;

/**
 * The relatives of a new student: exactly one main contact (`edge`), no
 * person twice. None is refused by the route as `student_needs_relative`
 * (`04`: "A student cannot be saved without at least one relative").
 */
export const studentRelativesInputSchema = z
  .array(relativeLinkInputSchema)
  .max(STUDENT_RELATIVES_MAX)
  .refine((links) => links.length === 0 || links.filter((link) => link.mainContact).length === 1, {
    message: 'Exactly one main contact.',
  })
  .refine(
    (links) => {
      const keys = links.flatMap((link) =>
        link.kind === 'existing'
          ? [link.relativeId, link.phone]
          : link.relative.phone === null
            ? []
            : [link.relative.phone],
      );
      return new Set(keys).size === keys.length;
    },
    { message: 'A person or a phone is given twice.' },
  );

/** The phone typed first (`04`, Adding a relative). */
export const relativePhoneMatchSchema = z.strictObject({ phone: relativePhoneSchema });

export type RelativePhoneMatch = z.infer<typeof relativePhoneMatchSchema>;

/**
 * The holder of a phone as a branch may see it (decision 3, Look first): the
 * name and the number of students linked in every branch. `id` is given by
 * the match, which a link then uses; a refused phone change gives it only
 * when the holder is visible in the branch.
 */
export const relativeHolderSchema = z.object({
  id: z.uuid().nullable(),
  fullName: z.string(),
  students: z.int().min(0),
});

export type RelativeHolder = z.infer<typeof relativeHolderSchema>;

export const relativePhoneMatchResultSchema = z.object({
  holder: relativeHolderSchema.nullable(),
});

export type RelativePhoneMatchResult = z.infer<typeof relativePhoneMatchResultSchema>;

/** A student of the branch linked to a relative. */
export const relativeStudentSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  uid: z.string(),
  relationship: relationshipSchema,
  mainContact: z.boolean(),
});

export type RelativeStudent = z.infer<typeof relativeStudentSchema>;

/** A row of the Parents list (decision 7: the main phone is shown there). */
export const relativeListItemSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  students: z.array(relativeStudentSchema),
  /** Students of other branches, as a count (`edge`). */
  elsewhere: z.int().min(0),
});

export type RelativeListItem = z.infer<typeof relativeListItemSchema>;

export const relativeListSchema = z.object({
  relatives: z.array(relativeListItemSchema),
  /** Search by phone: the Super Admin and the Academic Vice Principal (`edge/people-roles-accounts`, Ctrl+K row). */
  searchesPhone: z.boolean(),
  canEdit: z.boolean(),
});

export type RelativeList = z.infer<typeof relativeListSchema>;

/** `search` by name; `phone` by the main phone, for the readers that may (403 otherwise). */
export const relativeListQuerySchema = z.strictObject({
  search: z.string().trim().max(RELATIVE_NAME_MAX_LENGTH).optional(),
  phone: z
    .string()
    .transform((typed) => typed.replace(/[\s()-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{1,15}$/))
    .optional(),
});

export type RelativeListQuery = z.infer<typeof relativeListQuerySchema>;

/** Workplace and email, read as Identity (decision 5, Look first). */
export const relativeIdentitySchema = z.object({
  workplace: z.string().nullable(),
  email: z.string().nullable(),
});

export type RelativeIdentity = z.infer<typeof relativeIdentitySchema>;

/** A relative's page: the record, the students of the branch and the count of the others. */
export const relativeDetailSchema = relativeListItemSchema.extend({
  /** `null` for a reader who sees it hidden (the Principal, with a logged show). */
  identity: relativeIdentitySchema.nullable(),
  identityHidden: z.boolean(),
  canEdit: z.boolean(),
});

export type RelativeDetail = z.infer<typeof relativeDetailSchema>;

/** A relative as the student's Relatives tab answers it (`02`: "name, relationship and phones of a relative"). */
export const studentRelativeSchema = z.object({
  relativeId: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  relationship: relationshipSchema,
  mainContact: z.boolean(),
  /** The link switches, for the `relatives` view holders; `null` otherwise. */
  portalAccess: z.boolean().nullable(),
  receivesNotices: z.boolean().nullable(),
  /** Workplace and email for the Identity readers of decision 5; `null` otherwise. */
  identity: relativeIdentitySchema.nullable(),
});

export type StudentRelative = z.infer<typeof studentRelativeSchema>;

export const studentRelativesSchema = z.object({
  relatives: z.array(studentRelativeSchema),
  /** Add, edit and unlink: `students` edit. */
  canEdit: z.boolean(),
});

export type StudentRelatives = z.infer<typeof studentRelativesSchema>;

/** A change of one link: the main contact moves to it when set (decision 12). */
export const relativeLinkEditSchema = z.strictObject(linkFields);

export type RelativeLinkEdit = z.infer<typeof relativeLinkEditSchema>;

/** The unlink; the main contact names the next one in the same action (`edge`). */
export const relativeUnlinkSchema = z.strictObject({
  newMainContactId: z.uuid().nullable(),
});

export type RelativeUnlink = z.infer<typeof relativeUnlinkSchema>;

export const relativeParamsSchema = z.strictObject({ id: z.uuid() });

export type RelativeParams = z.infer<typeof relativeParamsSchema>;

export const studentRelativeParamsSchema = z.strictObject({
  id: z.uuid(),
  relativeId: z.uuid(),
});

export type StudentRelativeParams = z.infer<typeof studentRelativeParamsSchema>;
