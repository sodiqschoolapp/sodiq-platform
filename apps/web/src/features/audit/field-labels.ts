import type { ParseKeys } from 'i18next';

/**
 * The labels of the fields of a record, as its form names them (correction 2
 * of the plan review of pull request #75: a known field of a known record type
 * is shown with the label its form has; the stored key only for a field with
 * none, an id or a technical key). Keys in camelCase; the snake_case row of a
 * deleted student is read through `camelCase`.
 */
const STUDENT: Record<string, ParseKeys> = {
  uid: 'people.students.uid',
  firstName: 'people.students.firstName',
  lastName: 'people.students.lastName',
  paternalName: 'people.students.paternalName',
  sex: 'people.students.sex',
  birthDate: 'people.students.birthDate',
  grade: 'people.students.grade',
  startsOn: 'people.students.startsOn',
  documentType: 'people.students.documentType',
  documentNumber: 'people.students.documentNumber',
  jshshir: 'people.students.jshshir',
  phone: 'people.students.phone',
  email: 'people.students.email',
  address: 'people.students.address',
  region: 'people.students.region',
  previousSchool: 'people.students.previousSchool',
  diagnosticScore: 'people.students.diagnosticScore',
  contract: 'people.students.contract',
  contracts: 'people.students.contract',
  scholarship: 'people.students.scholarship',
  scholarshipType: 'people.students.scholarshipType',
  scholarshipCoverage: 'people.students.scholarshipCoverage',
  scholarshipAmount: 'people.students.scholarshipAmount',
  consentSignedOn: 'people.students.consentSignedOn',
  status: 'people.students.status',
};

const STAFF: Record<string, ParseKeys> = {
  staffId: 'people.staff.staffId',
  firstName: 'people.staff.firstName',
  lastName: 'people.staff.lastName',
  fatherName: 'people.staff.fatherName',
  sex: 'people.staff.sex',
  birthDate: 'people.staff.birthDate',
  educationLevel: 'people.staff.educationLevel',
  phone: 'people.staff.phone',
  email: 'people.staff.email',
  jshshir: 'people.staff.jshshir',
  admissionDate: 'people.staff.admissionDate',
  contractType: 'people.staff.contractType',
  contractDate: 'people.staff.contractDate',
  weeklyLessons: 'people.staff.weeklyLessons',
  dailyLessons: 'people.staff.dailyLessons',
  divisions: 'people.staff.divisions',
  branches: 'people.staff.branches',
  subjects: 'people.staff.subjects',
  grades: 'people.staff.grades',
  languages: 'people.staff.languagesTitle',
  status: 'people.staff.statusColumn',
};

const RELATIVE: Record<string, ParseKeys> = {
  fullName: 'people.relatives.fullName',
  phone: 'people.relatives.phone',
  workplace: 'people.relatives.workplace',
  email: 'people.relatives.email',
  relationship: 'people.relatives.relationship',
  mainContact: 'people.relatives.mainContact',
  portalAccess: 'people.relatives.portalAccess',
  receivesNotices: 'people.relatives.receivesNotices',
  students: 'people.relatives.students',
};

const ROOM: Record<string, ParseKeys> = {
  name: 'setup.rooms.name',
  type: 'setup.rooms.type',
  capacity: 'setup.rooms.capacity',
  status: 'setup.rooms.status',
  shared: 'setup.rooms.shared',
};

const NAMED: Record<string, ParseKeys> = {
  name: 'setup.divisions.name',
  nameUz: 'setup.divisions.nameUz',
  nameRu: 'setup.divisions.nameRu',
  nameEn: 'setup.divisions.nameEn',
};

const SUBJECT: Record<string, ParseKeys> = {
  ...NAMED,
  department: 'setup.subjects.department',
  departmentId: 'setup.subjects.department',
  grades: 'setup.subjects.grades',
  colour: 'setup.subjects.colour',
  journalType: 'setup.subjects.journalType',
};

const LABELS: Record<string, Record<string, ParseKeys>> = {
  student: STUDENT,
  staff: STAFF,
  relative: RELATIVE,
  room: ROOM,
  building: { name: 'setup.buildings.name', status: 'setup.buildings.status' },
  floor: { name: 'setup.buildings.name' },
  division: NAMED,
  department: NAMED,
  subject: SUBJECT,
};

/** The record type of the fields of an entry: its record, else the start of its action. */
export function fieldsTypeOf(action: string, recordType: string | null): string {
  return recordType ?? action.split('.')[0] ?? '';
}

export const camelCase = (key: string): string =>
  key.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());

/** The label key of a field, or `undefined` for a field the forms do not name. */
export function fieldLabel(type: string, key: string): ParseKeys | undefined {
  const labels = LABELS[type];
  return labels?.[camelCase(key)];
}
