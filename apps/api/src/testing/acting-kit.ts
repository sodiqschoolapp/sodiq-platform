import type { Database } from '../database/database.js';
import { LoadKit } from './load-kit.js';

/** The first published version's start, a Monday. */
export const ACTING_EARLY = '2026-09-07';

/**
 * A branch's scene for the acting teacher of a vacancy's journal (task
 * 5.7a-3c): a year, a class of grade 7 (language `uz`), a subject of grades 7 and 8,
 * an open vacancy and a person who both teach it, a published version from
 * `ACTING_EARLY` whose row names the vacancy, and the class's journal of the
 * subject, all written by the migrator. All names are invented.
 */
export interface ActingScene {
  readonly branch: string;
  readonly year: string;
  readonly classId: string;
  readonly subject: string;
  readonly vacancy: string;
  readonly person: string;
  readonly personAccount: string;
  readonly version: string;
  readonly journal: string;
}

export class ActingKit {
  readonly load: LoadKit;

  constructor(private readonly migrator: Database) {
    this.load = new LoadKit(migrator);
  }

  /** The scene in `branch`. */
  async scene(branch: string, input: { language?: 'uz' | 'ru' } = {}): Promise<ActingScene> {
    const year = await this.load.classes.year(branch);
    const classId = await this.load.classes.schoolClass(branch, year, {
      grade: 7,
      language: input.language ?? 'uz',
    });
    const subject = await this.load.classes.subject({ grades: [7, 8] });
    const vacancy = await this.load.vacancy(branch, {
      languages: [input.language ?? 'uz'],
      subjects: [{ subject, grades: [7] }],
    });
    const person = await this.load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    const version = await this.published({ branch, year, classId, subject }, ACTING_EARLY, vacancy);
    const journal = await this.journal(branch, year, classId, subject);
    return {
      branch,
      year,
      classId,
      subject,
      vacancy,
      person: person.staffId,
      personAccount: person.accountId,
      version,
      journal,
    };
  }

  /** A published version of the scene's year from `startsOn` whose row of the class names `teacher`. */
  async published(
    scene: Pick<ActingScene, 'branch' | 'year' | 'classId' | 'subject'>,
    startsOn: string,
    teacher: string,
    status: 'draft' | 'published' = 'published',
  ): Promise<string> {
    const version = await this.load.version(scene.branch, scene.year, { startsOn });
    await this.load.row({
      branch_id: scene.branch,
      version_id: version,
      class_id: scene.classId,
      subject_id: scene.subject,
      teacher_id: teacher,
    });
    if (status === 'published') await this.load.setVersion(version, 'published');
    return version;
  }

  /** The class's journal of the subject, as a publish opens it. */
  async journal(branch: string, year: string, classId: string, subject: string): Promise<string> {
    const row = await this.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: classId,
        group_id: null,
        subject_id: subject,
        runs: `{[${ACTING_EARLY},)}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A period written by the migrator, past the start rule (as one named on an earlier day). */
  async period(
    scene: ActingScene,
    from: string,
    until: string | null = null,
    person = scene.person,
  ): Promise<string> {
    const account = await this.migrator
      .selectFrom('accounts')
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow();
    const row = await this.migrator
      .insertInto('journal_acting_teachers')
      .values({
        branch_id: scene.branch,
        journal_id: scene.journal,
        vacancy_id: scene.vacancy,
        person_id: person,
        valid_from: from,
        valid_until: until,
        given_by: account.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
}
