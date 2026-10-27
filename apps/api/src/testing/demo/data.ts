/**
 * The invented school of the demo (`CLAUDE.md`, No real personal data): every
 * name below is made up from common first and last names, never a real
 * person's record. Branch, class and subject names are those of any school.
 */

/** Mulberry32: the same school for the same seed, so two runs are alike. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export const MALE_FIRST = [
  'Akmal',
  'Bekzod',
  'Bobur',
  'Davron',
  'Elyor',
  'Farrux',
  'Gayrat',
  'Ibrohim',
  'Jahongir',
  'Javlon',
  'Kamron',
  'Laziz',
  'Mirjalol',
  'Nodir',
  'Otabek',
  'Rustam',
  'Sanjar',
  'Sardor',
  'Temur',
  'Umid',
  'Xurshid',
  'Yusuf',
  'Zafar',
  'Shoxruh',
] as const;

export const FEMALE_FIRST = [
  'Aziza',
  'Barno',
  'Dildora',
  'Dilnoza',
  'Feruza',
  'Gulnoza',
  'Hilola',
  'Kamola',
  'Laylo',
  'Madina',
  'Malika',
  'Mohira',
  'Nargiza',
  'Nigora',
  'Nilufar',
  'Ozoda',
  'Robiya',
  'Sabina',
  'Sevara',
  'Shahlo',
  'Umida',
  'Yulduz',
  'Zarina',
  'Zilola',
] as const;

/** The male form; the female form adds `a` (`Karimov`, `Karimova`). */
export const LAST_NAMES = [
  'Abdullayev',
  'Aliyev',
  'Azimov',
  'Ergashev',
  'Hasanov',
  'Ibragimov',
  'Ismoilov',
  'Jurayev',
  'Karimov',
  'Mahmudov',
  'Mirzayev',
  'Nazarov',
  'Normatov',
  'Olimov',
  'Qodirov',
  'Rahimov',
  'Rashidov',
  'Saidov',
  'Sobirov',
  'Sultonov',
  'Tursunov',
  'Umarov',
  'Usmonov',
  'Valiyev',
  'Xolmatov',
  'Yoqubov',
  'Yusupov',
  'Zokirov',
] as const;

export type Sex = 'male' | 'female';

/** A person's name and sex from the seeded random source. */
export function personName(random: () => number): { first: string; last: string; sex: Sex } {
  const sex: Sex = random() < 0.5 ? 'male' : 'female';
  const firsts = sex === 'male' ? MALE_FIRST : FEMALE_FIRST;
  const first = firsts[Math.floor(random() * firsts.length)] ?? 'Aziza';
  const stem = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)] ?? 'Karimov';
  return { first, last: sex === 'male' ? stem : `${stem}a`, sex };
}

/** A department of the Academic division, by its English name (0015). */
export type Department =
  'STEAM' | 'Natural sciences' | 'National' | 'Foreign languages' | 'General';

