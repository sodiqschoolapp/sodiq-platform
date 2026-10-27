import type { NestExpressApplication } from '@nestjs/platform-express';
import type { JournalGrid, JournalLesson, WorkSaved } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Database } from '../../database/database.js';
import type { FixedClock } from '../fixed-clock.js';
import { codeOf } from './caller.js';
import { QUARTERS, seededRandom, DAY_OFF } from './data.js';
import { SignIns, type DemoAccount } from './people.js';
import type { DemoBranchBuilt, DemoSchool, DemoTeacher, Say } from './school.js';

/** Topics of each subject, in the order a teacher would plan them; a long quarter goes round again. */
const TOPICS: Record<string, readonly string[]> = {
  Mathematics: [
    'Natural numbers and place value',
    'Adding and subtracting large numbers',
    'Multiplication and its properties',
    'Division with a remainder',
    'Order of operations',
    'Divisibility rules',
    'Prime and composite numbers',
    'Greatest common divisor',
    'Least common multiple',
    'Fractions: the basic idea',
    'Comparing fractions',
    'Adding fractions',
    'Decimal fractions',
    'Percent',
    'Word problems with percent',
    'Review and practice test',
  ],
  'Native language': [
    'Sounds and letters',
    'The syllable and word stress',
    'Parts of speech',
    'The noun',
    'The adjective',
    'The verb and its tenses',
    'The sentence and its parts',
    'Punctuation of simple sentences',
    'Dictation',
    'Writing a short essay',
  ],
  Literature: [
    'Folk tales',
    'Proverbs and sayings',
    'The epic poem',
    'A short story: the characters',
    'A short story: the plot',
    'Poetry: rhythm and rhyme',
    'Learning a poem by heart',
    'Book discussion',
  ],
  Russian: [
    'Greetings and introductions',
    'My family',
    'At school',
    'Numbers and time',
    'Days of the week',
    'Shopping',
    'The weather',
    'Reading a short text',
  ],
  English: [
    'Introductions and greetings',
    'Present simple',
    'Daily routines',
    'Present continuous',
    'Describing people',
    'Past simple: regular verbs',
    'Past simple: irregular verbs',
    'Food and drink',
    'Countable and uncountable nouns',
    'Reading: a short article',
    'Listening practice',
    'Writing an email',
  ],
  History: [
    'What history studies',
    'The first people',
    'Ancient civilisations of Central Asia',
    'The Great Silk Road',
    'Ancient Egypt',
    'Ancient Greece',
    'Ancient Rome',
    'Review of the unit',
  ],
  Geography: [
    'The Earth in space',
    'Maps and the globe',
    'Latitude and longitude',
    'The relief of the Earth',
    'Rivers and lakes',
    'Climate and weather',
    'Natural zones',
    'Practical work with the map',
  ],
  Biology: [
    'Living and non-living things',
    'The cell',
    'Plant cells and animal cells',
    'Tissues',
    'The structure of a plant',
    'Photosynthesis',
    'Microscope practical',
    'Review of the unit',
  ],
  Physics: [
    'What physics studies',
    'Measurement and units',
    'Structure of matter',
    'Motion and speed',
    'Mass and density',
    'Force and weight',
    'Laboratory work: density',
    'Pressure',
  ],
  Chemistry: [
    'Substances and their properties',
    'Laboratory safety',
    'Pure substances and mixtures',
    'Atoms and molecules',
    'Chemical elements',
    'The periodic table',
    'Chemical formulas',
    'Laboratory work: separating a mixture',
  ],
  Informatics: [
    'Information and its kinds',
    'The computer and its parts',
    'Files and folders',
    'Typing and editing text',
    'Algorithms',
    'A first program',
  ],
  Art: ['Colours and the colour wheel', 'Drawing a still life', 'Landscape', 'National ornament'],
  'Physical education': [
    'Running and warm-up',
    'Long jump',
    'Ball games: passing',
    'Ball games: team play',
    'Gymnastics',
    'Endurance run',
  ],
  Technology: [
    'Safety in the workshop',
    'Measuring and marking',
    'Working with paper and card',
    'Working with wood',
    'A small project',
  ],
};

