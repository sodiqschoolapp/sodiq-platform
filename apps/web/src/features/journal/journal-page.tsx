import { RemindersPanel } from './reminders-panel';
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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, SelectField } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useMayView, useView } from '@/features/access/use-view';
import { TimetableFileButtons } from '@/features/timetable/timetable-file-buttons';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectChip } from '@/features/setup/subject-colour';
import { monthsText, schoolDateText } from '@/lib/dates';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { ATTENDANCE_MARKS } from '@sodiq/shared';
import { Button } from '@/components/ui/button';
import { FullscreenExitIcon, FullscreenIcon, UndoIcon, ViewColumnIcon } from '@/components/icons';
import { readHiddenColumns, storeHiddenColumns } from '@/components/list/list-state';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAttendanceEntry, type AttendanceEntry } from './attendance-entry';
import { useUndo } from './cell-saves';
import { useComments } from './comment-dialog';
import { useRatingEntry } from './rating-entry';
import { useWorksEntry } from './works-entry';
import {
  correctionOf,
  EditPeriodPanel,
  ratingCorrectionOf,
  withCorrection,
  type Correcting,
} from './edit-period';
import { exportJournal, journalGridQuery } from './journal-api';
import { GRADE_TINT, JournalGridView, hideableColumnsOf } from './journal-grid';
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
  grid: read,
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
  const [exemptOpen, setExemptOpen] = useState(false);
  // The grid over the whole window (asked for by the owner, 27 October 2026).
  const [full, setFull] = useState(false);
  useFullScreen(full, setFull);
  // The columns the person hid, kept in the browser like a list's (owner, 27 October 2026).
  const [hiddenColumns, setHiddenColumns] = useState(() => readHiddenColumns(JOURNAL_COLUMNS));
  // Task 8.9 (decision 1): the reader exports what the grid shows; a lesson reader does not.
  const mayExport = useMayView('journal', 'export');
  // Task 8.4: a correction of the Academic Vice Principal or the Super Admin opens one lesson,
  // or the rating exam, with the reason asked once for the visit; its saves carry it, the
  // comments on it included (code review 1, finding 2).
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  const data = withCorrection(read, correcting);
  // Lesson mode on a phone (`12`, Devices), or by the switch.
  const narrow = !useMinWidth(SM);
  // Task 8.3a: the undo of the person's own last action on the page (edge/journal, Undo).
  const undo = useUndo();
  const { entry, notices } = useAttendanceEntry(data, undo.record, correctionOf(correcting));
  // Task 8.1: works and numbers.
  const { works, dialogs } = useWorksEntry(data, undo.record, correctionOf(correcting));
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
  const { rating, dialogs: ratingDialogs } = useRatingEntry(data, ratingCorrectionOf(correcting));
  const { comments, dialogs: commentDialogs } = useComments(data, (cell) =>
    cell.target === 'rating'
      ? ratingCorrectionOf(correcting)
      : correctionOf(correcting)(cell.lessonId),
  );
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
  const listed = filter === 'left' ? [] : data.students.filter((one) => !one.folded && passes(one));
  // Task 8.5 (07, In the journal): "A student who is exempt for the whole month on screen is
  // moved to a folded 'Exempt' section at the bottom, with the dates."
  const exemptAll = (student: JournalStudent) => {
    const cells = data.lessons.flatMap((lesson, index) =>
      shownLessons.has(lesson.id) ? [student.cells[index]] : [],
    );
    return cells.length > 0 && cells.every((cell) => cell !== undefined && cell.exempt !== null);
  };
  const members = listed.filter((one) => !exemptAll(one));
  const exempt = listed.filter(exemptAll);
  const folded =
    filter === 'members' ? [] : data.students.filter((one) => one.folded && passes(one));
  const lessonMode = search.mode === 'lesson' || narrow;
  // Opening a journal brings its grid into view, below the selectors and the panels (owner,
  // 27 October 2026); once per journal, so a change of month or filter does not move the page.
  const gridPanel = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);
  const hasGrid = !lessonMode && data.lessons.length > 0;
  useEffect(() => {
    if (!hasGrid || scrolledTo.current === data.journal.id) return;
    scrolledTo.current = data.journal.id;
    const panel = gridPanel.current;
    if (panel !== null && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'start' });
    }
  }, [hasGrid, data.journal.id]);
  const scrollDate = search.date ?? data.today;
  const nearest = lessonNearest(data.lessons, scrollDate);

  const undoButton: ReactNode = data.lessons.some((one) => one.canEnter) && (
    <Button
      variant="secondary"
      disabled={!undo.available || undo.busy}
      onClick={undo.undo}
      title={t('journal.saving.undoHint')}
    >
      <UndoIcon aria-hidden="true" />
      {t('journal.saving.undo')}
    </Button>
  );
  const columnsButton: ReactNode = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        <ViewColumnIcon aria-hidden="true" />
        {t('list.columns')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {hideableColumnsOf(data, month).map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={!hiddenColumns.includes(column)}
            onCheckedChange={(shown) => {
              const next = shown
                ? hiddenColumns.filter((key) => key !== column)
                : [...hiddenColumns, column];
              setHiddenColumns(next);
              storeHiddenColumns(JOURNAL_COLUMNS, next);
            }}
          >
            {t(`journal.page.columnNames.${column}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // What a save tells the person stays in view in full screen too.
  const alerts = (
    <>
      {notices}
      {undo.notice}
      {refusedNumber !== null && (
        <p role="alert" className="text-sm text-destructive" data-refused-number="true">
          {t('journal.works.wholeNumber', { total: refusedNumber })}
        </p>
      )}
    </>
  );

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
      <PageHeader
        title={t('journal.sheet')}
        breadcrumbs={breadcrumbs}
        actions={
          // 07: "Export to Excel and PDF, and print, for a month or a quarter": the month shown,
          // or the quarter.
          !mayExport || data.shape === 'lessons' ? undefined : (
            <TimetableFileButtons
              send={(format) =>
                exportJournal(data.journal.id, {
                  quarterId: data.quarter.id,
                  format,
                  ...(month === null ? {} : { month }),
                })
              }
            />
          )
        }
      />
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
              {/* Task 9.2b: 07, "Journals of that quarter become read only". */}
              {data.quarter.closed && (
                <span className="font-semibold" data-quarter-closed="true">
                  {t('journal.page.quarterClosed')}
                </span>
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
            {!lessonMode && data.lessons.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setFull(true);
                }}
              >
                <FullscreenIcon aria-hidden="true" />
                {t('journal.page.fullScreen')}
              </Button>
            )}
            {!lessonMode && data.lessons.length > 0 && columnsButton}
            {undoButton}
            <Link to="/journal" search={{ year: data.journal.year.id }} className="text-link">
              {t('journal.page.otherYear', { year: yearText(data.journal.year) })}
            </Link>
          </div>
        </div>
        <EditPeriodPanel
          grid={read}
          correcting={correcting}
          onCorrect={setCorrecting}
          onStopCorrecting={() => {
            setCorrecting(null);
          }}
        />
        {/* Task 8.7 (`07`, Reminders): the panel of the journal, folded. */}
        {data.reminders.length > 0 && <RemindersPanel reminders={data.reminders} folded />}
        {!full && alerts}
        {dialogs}
        {ratingDialogs}
        {commentDialogs}
        {data.lessons.length === 0 ? (
          <div className={PANEL}>
            <EmptyState text={t('journal.page.noLessons')} />
          </div>
        ) : lessonMode ? (
          <LessonMode
            grid={data}
            lesson={nearest}
            students={[...members, ...exempt, ...folded]}
            entry={entry}
          />
        ) : (
          <div
            ref={gridPanel}
            className={
              full
                ? 'fixed inset-0 z-40 flex flex-col gap-3 bg-background p-4'
                : `${PANEL} scroll-mt-4`
            }
            data-journal-full-screen={full ? 'true' : undefined}
          >
            {full && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 truncate text-lg font-semibold">{header}</p>
                  {undoButton}
                  {columnsButton}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFull(false);
                    }}
                  >
                    <FullscreenExitIcon aria-hidden="true" />
                    {t('journal.page.exitFullScreen')}
                  </Button>
                </div>
                {alerts}
              </>
            )}
            <JournalGridView
              fill={full}
              hidden={hiddenColumns}
              grid={data}
              month={month}
              members={members}
              folded={folded}
              foldedCount={folded.length}
              foldedOpen={foldedOpen}
              onToggleFolded={() => {
                setFoldedOpen((open) => !open);
              }}
              exempt={exempt}
              exemptOpen={exemptOpen}
              onToggleExempt={() => {
                setExemptOpen((open) => !open);
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

/** Names the journal's hidden columns in the browser's storage (`sodiq.list.journal.hidden`). */
const JOURNAL_COLUMNS = 'journal';

/**
 * Full screen for the journal grid: the page draws it over the whole window, and the browser
 * is asked for its own full screen too (refused in some frames; the window then stays as it
 * is). Esc, or leaving the browser's full screen, ends it; an Esc inside a dialog is the
 * dialog's.
 */
function useFullScreen(full: boolean, setFull: (full: boolean) => void): void {
  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    if (document.fullscreenElement === null && typeof root.requestFullscreen === 'function') {
      root.requestFullscreen().catch(() => {
        // Not allowed here: the grid still covers the window.
      });
    }
    const onChange = () => {
      if (document.fullscreenElement === null) setFull(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return;
      setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement !== null && typeof document.exitFullscreen === 'function') {
        document.exitFullscreen().catch(() => {
          // Already left.
        });
      }
    };
  }, [full, setFull]);
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
      {/* Task 8.8 (`09`, In the journal): "In lesson mode on a phone, topic, classwork and
          homework are at the top of the screen". */}
      <div className="grid gap-1 text-sm" data-lesson-plan-top="true">
        <p>
          <span className="font-semibold">{t('journal.card.topic')}</span>{' '}
          {lesson.topic === null || lesson.topic === '' ? t('journal.works.noPlan') : lesson.topic}
        </p>
        {lesson.works.some((work) => work.kind === 'classwork') && (
          <p>
            <span className="font-semibold">{t('journal.card.classworks')}</span>{' '}
            {lesson.works
              .filter((work) => work.kind === 'classwork')
              .map(
                (work) => work.title ?? t('journal.grid.classworkShort', { number: work.position }),
              )
              .join(', ')}
          </p>
        )}
        {lesson.works.some((work) => work.kind === 'homework') && (
          <p>
            <span className="font-semibold">{t('journal.card.checkedToday')}</span>{' '}
            {lesson.works
              .filter((work) => work.kind === 'homework')
              .map(
                (work) => work.title ?? t('journal.grid.homeworkShort', { number: work.position }),
              )
              .join(', ')}
          </p>
        )}
        {lesson.given.some((one) => !one.notGiven) && (
          <p>
            <span className="font-semibold">{t('journal.card.givenToday')}</span>{' '}
            {lesson.given
              .filter((one) => !one.notGiven)
              .map((one, at) => one.title ?? t('journal.grid.homeworkShort', { number: at + 1 }))
              .join(', ')}
          </p>
        )}
      </div>
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
                {/* Task 9.1 (edge/academic-year, start quarter): "from <date>". */}
                {legend.countsFrom !== null && (
                  <li data-counts-from={legend.countsFrom}>
                    {t('results.labels.countsFrom', {
                      date: schoolDateText(legend.countsFrom, i18n.language),
                    })}
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