export interface DemoSubject {
  readonly en: string;
  readonly uz: string;
  readonly ru: string;
  readonly department: Department;
  readonly colour: string;
  readonly grades: readonly number[];
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export const SUBJECTS: readonly DemoSubject[] = [
  {
    en: 'Mathematics',
    uz: 'Matematika',
    ru: 'Математика',
    department: 'STEAM',
    colour: 'blue',
    grades: ALL,
  },
  {
    en: 'Native language',
    uz: 'Ona tili',
    ru: 'Родной язык',
    department: 'National',
    colour: 'red',
    grades: ALL,
  },
  {
    en: 'Literature',
    uz: 'Adabiyot',
    ru: 'Литература',
    department: 'National',
    colour: 'pink',
    grades: ALL,
  },
  {
    en: 'Russian',
    uz: 'Rus tili',
    ru: 'Русский язык',
    department: 'Foreign languages',
    colour: 'violet',
    grades: ALL,
  },
  {
    en: 'English',
    uz: 'Ingliz tili',
    ru: 'Английский язык',
    department: 'Foreign languages',
    colour: 'indigo',
    grades: ALL,
  },
  {
    en: 'History',
    uz: 'Tarix',
    ru: 'История',
    department: 'National',
    colour: 'brown',
    grades: ALL,
  },
  {
    en: 'Geography',
    uz: 'Geografiya',
    ru: 'География',
    department: 'Natural sciences',
    colour: 'teal',
    grades: ALL,
  },
  {
    en: 'Biology',
    uz: 'Biologiya',
    ru: 'Биология',
    department: 'Natural sciences',
    colour: 'green',
    grades: ALL,
  },
  { en: 'Physics', uz: 'Fizika', ru: 'Физика', department: 'STEAM', colour: 'cyan', grades: ALL },
  {
    en: 'Chemistry',
    uz: 'Kimyo',
    ru: 'Химия',
    department: 'Natural sciences',
    colour: 'lime',
    grades: ALL,
  },
  {
    en: 'Informatics',
    uz: 'Informatika',
    ru: 'Информатика',
    department: 'STEAM',
    colour: 'amber',
    grades: ALL,
  },
  {
    en: 'Art',
    uz: "Tasviriy san'at",
    ru: 'Изобразительное искусство',
    department: 'General',
    colour: 'orange',
    grades: ALL,
  },
  {
    en: 'Physical education',
    uz: 'Jismoniy tarbiya',
    ru: 'Физкультура',
    department: 'General',
    colour: 'green',
    grades: ALL,
  },
  {
    en: 'Technology',
    uz: 'Texnologiya',
    ru: 'Технология',
    department: 'STEAM',
    colour: 'amber',
    grades: ALL,
  },
];

/** How a subject is taught in a grade: whole class, in groups across a pair of classes, or in halves. */
export type Way = 'whole' | 'groups' | 'split';

export interface CurriculumLine {
  readonly subject: string;
  readonly perWeek: number;
  readonly way: Way;
  readonly roomType?: 'classroom' | 'laboratory' | 'sports_hall' | 'other';
}

/** The weekly load of a class of grades 5 to 9: 28 to 30 lessons. */
export function curriculumOf(grade: number): CurriculumLine[] {
  return [
    { subject: 'Mathematics', perWeek: 5, way: 'whole' },
    { subject: 'Native language', perWeek: 3, way: 'whole' },
    { subject: 'Literature', perWeek: 2, way: 'whole' },
    { subject: 'Russian', perWeek: 2, way: 'whole' },
    { subject: 'English', perWeek: 3, way: 'groups' },
    { subject: 'History', perWeek: 2, way: 'whole' },
    { subject: 'Geography', perWeek: 2, way: 'whole' },
    { subject: 'Biology', perWeek: 2, way: 'whole' },
    ...(grade >= 7
      ? [
          { subject: 'Physics', perWeek: 2, way: 'whole' as const },
          {
            subject: 'Chemistry',
            perWeek: 2,
            way: 'whole' as const,
            roomType: 'laboratory' as const,
          },
        ]
      : [{ subject: 'Art', perWeek: 1, way: 'whole' as const }]),
    { subject: 'Informatics', perWeek: 1, way: 'whole' },
    { subject: 'Physical education', perWeek: 2, way: 'split', roomType: 'sports_hall' },
    { subject: 'Technology', perWeek: 2, way: 'split', roomType: 'other' },
  ];
}

export interface DemoBranch {
  readonly name: string;
  readonly address: string;
  /** The classes of the branch: grade and name. */
  readonly classes: readonly { grade: number; name: string }[];
}

export const BRANCHES: readonly DemoBranch[] = [
  {
    name: 'Demo Yunusobod',
    address: 'Demo street 1, Yunusobod, Tashkent',
    classes: [
      { grade: 5, name: 'Oxford' },
      { grade: 5, name: 'Cambridge' },
      { grade: 7, name: 'Oxford' },
      { grade: 7, name: 'Princeton' },
      { grade: 9, name: 'Yale' },
    ],
  },
  {
    name: 'Demo Chilonzor',
    address: 'Demo street 2, Chilonzor, Tashkent',
    classes: [
      { grade: 6, name: 'Oxford' },
      { grade: 6, name: 'Cambridge' },
    ],
  },
];

/** The school year of the demo: 2 September 2026 to 25 May 2027, four quarters. */
export const YEAR = { startDate: '2026-09-02', endDate: '2027-05-25' } as const;

export const QUARTERS = [
  { number: 1, startDate: '2026-09-02', endDate: '2026-10-31' },
  { number: 2, startDate: '2026-11-09', endDate: '2026-12-26' },
  { number: 3, startDate: '2027-01-11', endDate: '2027-03-20' },
  { number: 4, startDate: '2027-03-30', endDate: '2027-05-25' },
] as const;

/** Every timetable is published from the first school day. */
export const TIMETABLE_START = '2026-09-02';

/** The day off of the demo (Teachers' Day). */
export const DAY_OFF = { name: "Teachers' Day", date: '2026-10-01' } as const;

/** The setup is done in the week before the year: Monday 24 August 2026, 10:00 in Tashkent. */
export const SETUP_MOMENT = '2026-08-24T10:00:00+05:00';

export const STUDENTS_PER_CLASS = 18;
/** A teacher teaches about this many lessons a week; the count of teachers of a subject follows. */
export const LESSONS_PER_TEACHER = 20;
