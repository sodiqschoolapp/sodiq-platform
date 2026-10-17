import { describe, expect, it } from 'vitest';
import {
  LOAD_PROBLEM_ORDER,
  loadRowProblems,
  isTutorRow,
  refusingProblems,
  teacherProblems,
  type LoadRowFacts,
  type LoadSubject,
  type LoadTeacher,
  type LoadUnit,
} from './load.js';

const YEAR = 'year-2026';

const seventh: LoadUnit = {
  kind: 'class',
  yearId: YEAR,
  archived: false,
  grades: [7],
  language: 'uz',
  subjectId: null,
  tutorOnStart: 'tutor-of-7',
};

const algebra: LoadSubject = {
  id: 'algebra',
  archived: false,
  grades: [7, 8, 9],
  languageRule: true,
  tutorSubject: false,
};

const fit: LoadTeacher = {
  id: 'teacher',
  inBranch: true,
  out: false,
  subjects: [{ subjectId: 'algebra', grades: [7, 8] }],
  languages: ['uz'],
};

const facts = (changes: Partial<LoadRowFacts> = {}): LoadRowFacts => ({
  versionYearId: YEAR,
  unit: seventh,
  subject: algebra,
  teacher: fit,
  room: null,
  sharedSlot: null,
  splitAndWhole: false,
  blockProblems: [],
  unplaced: 0,
  ...changes,
});

