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
/** Extra phones of one relative, at most (task 2.5b-2, decision 2; `relative_extra_phones_valid` of 0038). */
export const RELATIVE_EXTRA_PHONES_MAX = 3;
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

/**
 * Extra phones (`edge/close-relatives`, row 5: "Extra phones can be added;
 * they are not unique and not used for sign-in"; task 2.5b-2, decision 2):
 * at most three, each of the main phone's shape, none twice. One equal to the
 * main phone passes, as in the database.
 */
export const relativeExtraPhonesSchema = z
  .array(relativePhoneSchema)
  .max(RELATIVE_EXTRA_PHONES_MAX)
  .refine((phones) => new Set(phones).size === phones.length, {
    message: 'A phone is given twice.',
  });

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
 * phone of their own", decision 8), the workplace, the email (`04`) and the
 * extra phones (task 2.5b-2; none when left out of a new relative).
 */
export const relativeRecordSchema = z.strictObject({
  fullName: relativeNameSchema,
  phone: relativePhoneSchema.nullable(),
  workplace: optionalText(RELATIVE_WORKPLACE_MAX_LENGTH),
  email: optionalEmailSchema,
  extraPhones: relativeExtraPhonesSchema.default([]),
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
 * "Different person, the number has a new owner" (`edge/close-relatives`,
 * row 2; task 2.5b-1): the earlier relative, as the phone match showed it,
 * and their new phone, or `null` for "no valid phone". The new phone is
 * never the number that changed hands.
 */
export const relativeNewOwnerSchema = z.strictObject({
  previousId: z.uuid(),
  previousPhone: relativePhoneSchema.nullable(),
});

export type RelativeNewOwner = z.infer<typeof relativeNewOwnerSchema>;

/** The new phone of the earlier relative as typed on the refused phone change; `null` for "unknown". */
export const relativePreviousPhoneSchema = relativeNewOwnerSchema.pick({ previousPhone: true });

/**
 * One relative linked to a student: a new record, the existing one the
 * phone match showed, with the phone it was found by (decision 18: the save
 * is refused `relative_phone_changed` when that phone moved meanwhile), or a
 * new record that takes the phone of the one the match showed (task 2.5b-1).
 */
export const relativeLinkInputSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('new'), relative: relativeRecordSchema, ...linkFields }),
    z.strictObject({
      kind: z.literal('existing'),
      relativeId: z.uuid(),
      phone: relativePhoneSchema,
      ...linkFields,
    }),
    z.strictObject({
      kind: z.literal('new_owner'),
      relative: relativeRecordSchema.extend({ phone: relativePhoneSchema }),
      ...relativeNewOwnerSchema.shape,
      ...linkFields,
    }),
  ])
  .refine((link) => link.kind !== 'new_owner' || link.previousPhone !== link.relative.phone, {
    message: 'The earlier relative needs another phone.',
    path: ['previousPhone'],
  });

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
      const keys = links.flatMap((link) => {
        if (link.kind === 'existing') {
          return [link.relativeId, link.phone];
        }
        if (link.kind === 'new_owner') {
          return [
            link.previousId,
            link.relative.phone,
            ...(link.previousPhone === null ? [] : [link.previousPhone]),
          ];
        }
        return link.relative.phone === null ? [] : [link.relative.phone];
      });
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

/**
 * The staff member whose phone is typed (`edge/close-relatives`, "A teacher
 * is also a parent"; task 3.6b-1): the new relative will be the same person
 * and takes these details, when the staff member is of the branch of the
 * request (decision 2, Look first).
 */
export const relativeStaffMatchSchema = z.object({
  fullName: z.string(),
  email: z.string().nullable(),
});

export type RelativeStaffMatch = z.infer<typeof relativeStaffMatchSchema>;

export const relativePhoneMatchResultSchema = z.object({
  holder: relativeHolderSchema.nullable(),
  /** A staff member of the branch of the request has the phone. */
  staff: relativeStaffMatchSchema.nullable(),
  /** A staff member of another branch has the phone: marked, nothing of it told (decision 2). */
  staffElsewhere: z.boolean(),
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
  /** "No valid phone" since this moment (task 2.5b-1, decision 3); `null` otherwise. */
  phoneInvalidSince: z.string().nullable(),
});

export type RelativeListItem = z.infer<typeof relativeListItemSchema>;

export const relativeListSchema = z.object({
  relatives: z.array(relativeListItemSchema),
  /** Search by phone: every reader of the list, the Principal included (task 3.6a, decision 7 of pull request #118). */
  searchesPhone: z.boolean(),
  canEdit: z.boolean(),
});

