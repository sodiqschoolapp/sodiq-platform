import { EXPORT_TEXTS, type ExportList, type Language } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fileNameOf } from './use-export';

type Texts = typeof en;

const LOCALES: Record<Language, Texts> = { en, ru, uz };

/**
 * The text key each list header of the screen uses, by list and column: the
 * page tests show that the English headers are the file's; this ties the
 * Russian and Uzbek ones too, so the file and the screen cannot drift
 * (task 2.2c-1, pull request #58).
 */
const SCREEN: Record<ExportList, Record<string, (texts: Texts) => string>> = {
  staff: {
    name: (texts) => texts.people.staff.name,
    staffId: (texts) => texts.people.staff.staffId,
    category: (texts) => texts.people.staff.categories,
    branches: (texts) => texts.people.staff.branches,
    department: (texts) => texts.people.staff.department,
    subjects: (texts) => texts.people.staff.subjects,
    grades: (texts) => texts.people.staff.grades,
    languages: (texts) => texts.people.staff.languagesTitle,
    phone: (texts) => texts.people.staff.phone,
    status: (texts) => texts.people.staff.statusColumn,
  },
  vacancies: {
    name: (texts) => texts.people.vacancies.name,
    department: (texts) => texts.people.vacancies.department,
    subjects: (texts) => texts.people.vacancies.subjects,
    grades: (texts) => texts.people.staff.grades,
    languages: (texts) => texts.people.staff.languagesTitle,
    weeklyLessons: (texts) => texts.people.staff.weeklyLessons,
    status: (texts) => texts.people.vacancies.statusTitle,
  },
  buildings: {
    name: (texts) => texts.setup.buildings.name,
    floors: (texts) => texts.setup.buildings.floors,
    rooms: (texts) => texts.setup.buildings.rooms,
    status: (texts) => texts.setup.buildings.status,
  },
  rooms: {
    name: (texts) => texts.setup.rooms.name,
    building: (texts) => texts.setup.rooms.building,
    floor: (texts) => texts.setup.rooms.floor,
    type: (texts) => texts.setup.rooms.type,
    capacity: (texts) => texts.setup.rooms.capacity,
    status: (texts) => texts.setup.rooms.status,
    shared: (texts) => texts.setup.rooms.shared,
  },
  divisions: {
    name: (texts) => texts.setup.divisions.name,
    departments: (texts) => texts.setup.divisions.departments,
    staff: (texts) => texts.setup.divisions.staff,
    status: (texts) => texts.setup.divisions.status,
  },
  subjects: {
    name: (texts) => texts.setup.subjects.name,
    department: (texts) => texts.setup.subjects.department,
    grades: (texts) => texts.setup.subjects.grades,
    journalType: (texts) => texts.setup.subjects.journalType,
    ratingExam: (texts) => texts.setup.subjects.ratingExam,
    daily: (texts) => texts.setup.subjects.daily,
    quarterly: (texts) => texts.setup.subjects.quarterlyMissing,
    switches: (texts) => texts.setup.subjects.switches,
    status: (texts) => texts.setup.subjects.status,
  },
  // Task 2.4b-2: the list's headers, then the export-only columns named as the profile names the field.
  students: {
    uid: (texts) => texts.people.students.uid,
    name: (texts) => texts.people.students.name,
    class: (texts) => texts.people.students.class,
    status: (texts) => texts.people.students.status,
    paternalName: (texts) => texts.people.students.paternalName,
    sex: (texts) => texts.people.students.sex,
    grade: (texts) => texts.people.students.grade,
    startsOn: (texts) => texts.people.students.startsOn,
    phone: (texts) => texts.people.students.phone,
    email: (texts) => texts.people.students.email,
    birthDate: (texts) => texts.people.students.birthDate,
    documentType: (texts) => texts.people.students.documentType,
    documentNumber: (texts) => texts.people.students.documentNumber,
    jshshir: (texts) => texts.people.students.jshshir,
    address: (texts) => texts.people.students.address,
    region: (texts) => texts.people.students.region,
    contractNumber: (texts) => texts.people.students.contractNumber,
    contractSignedOn: (texts) => texts.people.students.contractSignedOn,
    scholarshipType: (texts) => texts.people.students.scholarshipType,
    scholarshipCoverage: (texts) => texts.people.students.scholarshipCoverage,
    scholarshipAmount: (texts) => texts.people.students.scholarshipAmount,
    previousSchool: (texts) => texts.people.students.previousSchool,
    diagnosticScore: (texts) => texts.people.students.diagnosticScore,
    consentSignedOn: (texts) => texts.people.students.consentSignedOn,
    // Task 2.5b-2: the relatives, Contact columns.
    mainContactName: (texts) => texts.people.students.mainContactName,
    mainContactRelationship: (texts) => texts.people.students.mainContactRelationship,
    mainContactPhone: (texts) => texts.people.students.mainContactPhone,
    mainContactExtraPhones: (texts) => texts.people.students.mainContactExtraPhones,
    otherRelatives: (texts) => texts.people.students.otherRelatives,
  },
};