// 05, Teaching load; 06, Rules; edge/timetable, Structure; the plan of pull
// request #99 (decisions 2, 7, 8, 11, 13; correction 4). One passing and one
// failing case per problem.
describe('loadRowProblems', () => {
  it('finds nothing for a fitting teacher, class and subject', () => {
    expect(loadRowProblems(facts())).toEqual([]);
  });

  it('refuses a class or group of another year (load_unit_year)', () => {
    expect(loadRowProblems(facts({ unit: { ...seventh, yearId: 'year-2027' } }))).toEqual([
      'load_unit_year',
    ]);
  });

  it('refuses an archived class or group (06: inactive cannot be used)', () => {
    expect(loadRowProblems(facts({ unit: { ...seventh, archived: true } }))).toEqual([
      'load_unit_archived',
    ]);
  });

  it("takes a group's own subject only", () => {
    const group: LoadUnit = { ...seventh, kind: 'group', subjectId: 'algebra', tutorOnStart: null };
    expect(loadRowProblems(facts({ unit: group }))).toEqual([]);
    expect(loadRowProblems(facts({ unit: { ...group, subjectId: 'geometry' } }))).toEqual([
      'load_group_subject',
    ]);
  });

  it('refuses an archived subject (06: inactive subjects cannot be used)', () => {
    expect(loadRowProblems(facts({ subject: { ...algebra, archived: true } }))).toEqual([
      'load_subject_archived',
    ]);
  });

  it('refuses a subject not taught in every grade of the unit', () => {
    const group: LoadUnit = {
      ...seventh,
      kind: 'group',
      grades: [9, 10],
      subjectId: 'algebra',
      tutorOnStart: null,
    };
    const teacher = { ...fit, subjects: [{ subjectId: 'algebra', grades: [9, 10] }] };
    expect(loadRowProblems(facts({ unit: group, teacher }))).toEqual(['load_subject_grade']);
  });

  it('refuses a two-grade group with no shared slot on any school weekday (decision 8)', () => {
    const group: LoadUnit = {
      ...seventh,
      kind: 'group',
      grades: [7, 8],
      subjectId: 'algebra',
      tutorOnStart: null,
    };
    expect(loadRowProblems(facts({ unit: group, sharedSlot: true }))).toEqual([]);
    expect(loadRowProblems(facts({ unit: group, sharedSlot: false }))).toEqual([
      'load_group_no_shared_slot',
    ]);
  });

  it('needs the subject in both grades of a two-grade group (edge/timetable, Structure)', () => {
    const group: LoadUnit = {
      ...seventh,
      kind: 'group',
      grades: [8, 9],
      subjectId: 'algebra',
      tutorOnStart: null,
    };
    expect(loadRowProblems(facts({ unit: group, sharedSlot: true }))).toEqual([
      'load_teacher_grade',
    ]);
  });

  it('refuses a teacher of another branch', () => {
    expect(loadRowProblems(facts({ teacher: { ...fit, inBranch: false } }))).toEqual([
      'load_teacher_branch',
    ]);
  });

  it('refuses a teacher out on the start date, and takes one in (decision 11)', () => {
    expect(loadRowProblems(facts({ teacher: { ...fit, out: true } }))).toEqual([
      'load_teacher_status',
    ]);
  });

  it('names a missing subject and a missing grade apart (decision 9)', () => {
    expect(loadRowProblems(facts({ teacher: { ...fit, subjects: [] } }))).toEqual([
      'load_teacher_subject',
    ]);
    expect(
      loadRowProblems(
        facts({ teacher: { ...fit, subjects: [{ subjectId: 'algebra', grades: [8] }] } }),
      ),
    ).toEqual(['load_teacher_grade']);
  });

  it('needs the language of the unit while the language rule applies (05)', () => {
    const russian = { ...seventh, language: 'ru' };
    expect(loadRowProblems(facts({ unit: russian }))).toEqual(['load_teacher_language']);
    // "With the switch off, any teacher of the subject can take any class."
    expect(
      loadRowProblems(facts({ unit: russian, subject: { ...algebra, languageRule: false } })),
    ).toEqual([]);
  });

  it('binds a vacancy by the same rules (06, Rules)', () => {
    const vacancy: LoadTeacher = { ...fit, id: 'vacancy', languages: ['ru'] };
    expect(loadRowProblems(facts({ teacher: vacancy }))).toEqual(['load_teacher_language']);
    expect(
      loadRowProblems(facts({ teacher: { ...vacancy, out: true, languages: ['uz'] } })),
    ).toEqual(['load_teacher_status']);
    expect(loadRowProblems(facts({ teacher: { ...vacancy, languages: ['uz'] } }))).toEqual([]);
  });

  it('refuses a closed room and takes one in use or under repair (decision 13)', () => {
    expect(loadRowProblems(facts({ room: { closed: true } }))).toEqual(['load_room_closed']);
    expect(loadRowProblems(facts({ room: { closed: false } }))).toEqual([]);
  });

  it('reports every problem in the fixed order, the first being the refusal', () => {
    const problems = loadRowProblems(
      facts({
        unit: { ...seventh, yearId: 'other', archived: true, language: 'ru' },
        subject: { ...algebra, archived: true, grades: [8] },
        teacher: { ...fit, inBranch: false, out: true, subjects: [] },
        room: { closed: true },
      }),
    );
    expect(problems).toEqual([
      'load_unit_year',
      'load_unit_archived',
      'load_subject_archived',
      'load_subject_grade',
      'load_teacher_branch',
      'load_teacher_status',
      'load_teacher_subject',
      'load_teacher_language',
      'load_room_closed',
    ]);
    const order = problems.map((one) => LOAD_PROBLEM_ORDER.indexOf(one));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// Task 3.4b (pull request #100): the block rules, the split-or-whole rule
// and the students not placed, which are listed but never refuse (decision 4).
describe('the problems of a block', () => {
  const group: LoadUnit = { ...seventh, kind: 'group', subjectId: 'algebra', tutorOnStart: null };

  it('reports a class both whole and split for the subject (05, Group)', () => {
    expect(loadRowProblems(facts({ splitAndWhole: true }))).toEqual(['load_split_and_whole']);
  });

  it('reports each block problem in its place in the order', () => {
    const problems = loadRowProblems(
      facts({
        unit: group,
        blockProblems: [
          'load_block_teacher',
          'load_block_lessons',
          'load_block_mixed',
          'load_mixed_not_split',
        ],
        teacher: { ...fit, out: true },
      }),
    );
    expect(problems).toEqual([
      'load_mixed_not_split',
      'load_teacher_status',
      'load_block_mixed',
      'load_block_lessons',
      'load_block_teacher',
    ]);
  });

  it('lists students not placed last, and never as a refusal', () => {
    const problems = loadRowProblems(facts({ unit: group, unplaced: 3, room: { closed: true } }));
    expect(problems).toEqual(['load_room_closed', 'load_group_gaps']);
    expect(refusingProblems(problems)).toEqual(['load_room_closed']);
    expect(refusingProblems(loadRowProblems(facts({ unit: group, unplaced: 1 })))).toEqual([]);
  });
});

// 3.4a decision 2 as narrowed by task 3.6c-2 (decision 1, review correction
// 1): a Tutor row (a Tutor subject on a class row) holds the class's Tutor of
// the version and nobody else, without the profile row; the language rule
// still applies; a group row of a Tutor subject keeps the profile rule. These
// cases replace 3.4a's "a Tutor of the class, or anyone with the profile row".
describe('a Tutor subject', () => {
  const spiritual: LoadSubject = {
    id: 'spiritual',
    archived: false,
    grades: [5, 6, 7, 8, 9, 10, 11],
    languageRule: true,
    tutorSubject: true,
  };
  const tutor: LoadTeacher = {
    id: 'tutor-of-7',
    inBranch: true,
    out: false,
    subjects: [],
    languages: ['uz'],
  };

  it('is a Tutor row on a class only', () => {
    expect(isTutorRow(seventh, spiritual)).toBe(true);
    expect(isTutorRow({ kind: 'group' }, spiritual)).toBe(false);
    expect(isTutorRow(seventh, algebra)).toBe(false);
  });

  it('is taken by the Tutor of the class of the version without a profile row', () => {
    expect(loadRowProblems(facts({ subject: spiritual, teacher: tutor }))).toEqual([]);
  });

  it('has no teacher to take when the class has no Tutor', () => {
    const lonely = { ...seventh, tutorOnStart: null };
    expect(loadRowProblems(facts({ unit: lonely, subject: spiritual, teacher: tutor }))).toEqual([
      'load_no_tutor',
      'load_teacher_subject',
    ]);
  });

  it('is refused for another teacher, also one with the subject in the profile', () => {
    expect(
      loadRowProblems(facts({ subject: spiritual, teacher: { ...tutor, id: 'other' } })),
    ).toEqual(['load_tutor_row_teacher', 'load_teacher_subject']);
    const holder: LoadTeacher = {
      ...tutor,
      id: 'other',
      subjects: [{ subjectId: 'spiritual', grades: [7] }],
    };
    expect(loadRowProblems(facts({ subject: spiritual, teacher: holder }))).toEqual([
      'load_tutor_row_teacher',
    ]);
  });

  it('is refused for the Tutor of another class', () => {
    const otherClass = { ...seventh, tutorOnStart: 'tutor-of-8' };
    expect(
      loadRowProblems(facts({ unit: otherClass, subject: spiritual, teacher: tutor })),
    ).toEqual(['load_tutor_row_teacher', 'load_teacher_subject']);
  });

  it('keeps the profile rule on a group row', () => {
    const group: LoadUnit = {
      ...seventh,
      kind: 'group',
      subjectId: 'spiritual',
      tutorOnStart: null,
    };
    expect(loadRowProblems(facts({ unit: group, subject: spiritual, teacher: tutor }))).toEqual([
      'load_teacher_subject',
    ]);
    const holder: LoadTeacher = { ...tutor, subjects: [{ subjectId: 'spiritual', grades: [7] }] };
    expect(loadRowProblems(facts({ unit: group, subject: spiritual, teacher: holder }))).toEqual(
      [],
    );
  });

  it('is refused for the Tutor without the language of the class', () => {
    expect(
      loadRowProblems(facts({ subject: spiritual, teacher: { ...tutor, languages: ['ru'] } })),
    ).toEqual(['load_teacher_language']);
  });

  it('keeps the profile rule for an ordinary subject, also for the Tutor', () => {
    expect(loadRowProblems(facts({ teacher: tutor }))).toEqual(['load_teacher_subject']);
  });
});

// Every grade set and language of a unit: a teacher whose profile covers
// every grade and language never gets a profile problem (exhaustive over the
// grades 1 to 11 in sets of one and two, and both languages).
describe('teacherProblems over every unit', () => {
  const units: LoadUnit[] = [];
  for (let first = 1; first <= 11; first += 1) {
    for (let second = first; second <= 11; second += 1) {
      for (const language of ['uz', 'ru']) {
        units.push({
          kind: first === second ? 'class' : 'group',
          yearId: YEAR,
          archived: false,
          grades: first === second ? [first] : [first, second],
          language,
          subjectId: first === second ? null : 'algebra',
          tutorOnStart: null,
        });
      }
    }
  }
  const all = Array.from({ length: 11 }, (_, index) => index + 1);
  const everything: LoadTeacher = {
    id: 'all',
    inBranch: true,
    out: false,
    subjects: [{ subjectId: 'algebra', grades: all }],
    languages: ['uz', 'ru'],
  };
  const wide: LoadSubject = { ...algebra, grades: all };

  it('finds no profile problem for a teacher who covers every grade and language', () => {
    for (const unit of units) {
      expect(teacherProblems(unit, wide, everything), unit.grades.join('+')).toEqual([]);
    }
  });

  it('finds a grade problem exactly when a grade of the unit is missing', () => {
    for (const unit of units) {
      for (const missing of all) {
        const teacher = {
          ...everything,
          subjects: [{ subjectId: 'algebra', grades: all.filter((grade) => grade !== missing) }],
        };
        expect(teacherProblems(unit, wide, teacher)).toEqual(
          unit.grades.includes(missing) ? ['load_teacher_grade'] : [],
        );
      }
    }
  });
});