export type RelativeList = z.infer<typeof relativeListSchema>;

/**
 * `search` by name; `phone` by the main phone, for the readers that may (403
 * otherwise); `filter=no_valid_phone`: the relatives with no valid phone and
 * a student of the branch active today (`edge`, row 2; task 2.5b-1).
 */
export const relativeListQuerySchema = z.strictObject({
  filter: z.enum(['no_valid_phone']).optional(),
  search: z.string().trim().max(RELATIVE_NAME_MAX_LENGTH).optional(),
  phone: z
    .string()
    .transform((typed) => typed.replace(/[\s()-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{1,15}$/))
    .optional(),
});

export type RelativeListQuery = z.infer<typeof relativeListQuerySchema>;

/** The number of relatives of the branch with no valid phone and an active student, for the home tile. */
export const relativeNoValidPhoneSchema = z.object({ count: z.int().min(0) });

export type RelativeNoValidPhone = z.infer<typeof relativeNoValidPhoneSchema>;

/** Workplace and email, read as Identity (decision 5, Look first). */
export const relativeIdentitySchema = z.object({
  workplace: z.string().nullable(),
  email: z.string().nullable(),
});

export type RelativeIdentity = z.infer<typeof relativeIdentitySchema>;

/**
 * The staff record that is the same person (`edge/close-relatives`, row 8),
 * read from the phones (task 3.6b-1, decision 3): named only when that staff
 * record is of the branch of the request (task 2.5b-2, decision 9).
 */
export const samePersonSchema = z.object({
  staffId: z.uuid(),
  name: z.string(),
  staffNumber: z.string(),
});

export type SamePerson = z.infer<typeof samePersonSchema>;

/** A relative's page: the record, the students of the branch and the count of the others. */
export const relativeDetailSchema = relativeListItemSchema.extend({
  /** Contact, shown where the main phone is (task 2.5b-2). */
  extraPhones: z.array(z.string()),
  samePerson: samePersonSchema.nullable(),
  /**
   * The relative is the same person as a staff member not of the branch:
   * told, never named (task 3.6b-1, decision 2, Look first).
   */
  samePersonElsewhere: z.boolean(),
  /** `null` for a reader who sees it hidden (the Principal, with a logged show). */
  identity: relativeIdentitySchema.nullable(),
  identityHidden: z.boolean(),
  canEdit: z.boolean(),
});

export type RelativeDetail = z.infer<typeof relativeDetailSchema>;

/**
 * The edit of a relative's record (`04`, Changing a phone). A phone refused
 * as taken may be given with `newOwner`: the holder the phone match shows
 * gets a new phone or "no valid phone" (decision 8 of pull request #73).
 */
export const relativeEditSchema = relativeRecordSchema
  .extend({
    // The whole list, required: a missing field is refused, never a silent clear (task 2.5b-2).
    extraPhones: relativeExtraPhonesSchema,
    newOwner: relativeNewOwnerSchema.nullable().optional(),
  })
  .refine(
    (edit) =>
      edit.newOwner === undefined ||
      edit.newOwner === null ||
      (edit.phone !== null && edit.newOwner.previousPhone !== edit.phone),
    {
      message: 'The new owner needs the phone typed, and the earlier relative another one.',
      path: ['newOwner'],
    },
  );

export type RelativeEdit = z.infer<typeof relativeEditSchema>;

/**
 * The merge of two records of one person (`edge/close-relatives`, row 3;
 * task 2.5b-1, decision 6): the other record, the two phones as the screen
 * showed them (a change meanwhile is refused `relative_changed`), whose
 * phone stays (that record stays, with its id and its Parent account) and
 * whose name. The phone that stays is a phone (correction 1).
 */
export const relativeMergeSchema = z
  .strictObject({
    otherId: z.uuid(),
    thisPhone: relativePhoneSchema.nullable(),
    otherPhone: relativePhoneSchema.nullable(),
    phoneOf: z.enum(['this', 'other']),
    nameOf: z.enum(['this', 'other']),
  })
  .refine((merge) => (merge.phoneOf === 'this' ? merge.thisPhone : merge.otherPhone) !== null, {
    message: 'The phone that stays is a phone.',
    path: ['phoneOf'],
  });

export type RelativeMerge = z.infer<typeof relativeMergeSchema>;

/** A relative as the student's Relatives tab answers it (`02`: "name, relationship and phones of a relative"). */
export const studentRelativeSchema = z.object({
  relativeId: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  /** Contact, beside the main phone (task 2.5b-2). */
  extraPhones: z.array(z.string()),
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
