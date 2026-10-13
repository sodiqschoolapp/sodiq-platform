import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIPS,
  receivesNotices,
  relativeListQuerySchema,
  relativeNameKey,
  relativeRecordSchema,
  relativeUnlinkSchema,
  smsCapable,
  studentRelativesInputSchema,
} from './relatives.js';
import { studentCreateSchema } from './students.js';

const newLink = (phone: string | null, mainContact: boolean) => ({
  kind: 'new',
  relative: { fullName: 'Dilfuza Saidova', phone, workplace: '', email: '' },
  relationship: 'mother',
  mainContact,
  portalAccess: true,
  receivesNotices: true,
});

// Task 2.5a (pull request #72): the relative record and its links, as the
// database keeps them (db/migrations/0036). All names are invented.
describe('relative records', () => {
  it('stores a name as typed on the document, Latin or Cyrillic, and folds it for search', () => {
    const parsed = relativeRecordSchema.parse({
      fullName: '  Gʻulom  Oʻtkirov ',
      phone: '+998 90 123-45-67',
      workplace: '  Toshkent shahar shifoxonasi ',
      email: ' A.Otkirov@Example.UZ ',
    });
    expect(parsed).toEqual({
      fullName: 'Gʻulom Oʻtkirov',
      phone: '+998901234567',
      workplace: 'Toshkent shahar shifoxonasi',
      email: 'a.otkirov@example.uz',
    });
    expect(relativeRecordSchema.parse({ ...parsed, fullName: 'Гулом Ўткиров' }).fullName).toBe(
      'Гулом Ўткиров',
    );
    expect(relativeNameKey('Gʻulom Oʻtkirov')).toBe(relativeNameKey('Гулом Ўткиров'));
  });

  it('refuses a mixed script, an empty name and one past 120 letters', () => {
    for (const fullName of ['Gulom Ўткиров', ' ', `A${'a'.repeat(120)}`, 'Gulom 2']) {
      expect(
        relativeRecordSchema.safeParse({ fullName, phone: null, workplace: '', email: '' }).success,
        fullName,
      ).toBe(false);
    }
  });

  it('takes "no phone of their own" as an empty phone and refuses a phone without its code', () => {
    expect(
      relativeRecordSchema.parse({
        fullName: 'Aziz Karimov',
        phone: null,
        workplace: '',
        email: '',
      }).phone,
    ).toBeNull();
    expect(
      relativeRecordSchema.safeParse({
        fullName: 'Aziz Karimov',
        phone: '901234567',
        workplace: '',
        email: '',
      }).success,
    ).toBe(false);
  });

  it('keeps the relationships of the database', () => {
    expect(RELATIONSHIPS).toEqual([
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
    ]);
  });
});

describe('the SMS warning (answer 24)', () => {
  it('passes a Uzbek mobile number only', () => {
    expect(smsCapable('+998901234567')).toBe(true);
    expect(smsCapable('+998991234567')).toBe(true);
    // A landline of Tashkent, a short number and foreign numbers.
    for (const phone of ['+998712345678', '+99890123456', '+79161234567', '+447700900123']) {
      expect(smsCapable(phone), phone).toBe(false);
    }
  });
});

describe('notices (decision 8)', () => {
  it('reach a link with the switch on and a phone of their own', () => {
    expect(receivesNotices({ receivesNotices: true }, '+998901234567')).toBe(true);
    expect(receivesNotices({ receivesNotices: true }, null)).toBe(false);
    expect(receivesNotices({ receivesNotices: false }, '+998901234567')).toBe(false);
  });
});

describe('the relatives of a new student (04, Always connected)', () => {
  it('wants exactly one main contact, and leaves an empty list to the route', () => {
    expect(studentRelativesInputSchema.safeParse([newLink('+998901234567', true)]).success).toBe(
      true,
    );
    // The route answers it `student_needs_relative` (relatives.test.ts).
    expect(studentRelativesInputSchema.safeParse([]).success).toBe(true);
    expect(studentRelativesInputSchema.safeParse([newLink('+998901234567', false)]).success).toBe(
      false,
    );
    expect(
      studentRelativesInputSchema.safeParse([
        newLink('+998901234567', true),
        newLink('+998901234568', true),
      ]).success,
    ).toBe(false);
  });

  it('refuses a phone or a person given twice, and takes two relatives with no phone', () => {
    expect(
      studentRelativesInputSchema.safeParse([
        newLink('+998901234567', true),
        newLink('+998901234567', false),
      ]).success,
    ).toBe(false);
    const existing = {
      kind: 'existing',
      relativeId: '0192b2a4-0000-7000-8000-000000000001',
      phone: '+998901234569',
      relationship: 'father',
      mainContact: false,
      portalAccess: true,
      receivesNotices: true,
    };
    expect(
      studentRelativesInputSchema.safeParse([
        newLink('+998901234567', true),
        existing,
        { ...existing, phone: '+998901234570' },
      ]).success,
    ).toBe(false);
    expect(
      studentRelativesInputSchema.safeParse([newLink(null, true), newLink(null, false), existing])
        .success,
    ).toBe(true);
  });

  it('is a field of the create of a student', () => {
    const shape = studentCreateSchema.safeParse({});
    expect(shape.error?.issues.some((issue) => issue.path[0] === 'relatives')).toBe(true);
  });
});

describe('the unlink and the list query', () => {
  it('names the next main contact or none', () => {
    expect(relativeUnlinkSchema.safeParse({ newMainContactId: null }).success).toBe(true);
    expect(relativeUnlinkSchema.safeParse({}).success).toBe(false);
  });

  it('takes a phone typed with spaces and a part of one', () => {
    expect(relativeListQuerySchema.parse({ phone: '+998 90 12' }).phone).toBe('+9989012');
    expect(relativeListQuerySchema.safeParse({ phone: 'abc' }).success).toBe(false);
  });
});
