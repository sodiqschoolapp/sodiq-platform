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
  // Task 3.4c: the start date of a department move.
  departmentStartsOn: 'people.staff.departmentStartsOn',
  // Task 3.6b-3: a planned move cancelled.
  departmentMoveCancelled: 'people.staff.departmentMoveCancelled',
  branches: 'people.staff.branches',
  subjects: 'people.staff.subjects',
  grades: 'people.staff.grades',
  languages: 'people.staff.languagesTitle',
  status: 'people.staff.statusColumn',
};

const RELATIVE: Record<string, ParseKeys> = {
  fullName: 'people.relatives.fullNameField',
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
  // Task 3.4c: the start date of a department move.
  departmentStartsOn: 'setup.subjects.departmentStartsOn',
  // Task 3.6b-3: a planned move cancelled.
  departmentMoveCancelled: 'setup.subjects.departmentMoveCancelled',
  grades: 'setup.subjects.grades',
  colour: 'setup.subjects.colour',
  journalType: 'setup.subjects.journalType',
};

const YEAR: Record<string, ParseKeys> = {
  name: 'setup.years.name',
  startDate: 'setup.years.startDate',
  endDate: 'setup.years.endDate',
  status: 'setup.years.status',
  quarters: 'setup.years.quarters',
};

const CALENDAR: Record<string, ParseKeys> = {
  name: 'setup.calendar.name',
  kind: 'setup.calendar.kind',
  firstDate: 'setup.calendar.firstDate',
  lastDate: 'setup.calendar.lastDate',
  gradeFrom: 'setup.calendar.gradeFrom',
  gradeTo: 'setup.calendar.gradeTo',
  examWeek: 'setup.calendar.examWeek',
};

const SLOT_TYPE: Record<string, ParseKeys> = {
  name: 'setup.slotTypes.name',
  kind: 'setup.slotTypes.kind',
  length: 'setup.slotTypes.length',
  validFrom: 'setup.slotTypes.from',
  validUntil: 'setup.slotTypes.until',
};

const DAY_TEMPLATE: Record<string, ParseKeys> = {
  name: 'setup.dayTemplates.name',
  slots: 'setup.dayTemplates.slots',
  startTime: 'setup.dayTemplates.startTime',
  validFrom: 'setup.dayTemplates.from',
  validUntil: 'setup.dayTemplates.until',
  weekday: 'setup.templateSettings.weekday',
  gradeFrom: 'setup.templateSettings.gradeFrom',
  gradeTo: 'setup.templateSettings.gradeTo',
};

const BRANCH: Record<string, ParseKeys> = {
  name: 'setup.branch.name',
  address: 'setup.branch.address',
  phone: 'setup.branch.phone',
  email: 'setup.branch.email',
  workingWeekdays: 'setup.branch.workingWeekdays',
  timeZone: 'setup.branch.timeZone',
  goLiveDate: 'setup.branch.goLiveDate',
  minutes: 'setup.travelTimes.minutes',
};

const SETTINGS: Record<string, ParseKeys> = {
  editDays: 'setup.settings.editDays',
  lateValue: 'setup.settings.lateValue',
  skippedValue: 'setup.settings.skippedValue',
};

const VACANCY: Record<string, ParseKeys> = {
  name: 'people.vacancies.name',
  department: 'people.vacancies.department',
  departmentId: 'people.vacancies.department',
  subjects: 'people.vacancies.subjects',
  weeklyLessons: 'people.staff.weeklyLessons',
  dailyLessons: 'people.staff.dailyLessons',
  languages: 'people.staff.languagesTitle',
  status: 'people.vacancies.statusTitle',
};

const ACCOUNT: Record<string, ParseKeys> = {
  login: 'people.account.login',
  role: 'people.account.role',
  branchId: 'people.account.branch',
  validUntil: 'people.account.validUntil',
};

const LABELS: Record<string, Record<string, ParseKeys>> = {
  student: STUDENT,
  staff: STAFF,
  relative: RELATIVE,
  room: ROOM,
  building: { name: 'setup.buildings.name', status: 'setup.buildings.status' },
  floor: { name: 'setup.rooms.floor' },
  division: NAMED,
  department: NAMED,
  subject: SUBJECT,
  subject_daily_weights: SUBJECT,
  subject_quarter_weights: SUBJECT,
  academic_year: YEAR,
  quarters: YEAR,
  calendar_entry: CALENDAR,
  slot_type: SLOT_TYPE,
  day_template: DAY_TEMPLATE,
  day_template_assignment: DAY_TEMPLATE,
  branch: BRANCH,
  travel_time: BRANCH,
  settings: SETTINGS,
  quarter: SETTINGS,
  vacancy: VACANCY,
  account: ACCOUNT,
  assignment: ACCOUNT,
};

/**
 * The stored codes of a field shown in the language of the page (spec review
 * of the build: a code is not a word): the field's key to the place of its
 * names in the locale files. Codes of other fields are shown as stored.
 */
const CODES: Record<string, string> = {
  sex: 'people.staff.sexes',
  relationship: 'people.relatives.relationships',
  role: 'roles',
  educationLevel: 'people.staff.educationLevels',
  contractType: 'people.staff.contractTypes',
  documentType: 'people.students.documentTypes',
  region: 'people.students.regions',
  scholarshipType: 'people.students.scholarshipTypes',
  scholarshipCoverage: 'people.students.scholarshipCoverages',
  journalType: 'setup.subjects.journalTypes',
};

/** Where the names of the stored codes of a field are, for a record type. */
export function codesOf(type: string, key: string): string | undefined {
  const field = camelCase(key);
  if (field === 'status') {
    return type === 'student'
      ? 'people.students.statuses'
      : type === 'staff'
        ? 'people.staff.statuses'
        : undefined;
  }
  return CODES[field];
}

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