/** The exemption of the demo: entered on a Friday, from the Monday after for two weeks. */
const EXEMPTION = { createdOn: '2026-10-09', startDate: '2026-10-12', endDate: '2026-10-23' };

/** The total a teacher uses for their works: each picks one scale and keeps to it. */
const TOTALS = [5, 10, 20, 100] as const;

interface JournalRef {
  readonly id: string;
  readonly subject: string;
}

interface Pool {
  run<T>(work: () => Promise<T>): Promise<T>;
}

/** At most `size` pieces of work at once. */
function pool(size: number): Pool {
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (running >= size) await new Promise<void>((resolve) => waiting.push(resolve));
      running += 1;
      try {
        return await work();
      } finally {
        running -= 1;
        waiting.shift()?.();
      }
    },
  };
}

const at = (date: string, time: string) => `${date}T${time}:00+05:00`;

function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T12:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The first quarter's plans and every school day's journal up to yesterday
 * (today in Tashkent, or `DEMO_TODAY`), entered by each teacher on the day
 * of the lesson after school, so the journal discipline, the reminders and
 * the lesson statuses read as a real school's. Today's lessons are left for
 * the person who tries the journal.
 */
export async function fillJournals(input: {
  app: NestExpressApplication;
  migrator: Database;
  clock: FixedClock;
  school: DemoSchool;
  password: string;
  today: string;
  say: Say;
}): Promise<void> {
  const { app, migrator, clock, school, say, today } = input;
  const signIns = new SignIns(app, clock, input.password);
  const random = seededRandom(20261027);
  const subjectName = new Map([...school.subjects.entries()].map(([name, id]) => [id, name]));
  const yesterday = addDays(today, -1);

  // Each student's ability and the school days they miss (whole days, as a cold does).
  const students = school.branches.flatMap((branch) =>
    branch.classes.flatMap((one) => one.students.map((student) => student.id)),
  );
  const ability = new Map<string, number>();
  const absentOn = new Set<string>();
  for (const [index, id] of students.entries()) {
    // One student in twenty struggles: the early-warning list has someone to show.
    const weak = index % 20 === 7;
    ability.set(id, weak ? 0.35 + random() * 0.15 : 0.55 + random() * 0.43);
    let date: string = QUARTERS[0].startDate;
    while (date <= yesterday) {
      if (random() < (weak ? 0.07 : 0.015)) {
        const length = 1 + Math.floor(random() * 3);
        for (let day = 0; day < length; day += 1) absentOn.add(`${id}|${addDays(date, day)}`);
      }
      date = addDays(date, 1);
    }
  }

  // The journals of each branch, by id.
  const journalsOf = new Map<string, JournalRef>();
  for (const branch of school.branches) {
    const rows = await migrator
      .selectFrom('journals')
      .select(['id', 'subject_id'])
      .where('branch_id', '=', branch.id)
      .execute();
    for (const row of rows) {
      journalsOf.set(row.id, { id: row.id, subject: subjectName.get(row.subject_id) ?? 'Subject' });
    }
  }

  /** The held lessons of a branch on a day: teacher, lesson and journal. */
  const lessonsOn = async (branch: DemoBranchBuilt, date: string) => {
    const result = await sql<{ lesson_id: string; teacher_id: string; journal_id: string }>`
      select l.id as lesson_id, l.teacher_id, j.id as journal_id
      from lessons l
      join journals j on j.branch_id = l.branch_id and j.subject_id = l.subject_id
        and j.academic_year_id = ${branch.yearId}
        and (j.class_id = l.class_id or j.group_id = l.group_id)
      where l.branch_id = ${branch.id} and l.lesson_date = ${date}
        and l.cancel_cause is null and l.teacher_id is not null
      order by l.starts_at
    `.execute(migrator);
    return result.rows;
  };

  const teacherOf = (branch: DemoBranchBuilt, staffId: string): DemoTeacher | undefined =>
    branch.teachers.get(staffId);

  // The plan windows of the first quarter, opened by each Academic Vice
  // Principal: the week before the year.
  for (const branch of school.branches) {
    const quarter = branch.quarterIds[0] ?? '';
    await branch.vice.caller
      .in(branch.id)
      .put(`/api/plans/windows/${quarter}`, { startDate: '2026-08-25', endDate: '2026-09-01' });
  }
  say('Plan windows of the first quarter: 25 August to 1 September');

  // Every teacher plans the quarter on Thursday 27 August.
  clock.set(at('2026-08-27', '11:00'));
  const planners = pool(6);
  let items = 0;
  const totalOf = new Map<string, number>();
  for (const branch of school.branches) {
    const quarter = branch.quarterIds[0] ?? '';
    const byTeacher = new Map<string, Set<string>>();
    const rows = await sql<{ teacher_id: string; journal_id: string }>`
      select distinct l.teacher_id, j.id as journal_id
      from lessons l
      join journals j on j.branch_id = l.branch_id and j.subject_id = l.subject_id
        and j.academic_year_id = ${branch.yearId}
        and (j.class_id = l.class_id or j.group_id = l.group_id)
      where l.branch_id = ${branch.id} and l.teacher_id is not null
        and l.lesson_date between ${QUARTERS[0].startDate} and ${QUARTERS[0].endDate}
    `.execute(migrator);
    for (const row of rows.rows) {
      const set = byTeacher.get(row.teacher_id) ?? new Set<string>();
      set.add(row.journal_id);
      byTeacher.set(row.teacher_id, set);
    }
    await Promise.all(
      [...byTeacher.entries()].map(([staffId, journals]) =>
        planners.run(async () => {
          const teacher = teacherOf(branch, staffId);
          if (teacher === undefined) return;
          if (!totalOf.has(staffId)) {
            totalOf.set(staffId, TOTALS[Math.floor(random() * TOTALS.length)] ?? 10);
          }
          await signIns.again(teacher.account);
          const as = teacher.account.caller.in(branch.id);
          for (const journalId of journals) {
            const subject = journalsOf.get(journalId)?.subject ?? 'Subject';
            const topics = TOPICS[subject] ?? ['Lesson'];
            const plan = await as.get<{
              rows: { number: number; lessonId: string; open: string; item: unknown }[];
            }>(`/api/plans/journals/${journalId}?quarterId=${quarter}`);
            for (const row of plan.rows) {
              if (row.item !== null || row.open !== 'all') continue;
              const topic = topics[(row.number - 1) % topics.length] ?? 'Lesson';
              const round = Math.floor((row.number - 1) / topics.length);
              const practical = subject === 'Physical education' || subject === 'Technology';
              const given = !practical && row.number % 3 !== 0;
              await as.post(`/api/plans/journals/${journalId}/items`, {
                quarterId: quarter,
                position: row.number,
                lessonId: row.lessonId,
                values: {
                  topic: round === 0 ? topic : `${topic} (practice ${String(round)})`,
                  objectives: `Students can explain and use: ${topic.toLowerCase()}.`,
                  links: [],
                  classworks: [
                    {
                      title: practical ? 'Practical task' : 'Exercises in class',
                      description: '',
                    },
                  ],
                  homeworks: given ? [{ title: 'Homework exercises', description: '' }] : [],
                },
              });
              items += 1;
            }
          }
        }),
      ),
    );
  }
  say(`${String(items)} lesson plan items for the first quarter`);

  // The school days, from the first one to yesterday.
  const workers = pool(6);
  /** A lesson left without entries on purpose, for the reminders and an unlock request. */
  let skipped: { branch: DemoBranchBuilt; teacher: DemoTeacher; lessonId: string } | null = null;
  const skipDay = (() => {
    // The last school day before today, and a day nine school days back.
    let date = yesterday;
    while (weekdayOf(date) > 5 || date === DAY_OFF.date) date = addDays(date, -1);
    return date;
  })();
  const lockedDay = addDays(skipDay, -10);
  let entered = 0;
  let marks = 0;
  for (let date: string = QUARTERS[0].startDate; date <= yesterday; date = addDays(date, 1)) {
    if (weekdayOf(date) > 5 || date === DAY_OFF.date) continue;
    const quarterIndex = QUARTERS.findIndex((one) => one.startDate <= date && date <= one.endDate);
    if (quarterIndex === -1) continue;
    clock.set(at(date, '15:30'));
    for (const branch of school.branches) {
      const quarter = branch.quarterIds[quarterIndex] ?? '';
      const lessons = await lessonsOn(branch, date);
      const byTeacher = new Map<string, Set<string>>();
      for (const one of lessons) {
        const set = byTeacher.get(one.teacher_id) ?? new Set<string>();
        set.add(one.journal_id);
        byTeacher.set(one.teacher_id, set);
      }
      const teacherKeys = [...byTeacher.keys()].sort();
      await Promise.all(
        teacherKeys.map((staffId, teacherIndex) =>
          workers.run(async () => {
            const teacher = teacherOf(branch, staffId);
            if (teacher === undefined) return;
            // The first teacher of the first branch forgets the last school day.
            const forgets = branch === school.branches[0] && teacherIndex === 0 && date === skipDay;
            if (forgets) return;
            await signIns.again(teacher.account);
            const as = teacher.account.caller.in(branch.id);
            for (const journalId of byTeacher.get(staffId) ?? []) {
              const grid = await as.get<JournalGrid>(
                `/api/journal/journals/${journalId}?quarterId=${quarter}`,
              );
              for (const [lessonIndex, lesson] of grid.lessons.entries()) {
                if (lesson.date !== date || !lesson.canEnter) continue;
                // One lesson ten school days back keeps its numbers missing:
                // it is locked incomplete, and its teacher asks to unlock it.
                const leaveNumbers =
                  skipped === null &&
                  date === lockedDay &&
                  branch === school.branches[0] &&
                  lesson.works.length > 0;
                const count = await enterLesson(
                  as,
                  grid,
                  lesson,
                  lessonIndex,
                  date,
                  totalOf.get(staffId) ?? 10,
                  leaveNumbers,
                );
                if (leaveNumbers) skipped = { branch, teacher, lessonId: lesson.id };
                entered += 1;
                marks += count;
              }
            }
          }),
        ),
      );
    }
    if (date === EXEMPTION.createdOn) await exempt();
    if (weekdayOf(date) === 5) say(`Journals entered up to ${date}: ${String(entered)} lessons`);
  }
  say(`${String(entered)} lessons entered with ${String(marks)} attendance marks and numbers`);

  /**
   * A student of the first class is excused from physical education for two
   * weeks (a doctor's note), entered by the Academic Vice Principal before it
   * starts: the journal shows 4 in those lessons.
   */
  async function exempt(): Promise<void> {
    const branch = school.branches[0];
    const student = branch?.classes[0]?.students[0];
    const subject = school.subjects.get('Physical education');
    if (branch === undefined || student === undefined || subject === undefined) return;
    await signIns.again(branch.vice);
    await branch.vice.caller.in(branch.id).post('/api/exemptions', {
      studentIds: [student.id],
      kind: 'temporary',
      subjectIds: [subject],
      startDate: EXEMPTION.startDate,
      endDate: EXEMPTION.endDate,
      slots: null,
      category: 'illness',
      detail: "Doctor's note: a sprained ankle.",
      choices: [],
    });
    say(
      `A temporary exemption from physical education, ${EXEMPTION.startDate} to ${EXEMPTION.endDate}`,
    );
  }

  /** Attendance, the totals of the works and the numbers of one lesson; answers the cells written. */
  async function enterLesson(
    as: DemoAccount['caller'],
    grid: JournalGrid,
    lesson: JournalLesson,
    lessonIndex: number,
    date: string,
    total: number,
    leaveNumbers: boolean,
  ): Promise<number> {
    const open = grid.students.filter((student) => {
      const cell = student.cells[lessonIndex];
      return cell !== undefined && !cell.closed && cell.exempt === null;
    });
    if (open.length === 0) return 0;
    const markOf = new Map<string, 0 | 1 | 2 | 3>();
    for (const student of open) {
      const roll = random();
      markOf.set(
        student.id,
        absentOn.has(`${student.id}|${date}`) ? 0 : roll < 0.03 ? 2 : roll < 0.035 ? 3 : 1,
      );
    }
    await as.post(`/api/journal/lessons/${lesson.id}/attendance`, {
      saves: open.map((student) => ({
        studentId: student.id,
        mark: markOf.get(student.id) ?? 1,
        version: student.cells[lessonIndex]?.version ?? null,
      })),
    });
    let written = open.length;
    if (leaveNumbers || !lesson.canEnterWorks) return written;
    const columns: { workId: string; total: number }[] = [];
    for (const work of lesson.works) {
      if (work.notHeld) continue;
      if (work.id !== null && work.total !== null) {
        columns.push({ workId: work.id, total: work.total });
        continue;
      }
      const column =
        work.id !== null
          ? { workId: work.id }
          : { planWorkId: work.planWorkId ?? '', sourceLessonId: work.sourceLessonId ?? '' };
      const saved = await as.put<WorkSaved>(`/api/journal/lessons/${lesson.id}/works/total`, {
        column,
        total,
        version: work.version,
      });
      columns.push({ workId: saved.id, total });
    }
    const saves = open
      .filter((student) => {
        const mark = markOf.get(student.id);
        return mark === 1 || mark === 2;
      })
      .flatMap((student) =>
        columns.map((column) => {
          const level = Math.min(
            1,
            Math.max(0, (ability.get(student.id) ?? 0.7) + (random() - 0.5) * 0.3),
          );
          return {
            studentId: student.id,
            column: { workId: column.workId },
            score: Math.round(level * column.total),
            version: null,
          };
        }),
      );
    if (saves.length > 0) {
      await as.post(`/api/journal/lessons/${lesson.id}/scores`, { saves });
      written += saves.length;
    }
    return written;
  }

  // The teacher of the lesson left incomplete asks to unlock it; the request
  // waits for the Academic Vice Principal.
  const left = skipped as {
    branch: DemoBranchBuilt;
    teacher: DemoTeacher;
    lessonId: string;
  } | null;
  clock.set(at(yesterday, '17:00'));
  if (left !== null) {
    await signIns.again(left.teacher.account);
    try {
      await left.teacher.account.caller
        .in(left.branch.id)
        .post(`/api/journal/lessons/${left.lessonId}/unlocks`, {
          reason: 'I was ill that day and could not enter the numbers of the classwork.',
        });
      say(
        `An unlock request of ${left.teacher.account.name} waits for the Academic Vice Principal`,
      );
    } catch (error) {
      say(`No unlock request (${codeOf(error) ?? String(error)})`);
    }
  }

  // The reasons of absence the Tutors record for their classes.
  let reasons = 0;
  for (const branch of school.branches) {
    for (const one of branch.classes) {
      const tutor = one.tutorStaffId === null ? undefined : branch.teachers.get(one.tutorStaffId);
      if (tutor === undefined) continue;
      await signIns.again(tutor.account);
      const as = tutor.account.caller.in(branch.id);
      for (const student of one.students) {
        for (const key of absentOn) {
          if (!key.startsWith(`${student.id}|`)) continue;
          const date = key.slice(student.id.length + 1);
          if (date > yesterday || weekdayOf(date) > 5 || random() < 0.3) continue;
          try {
            await as.put(`/api/journal/student-absences/${student.id}/${date}`, {
              category: random() < 0.7 ? 'illness' : 'family',
              note: '',
            });
            reasons += 1;
          } catch (error) {
            // A day with no lesson marked 0 (a day off, or a lesson left out) has no reason to record.
            if (codeOf(error) === null) throw error;
          }
        }
      }
    }
  }
  say(`${String(reasons)} reasons of absence recorded by the Tutors`);

  // The second quarter's plan window is open now, so plans can be tried.
  clock.set(at(yesterday, '17:30'));
  for (const branch of school.branches) {
    await signIns.again(branch.vice);
    const quarter = branch.quarterIds[1] ?? '';
    const start = today < '2026-10-26' ? '2026-10-26' : today;
    try {
      await branch.vice.caller
        .in(branch.id)
        .put(`/api/plans/windows/${quarter}`, { startDate: start, endDate: '2026-11-07' });
    } catch (error) {
      say(`${branch.name}: second quarter window not opened (${codeOf(error) ?? String(error)})`);
    }
  }
  say('Plan windows of the second quarter open until 7 November');
}
