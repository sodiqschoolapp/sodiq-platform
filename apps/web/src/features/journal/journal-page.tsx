import { GRADE_BANDS } from '@sodiq/calc';
import {
  searchWords,
  spellingKey,
  timeText,
  type JournalGrid,
  type JournalLesson,
  type JournalStudent,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, SelectField } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectChip } from '@/features/setup/subject-colour';
import { monthsText, schoolDateText } from '@/lib/dates';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { ATTENDANCE_MARKS } from '@sodiq/shared';
import { Button } from '@/components/ui/button';
import { UndoIcon } from '@/components/icons';
import { useAttendanceEntry, type AttendanceEntry } from './attendance-entry';
import { useUndo } from './cell-saves';
import { useComments } from './comment-dialog';
import { useRatingEntry } from './rating-entry';
import { useWorksEntry } from './works-entry';
import { journalGridQuery } from './journal-api';
import { GRADE_TINT, JournalGridView } from './journal-grid';
import { JOURNAL_FILTERS, type JournalFilter, type JournalSearch } from './journal-search';
import { yearText } from './journals-page';

/** The month name of `YYYY-MM`, from the dates helper. */
const monthName = (month: string, language: string): string =>
  monthsText(`${month}-01`, `${month}-01`, language);

/**
 * The lesson closest to a date by days (`07`, Opening a journal: "scrolls to the
 * lesson closest to today"); on a tie the later one, the first lesson of the date.
 */
