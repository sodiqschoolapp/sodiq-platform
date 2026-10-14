import { describe, expect, it } from 'vitest';
import {
  EXPORT_FILTER_VALUE_MAX_LENGTH,
  EXPORT_FILTERS_MAX,
  EXPORT_LISTS,
  EXPORT_ROWS_MAX,
  EXPORT_SEARCH_MAX_LENGTH,
  EXPORT_TEXTS,
  STAFF_CONTACT_EXPORT_COLUMNS,
  STAFF_EXPORT_COLUMNS,
  staffExportSchema,
  STUDENT_EXPORT_COLUMNS,
  STUDENT_EXPORT_GROUPS,
  STUDENT_LIST_EXPORT_COLUMNS,
  studentExportSchema,
} from './exports.js';
import { LANGUAGES } from './language.js';

const id = (n: number): string => `0190f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`;

// Task 2.2c-1: what the Export button of a list sends (pull request #58,
// decision 10): the ids of the rows, the column keys shown, the search and the
// filters as the list had them.
describe('the export request', () => {
  const request = {
    ids: [id(1), id(2)],
    columns: ['name', 'phone'],
    selection: 'matching',
    search: 'Karimova',
    filters: { status: 'active' },
  };

  it('takes ids, known columns, a search and filters', () => {
    expect(staffExportSchema.parse(request)).toEqual(request);
    expect(
      staffExportSchema.safeParse({ ...request, columns: [...STAFF_EXPORT_COLUMNS] }).success,
    ).toBe(true);
    expect(staffExportSchema.safeParse({ ...request, search: '', filters: {} }).success).toBe(true);
  });

  it('refuses no id, more than the bound, a repeated id and an id that is not a uuid', () => {
    expect(staffExportSchema.safeParse({ ...request, ids: [] }).success).toBe(false);
    const many = Array.from({ length: EXPORT_ROWS_MAX + 1 }, (_, n) => id(n + 1));
    expect(staffExportSchema.safeParse({ ...request, ids: many }).success).toBe(false);
    expect(
      staffExportSchema.safeParse({ ...request, ids: many.slice(0, EXPORT_ROWS_MAX) }).success,
    ).toBe(true);
    expect(staffExportSchema.safeParse({ ...request, ids: [id(1), id(1)] }).success).toBe(false);
    expect(staffExportSchema.safeParse({ ...request, ids: ['1'] }).success).toBe(false);
  });

  it('refuses no column, an unknown column and a repeated one', () => {
    expect(staffExportSchema.safeParse({ ...request, columns: [] }).success).toBe(false);
    expect(staffExportSchema.safeParse({ ...request, columns: ['birthDate'] }).success).toBe(false);
    expect(staffExportSchema.safeParse({ ...request, columns: ['name', 'name'] }).success).toBe(
      false,
    );
  });

  it('refuses a long search, too many filters, a long filter value and fields it does not know', () => {
    expect(
      staffExportSchema.safeParse({
        ...request,
        search: 'a'.repeat(EXPORT_SEARCH_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    const filters = Object.fromEntries(
      Array.from({ length: EXPORT_FILTERS_MAX + 1 }, (_, n) => [`f${String(n)}`, 'x']),
    );
    expect(staffExportSchema.safeParse({ ...request, filters }).success).toBe(false);
    expect(
      staffExportSchema.safeParse({
        ...request,
        filters: { status: 'a'.repeat(EXPORT_FILTER_VALUE_MAX_LENGTH + 1) },
      }).success,
    ).toBe(false);
    expect(staffExportSchema.safeParse({ ...request, branchId: id(9) }).success).toBe(false);
    expect(staffExportSchema.safeParse({ ...request, selection: 'all' }).success).toBe(false);
    expect(staffExportSchema.safeParse({ ...request, search: undefined }).success).toBe(false);
  });

  // Decision 4: the Principal's staff file leaves out the contact columns.
  it('names the phone as the contact column of the staff list', () => {
    expect(STAFF_CONTACT_EXPORT_COLUMNS).toEqual(['phone']);
  });
});

// Task 2.4b-2 (pull request #70): the student file is the page's exported
// columns followed by the export-only columns of the groups of readers.
describe('the student export', () => {
  it('starts with the columns of the list, then the export-only columns', () => {
    expect(STUDENT_EXPORT_COLUMNS.slice(0, STUDENT_LIST_EXPORT_COLUMNS.length)).toEqual([
      ...STUDENT_LIST_EXPORT_COLUMNS,
    ]);
    for (const column of STUDENT_LIST_EXPORT_COLUMNS) {
      expect(STUDENT_EXPORT_GROUPS[column], column).toBe('basic');
    }
  });

  // edge/people-roles-accounts: Contact is "phones of student and relatives",
  // Identity "document numbers, address, date of birth", Financial
  // "contract, scholarship, stipend" (2.4a decision 4 for the rest).
  it('puts every column in the group of readers of its field', () => {
    const of = (group: string) =>
      STUDENT_EXPORT_COLUMNS.filter((column) => STUDENT_EXPORT_GROUPS[column] === group);
    // Task 3.1b: the Tutor of the class joins once classes have Tutors and members.
    expect(of('basic')).toEqual([
      'uid',
      'name',
      'class',
      'tutor',
      'status',
      'paternalName',
      'sex',
      'grade',
      'startsOn',
    ]);
    // Task 2.5b-2, decision 1 (Look first): the relatives are Contact columns.
    expect(of('contact')).toEqual([
      'phone',
      'email',
      'mainContactName',
      'mainContactRelationship',
      'mainContactPhone',
      'mainContactExtraPhones',
      'otherRelatives',
    ]);
    expect(of('identity')).toEqual([
      'birthDate',
      'documentType',
      'documentNumber',
      'jshshir',
      'address',
      'region',
    ]);
    expect(of('financial')).toEqual([
      'contractNumber',
      'contractSignedOn',
      'scholarshipType',
      'scholarshipCoverage',
      'scholarshipAmount',
      'previousSchool',
      'diagnosticScore',
      'consentSignedOn',
    ]);
  });

  it('takes the columns of the file and refuses a column it does not know', () => {
    const request = {
      ids: [id(1)],
      columns: ['uid', 'phone', 'jshshir'],
      selection: 'ticked',
      search: '',
      filters: {},
    };
    expect(studentExportSchema.parse(request)).toEqual(request);
    expect(studentExportSchema.safeParse({ ...request, columns: ['groups'] }).success).toBe(false);
    expect(studentExportSchema.safeParse({ ...request, columns: ['photo'] }).success).toBe(false);
  });
});

// `12`, Language: every export exists in Uzbek, Russian and English.
describe('the texts of the export files', () => {
  const values = (texts: unknown): string[] =>
    typeof texts === 'string'
      ? [texts]
      : Object.values(texts as Record<string, unknown>).flatMap(values);

  it('have every text in the three languages, none empty', () => {
    for (const language of LANGUAGES) {
      const texts = EXPORT_TEXTS[language];
      for (const list of EXPORT_LISTS) {
        expect(texts[list].name.trim(), `${language} ${list}`).not.toBe('');
      }
      for (const text of values(texts)) {
        expect(text.trim(), language).not.toBe('');
      }
    }
  });

  it('write Uzbek oʻ and gʻ with U+02BB, never the keyboard apostrophe', () => {
    for (const text of values(EXPORT_TEXTS.uz)) {
      expect(text, text).not.toMatch(/['`’‘]/);
    }
  });

  // A sheet name of Excel has at most 31 characters and none of : \ / ? * [ ].
  it('give every list a name that Excel takes as a sheet name', () => {
    for (const language of LANGUAGES) {
      for (const list of EXPORT_LISTS) {
        const name = EXPORT_TEXTS[language][list].name;
        expect(name.length, name).toBeLessThanOrEqual(31);
        expect(name, name).not.toMatch(/[:\\/?*[\]]/);
      }
    }
  });
});