describe('the headings of the export files', () => {
  it('are the headers of the lists on the screen, in the three languages', () => {
    for (const language of ['en', 'ru', 'uz'] as const) {
      for (const [list, columns] of Object.entries(SCREEN)) {
        const file: Record<string, string> = EXPORT_TEXTS[language][list as ExportList].columns;
        expect(Object.keys(columns).sort(), list).toEqual(Object.keys(file).sort());
        for (const [key, header] of Object.entries(columns)) {
          expect(file[key], `${language} ${list} ${key}`).toBe(header(LOCALES[language]));
        }
      }
    }
  });

  it('name the values as the screen does', () => {
    for (const language of ['en', 'ru', 'uz'] as const) {
      const file = EXPORT_TEXTS[language];
      const screen = LOCALES[language];
      expect(file.roles).toEqual(screen.roles);
      expect(file.staffStatuses).toEqual(screen.people.staff.statuses);
      expect(file.instructionLanguages).toEqual(screen.people.staff.languages);
      expect(file.vacancyStatuses).toEqual(screen.people.vacancies.statuses);
      expect(file.roomTypes).toEqual(screen.setup.rooms.types);
      expect(file.roomStatuses).toEqual(screen.setup.rooms.statuses);
      expect(file.journalTypes).toEqual(screen.setup.subjects.journalTypes);
      expect(file.notStarted).toBe(screen.people.staff.notStarted);
      expect(file.grade).toBe(screen.setup.subjects.grade);
      // Task 2.4b-2: the student file.
      expect(file.student.statuses).toEqual(screen.people.students.statuses);
      expect(file.student.notStarted).toBe(screen.people.students.notStarted);
      expect(file.student.gradeNoClass).toBe(screen.people.students.gradeNoClass);
      expect(file.student.sexes).toEqual(screen.people.staff.sexes);
      expect(file.student.documentTypes).toEqual(screen.people.students.documentTypes);
      expect(file.student.regions).toEqual(screen.people.students.regions);
      expect(file.student.scholarshipTypes).toEqual(screen.people.students.scholarshipTypes);
      expect(file.student.scholarshipCoverages).toEqual(
        screen.people.students.scholarshipCoverages,
      );
      // Task 2.5b-2: the relationship of the main contact, as the Relatives tab names it.
      expect(file.student.relationships).toEqual(screen.people.relatives.relationships);
    }
  });
});

describe('the name of a saved file', () => {
  it('is the real name of filename*, else the ASCII one, else the name of the list', () => {
    expect(
      fileNameOf(
        `attachment; filename="rooms.xlsx"; filename*=UTF-8''${encodeURIComponent('Кабинеты.xlsx')}`,
        'x.xlsx',
      ),
    ).toBe('Кабинеты.xlsx');
    expect(fileNameOf('attachment; filename="rooms.xlsx"', 'x.xlsx')).toBe('rooms.xlsx');
    expect(fileNameOf(`attachment; filename*=UTF-8''%E0%A4%A`, 'x.xlsx')).toBe('x.xlsx');
    expect(fileNameOf(null, 'x.xlsx')).toBe('x.xlsx');
  });
});