export function lessonNearest(
  lessons: readonly JournalLesson[],
  date: string,
): JournalLesson | null {
  const day = (text: string) => Date.parse(`${text}T00:00:00Z`);
  let best: JournalLesson | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const lesson of lessons) {
    const distance = Math.abs(day(lesson.date) - day(date));
    // The later lesson wins a tie; within one date the first lesson stays.
    const later = best !== null && distance === bestDistance && lesson.date > best.date;
    if (distance < bestDistance || later) {
      best = lesson;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether a student has an empty cell to fill in the lessons shown (the Filter "with an empty cell"). */
const hasEmptyCell = (
  student: JournalStudent,
  lessons: readonly JournalLesson[],
  shown: ReadonlySet<string>,
) =>
  lessons.some((lesson, index) => {
    if (!shown.has(lesson.id) || !lesson.held) return false;
    const cell = student.cells[index];
    if (cell === undefined || cell.closed) return false;
    return (
      cell.mark === null ||
      lesson.works.some(
        (work, workIndex) =>
          work.total !== null && !work.notHeld && cell.works[workIndex]?.score === null,
      )
    );
  });

/** Whether every word typed is found in the student's names and UID, spelling folded (`edge/journal`). */
const found = (student: JournalStudent, words: readonly string[] | null) => {
  if (words === null) return true;
  const text = spellingKey(
    `${student.lastName} ${student.firstName} ${student.paternalName ?? ''} ${student.uid}`,
  );
  return words.every((word) => text.includes(word));
};

/**
 * A journal for one quarter (task 6.2, pull request #210; `07`, Opening a
 * journal, Layout): the header "Sinf jurnali", then Class · Subject · Quarter
 * · Month, then the teacher; the selectors; the grid, or lesson mode; the
 * legend under it. Read only until entry comes (6.3, 8.1 to 8.4).
 */
export function JournalPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { journalId } = useParams({ from: '/app/journal/$journalId' });
  const search: JournalSearch = useSearch({ from: '/app/journal/$journalId' });
  const { branchId } = useView();
  const grid = useQuery(journalGridQuery(branchId, journalId, search.quarter ?? null));

  const go = (next: JournalSearch, how: 'push' | 'replace' = 'replace') => {
    void navigate({
      to: '/journal/$journalId',
      params: { journalId },
      search: { ...search, ...next },
      replace: how === 'replace',
    });
  };

  const breadcrumbs = [
    { label: t('home.title'), to: '/' as const },
    { label: t('journal.page.title'), to: '/journal' as const },
  ];
  if (grid.isError) {
    return (
      <>
        <PageHeader title={t('journal.sheet')} breadcrumbs={breadcrumbs} />
        <ErrorState error={grid.error} onRetry={() => void grid.refetch()} />
      </>
    );
  }
  if (grid.data === undefined) {
    return (
      <>
        <PageHeader title={t('journal.sheet')} breadcrumbs={breadcrumbs} />
        <LoadingOutline />
      </>
    );
  }
  return <JournalLoaded grid={grid.data} search={search} go={go} breadcrumbs={breadcrumbs} />;
}

/** The journal once read: the header, the selectors, the grid or lesson mode, and entry (task 6.3). */
function JournalLoaded({
  grid: data,
  search,
  go,
  breadcrumbs,
}: {
  grid: JournalGrid;
  search: JournalSearch;
  go: (next: JournalSearch, how?: 'push' | 'replace') => void;
  breadcrumbs: { label: string; to: '/' | '/journal' }[];
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const [foldedOpen, setFoldedOpen] = useState(false);
  // Lesson mode on a phone (`12`, Devices), or by the switch.
  const narrow = !useMinWidth(SM);
  // Task 8.3a: the undo of the person's own last action on the page (edge/journal, Undo).
  const undo = useUndo();
  const { entry, notices } = useAttendanceEntry(data, undo.record);
  // Task 8.1: works and numbers.
  const { works, dialogs } = useWorksEntry(data, undo.record);
  const { undo: undoLast, available: canUndo } = undo;
  useEffect(() => {
    // Ctrl+Z (or Cmd+Z) outside a field and a dialog undoes the last action of the page.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !==
          null ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!canUndo) return;
      event.preventDefault();
      undoLast();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [canUndo, undoLast]);
  // Task 8.2: the rating exam and comments.
  const { rating, dialogs: ratingDialogs } = useRatingEntry(data);
  const { comments, dialogs: commentDialogs } = useComments(data);
  const [refusedNumber, setRefusedNumber] = useState<number | null>(null);
  const month =
    search.month !== undefined && data.months.includes(search.month) ? search.month : null;
  const subject = nameOf(data.journal.subject.names, language);
  const shownLessons = new Set(
    data.lessons.filter((one) => month === null || one.month === month).map((one) => one.id),
  );
  const words = searchWords(search.q);
  const filter: JournalFilter = search.filter ?? 'all';
  const passes = (student: JournalStudent) =>
    found(student, words) &&
    (filter !== 'empty' || hasEmptyCell(student, data.lessons, shownLessons));
  const members =
    filter === 'left' ? [] : data.students.filter((one) => !one.folded && passes(one));
  const folded =
    filter === 'members' ? [] : data.students.filter((one) => one.folded && passes(one));
  const lessonMode = search.mode === 'lesson' || narrow;
  const scrollDate = search.date ?? data.today;
  const nearest = lessonNearest(data.lessons, scrollDate);

  const header = [
    data.journal.unit.name,
    subject,
    t('journal.page.quarterNumber', { number: data.quarter.number }),
    month === null
      ? monthsText(data.quarter.startDate, data.quarter.endDate, language)
      : monthName(month, language),
  ].join(' · ');

  return (
    <>
      <PageHeader title={t('journal.sheet')} breadcrumbs={breadcrumbs} />
      <div className="grid gap-4">
        <div className={`${PANEL} grid gap-4`}>
          <div className="grid gap-1" data-journal-header="true">
            <p className="text-lg font-semibold">{header}</p>
            <p className="flex flex-wrap items-center gap-3">
              <SubjectChip colour={data.journal.subject.colour} name={subject} />
              <span>
                {data.teacher === null
                  ? t('journal.page.noTeacher')
                  : t('journal.page.teacher', { name: data.teacher.name })}
              </span>
              {data.journal.year.closed && (
                <span className="font-semibold">{t('journal.page.pastYear')}</span>
              )}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SelectField
              label={
                data.journal.unit.kind === 'class'
                  ? t('journal.page.class')
                  : t('journal.page.group')
              }
              value={data.journal.id}
              options={data.others
                .filter(
                  (one) =>
                    one.subject.id === data.journal.subject.id &&
                    one.unit.kind === data.journal.unit.kind,
                )
                .map((one) => ({ value: one.id, label: one.unit.name }))}
              onChange={(event) => {
                void navigate({
                  to: '/journal/$journalId',
                  params: { journalId: event.target.value },
                });
              }}
            />
            <SelectField
              label={t('journal.page.subject')}
              value={data.journal.id}
              options={data.others
                .filter((one) => one.unit.id === data.journal.unit.id)
                .map((one) => ({ value: one.id, label: nameOf(one.subject.names, language) }))}
              onChange={(event) => {
                void navigate({
                  to: '/journal/$journalId',
                  params: { journalId: event.target.value },
                });
              }}
            />
            <SelectField
              label={t('journal.page.year')}
              value={data.journal.year.id}
              options={data.years.map((year) => ({ value: year.id, label: yearText(year) }))}
              onChange={(event) => {
                // A journal belongs to one year: another year opens its Journals page.
                if (event.target.value !== data.journal.year.id) {
                  void navigate({ to: '/journal', search: { year: event.target.value } });
                }
              }}
            />
            <SelectField
              label={t('journal.page.quarter')}
              value={data.quarter.id}
              options={data.quarters
                .filter((one) => one.startDate !== null)
                .map((one) => ({
                  value: one.id,
                  label: t('journal.page.quarterNumber', { number: one.number }),
                }))}
              onChange={(event) => {
                go({ quarter: event.target.value, month: undefined, date: undefined }, 'push');
              }}
            />
            <SelectField
              label={t('journal.page.month')}
              value={month ?? ''}
              options={[
                { value: '', label: t('journal.page.wholeQuarter') },
                ...data.months.map((one) => ({ value: one, label: monthName(one, language) })),
              ]}
              onChange={(event) => {
                go({ month: event.target.value === '' ? undefined : event.target.value });
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-64">
              <Field
                label={t('journal.page.search')}
                type="search"
                value={search.q ?? ''}
                onChange={(event) => {
                  go({ q: event.target.value === '' ? undefined : event.target.value });
                }}
              />
            </div>
            <div className="w-56">
              <SelectField
                label={t('journal.page.filter')}
                value={filter}
                options={JOURNAL_FILTERS.map((one) => ({
                  value: one,
                  label: t(`journal.page.filters.${one}`),
                }))}
                onChange={(event) => {
                  const value = event.target.value as JournalFilter;
                  go({ filter: value === 'all' ? undefined : value });
                }}
              />
            </div>
            {!narrow && (
              <Segmented
                label={t('journal.page.mode')}
                options={[
                  { value: 'grid', label: t('journal.page.gridMode') },
                  { value: 'lesson', label: t('journal.page.lessonMode') },
                ]}
                value={lessonMode ? 'lesson' : 'grid'}
                onChange={(value) => {
                  go({ mode: value === 'lesson' ? 'lesson' : undefined });
                }}
              />
            )}
            {data.lessons.some((one) => one.canEnter) && (
              <Button
                variant="secondary"
                disabled={!undo.available || undo.busy}
                onClick={undo.undo}
                title={t('journal.saving.undoHint')}
              >
                <UndoIcon aria-hidden="true" />
                {t('journal.saving.undo')}
              </Button>
            )}
            <Link to="/journal" search={{ year: data.journal.year.id }} className="text-link">
              {t('journal.page.otherYear', { year: yearText(data.journal.year) })}
            </Link>
          </div>
        </div>
        {notices}
        {undo.notice}
        {dialogs}
        {ratingDialogs}
        {commentDialogs}
        {refusedNumber !== null && (
          <p role="alert" className="text-sm text-destructive" data-refused-number="true">
            {t('journal.works.wholeNumber', { total: refusedNumber })}
          </p>
        )}
        {data.lessons.length === 0 ? (
          <div className={PANEL}>
            <EmptyState text={t('journal.page.noLessons')} />
          </div>
        ) : lessonMode ? (
          <LessonMode
            grid={data}
            lesson={nearest}
            students={[...members, ...folded]}
            entry={entry}
          />
        ) : (
          <div className={PANEL}>
            <JournalGridView
              grid={data}
              month={month}
              members={members}
              folded={folded}
              foldedCount={folded.length}
              foldedOpen={foldedOpen}
              onToggleFolded={() => {
                setFoldedOpen((open) => !open);
              }}
              scrollTo={nearest?.id ?? null}
              entry={entry}
              works={works}
              rating={rating}
              comments={comments}
              onRefusedNumber={setRefusedNumber}
            />
          </div>
        )}
        <Legend grid={data} />
      </div>
    </>
  );
}

/** The words of each typed mark (`07`, Entering data). */
const MARK_NAMES = { 0: 'absent', 1: 'present', 2: 'late', 3: 'skipped' } as const;

/**
 * Lesson mode (`07`, Lesson mode: "On a phone, one lesson is shown at a time
 * as a list of students"; decision 12): the lesson of the date asked, or the
 * nearest to today; task 6.3: the attendance marks as large buttons and
 * "All present" for a lesson the reader enters; 8.1 adds the numbers.
 */
function LessonMode({
  grid,
  lesson,
  students,
  entry,
}: {
  grid: JournalGrid;
  lesson: JournalLesson | null;
  students: readonly JournalStudent[];
  entry: AttendanceEntry;
}) {
  const { t, i18n } = useTranslation();
  if (lesson === null) {
    return (
      <div className={PANEL}>
        <EmptyState text={t('journal.page.noLessons')} />
      </div>
    );
  }
  const index = grid.lessons.indexOf(lesson);
  return (
    <section className={`${PANEL} grid gap-4`} data-lesson-mode={lesson.id}>
      <h2 className={SECTION_TITLE}>
        {t('journal.page.lessonOf', {
          date: schoolDateText(lesson.date, i18n.language),
          time: timeText(lesson.start),
        })}
        {lesson.cancelled !== null && (
          <span className="ml-2 text-muted-foreground">
            {lesson.cancelled.reason === null
              ? t('journal.grid.cancelled')
              : t('journal.grid.cancelledReason', { reason: lesson.cancelled.reason })}
          </span>
        )}
      </h2>
      {lesson.canEnter && (
        <div>
          <Button
            disabled={entry.busy}
            onClick={() => {
              entry.allPresent(lesson.id);
            }}
          >
            {t('journal.entry.allPresent')}
          </Button>
        </div>
      )}
      <ul className="grid gap-2">
        {students.map((student) => {
          const cell = student.cells[index];
          return (
            <li
              key={student.id}
              className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b py-2"
              data-student={student.id}
            >
              <span>
                {student.lastName} {student.firstName}
              </span>
              <span className="flex gap-3 text-lg">
                {lesson.canEnter && cell !== undefined && !cell.closed ? (
                  // Large buttons (`07`, Lesson mode): attendance first.
                  <span
                    role="group"
                    aria-label={t('journal.grid.attendance')}
                    className="flex gap-1"
                  >
                    {ATTENDANCE_MARKS.map((mark) => (
                      <Button
                        key={mark}
                        variant={cell.mark === mark ? 'default' : 'secondary'}
                        className="min-w-11"
                        aria-pressed={cell.mark === mark}
                        aria-label={t('journal.entry.markButton', {
                          mark,
                          name: t(`journal.marks.${MARK_NAMES[mark]}`),
                        })}
                        title={t(`journal.marks.${MARK_NAMES[mark]}`)}
                        disabled={entry.busy}
                        onClick={() => {
                          entry.mark(lesson.id, student, cell.mark === mark ? null : mark);
                        }}
                      >
                        {mark}
                      </Button>
                    ))}
                  </span>
                ) : (
                  <span aria-label={t('journal.grid.attendance')}>
                    {cell === undefined || cell.closed ? (
                      <span className="text-muted-foreground">{t('journal.grid.closed')}</span>
                    ) : (
                      (cell.mark ?? '—')
                    )}
                  </span>
                )}
                {lesson.works.map((work, workIndex) => (
                  <span
                    key={work.id}
                    aria-label={
                      work.kind === 'classwork'
                        ? t('journal.grid.classworkShort', { number: work.position })
                        : t('journal.grid.homeworkShort', { number: work.position })
                    }
                  >
                    {cell?.works[workIndex]?.score ?? '—'}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The legend, always under the grid (`07`, Layout): the attendance marks, the
 * grade bands and the weights in force for this subject and quarter, with
 * "changed on" (`edge/calculation`, "Quarterly weights are changed in week 7").
 */
function Legend({ grid }: { grid: JournalGrid }) {
  const { t, i18n } = useTranslation();
  const { legend } = grid;
  return (
    <section className={`${PANEL} grid gap-3`} data-journal-legend="true">
      <h2 className={SECTION_TITLE}>{t('journal.legend.title')}</h2>
      <dl className="grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="font-semibold">{t('journal.legend.marks')}</dt>
          <dd>
            <ul>
              <li>1 — {t('journal.marks.present')}</li>
              <li>0 — {t('journal.marks.absent')}</li>
              <li>2 — {t('journal.marks.late')}</li>
              <li>3 — {t('journal.marks.skipped')}</li>
            </ul>
            <p className="text-muted-foreground">
              {t('journal.legend.values', { late: legend.lateValue, skipped: legend.skippedValue })}
            </p>
          </dd>
        </div>
        {!grid.journal.attendanceOnly && (
          <div>
            <dt className="font-semibold">{t('journal.legend.grades')}</dt>
            <dd>
              <ul className="grid gap-1">
                {GRADE_BANDS.map((band) => (
                  <li key={band.grade}>
                    <span className={cn('rounded-sm px-1.5 font-semibold', GRADE_TINT[band.grade])}>
                      {band.grade}
                    </span>{' '}
                    {t('journal.legend.band', { from: band.from, to: band.to })}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">{t('journal.legend.weights')}</dt>
          <dd>
            {grid.journal.attendanceOnly ? (
              <p>{t('journal.legend.attendanceOnly')}</p>
            ) : (
              <ul>
                {legend.daily !== null && (
                  <li>
                    {t('journal.legend.daily', {
                      attendance: legend.daily.attendance,
                      classwork: legend.daily.classwork,
                      homework: legend.daily.homework,
                    })}
                  </li>
                )}
                {legend.quarterly !== null && (
                  <li data-quarter-weights="true">
                    {legend.quarterly.ratingExam === null
                      ? t('journal.legend.quarterly', {
                          attendance: legend.quarterly.attendance,
                          classwork: legend.quarterly.classwork,
                          homework: legend.quarterly.homework,
                        })
                      : t('journal.legend.quarterlyRating', {
                          attendance: legend.quarterly.attendance,
                          classwork: legend.quarterly.classwork,
                          homework: legend.quarterly.homework,
                          ratingExam: legend.quarterly.ratingExam,
                        })}
                    {legend.weightsChangedOn !== null && (
                      <>
                        {' '}
                        {t('journal.legend.changedOn', {
                          date: schoolDateText(legend.weightsChangedOn, i18n.language),
                        })}
                      </>
                    )}
                  </li>
                )}
                <li className="text-muted-foreground">
                  {t('journal.legend.markers', {
                    provisional: t('journal.grid.provisionalShort'),
                    leftOut: t('journal.grid.leftOutShort'),
                  })}
                </li>
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
