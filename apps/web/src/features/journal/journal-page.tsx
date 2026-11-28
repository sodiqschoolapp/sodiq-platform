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
import { Link, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router';
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
import { monthsText, schoolDateText, weekdayName } from '@/lib/dates';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { ATTENDANCE_MARKS } from '@sodiq/shared';
import { Button } from '@/components/ui/button';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandMoreIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  EditIcon,
  UndoIcon,
  ViewColumnIcon,
} from '@/components/icons';
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
import { refusalText, type NumberRefusal } from './work-amount';
import { WorkKindTag, useWorkLabel } from './work-kind-tag';
import { useWorkName, useWorksEntry, workKey, type WorksEntry } from './works-entry';
import { LessonModeScore } from './lesson-mode-score';
import {
  correctionOf,
  EditPeriodPanel,
  ratingCorrectionOf,
  withCorrection,
  type Correcting,
} from './edit-period';
import { exportJournal, journalGridQuery } from './journal-api';
import {
  GRADE_TINT,
  JOURNAL_DEFAULT_HIDDEN,
  JournalGridView,
  MARK_TINT,
  NOT_GRADED_TEXT,
  hideableColumnsOf,
  weekdayOf,
} from './journal-grid';
import {
  JOURNAL_FILTERS,
  teacherJournals,
  type JournalFilter,
  type JournalSearch,
} from './journal-search';
import { yearText } from './journals-page';
import { CodedName } from '@/components/coded-name';

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
 * journal, Layout): the class or group and the subject as the title ("Sinf jurnali" in the
 * breadcrumbs, spec change of 18 November 2026), then Quarter · Month, then the teacher; the selectors; the grid, or lesson mode; the
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
  // The grid over the whole window (asked for by the owner, 27 October 2026); opened so from the
  // teacher home (`view=full`; owner, 13 November 2026).
  const [fullAsked, setFull] = useState(search.view === 'full');
  // The columns the person hid, kept in the browser like a list's (owner, 27 October 2026); a
  // browser with no choice hides every one but the photo (task 10.7; owner, 7 November 2026).
  const [hiddenColumns, setHiddenColumns] = useState(() =>
    readHiddenColumns(JOURNAL_COLUMNS, JOURNAL_DEFAULT_HIDDEN),
  );
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
  const [refusedNumber, setRefusedNumber] = useState<NumberRefusal | null>(null);
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
  // Full screen holds the grid only: lesson mode (a phone) or a quarter with no lessons stays.
  const full = fullAsked && hasGrid;
  useFullScreen(full, setFull);
  // Once full screen ends, the address no longer asks for it, so a reload keeps the page as is.
  const askedInAddress = search.view === 'full';
  useEffect(() => {
    if (!fullAsked && askedInAddress) go({ view: undefined });
  }, [fullAsked, askedInAddress, go]);
  // The router puts the window back at the top when a navigation ends (status "idle"): with the
  // journal already in the cache the page draws before that, and a scroll then would be undone.
  const routing = useRouterState({ select: (state) => state.status });
  useEffect(() => {
    if (!hasGrid || routing !== 'idle' || scrolledTo.current === data.journal.id) return;
    scrolledTo.current = data.journal.id;
    const panel = gridPanel.current;
    if (panel !== null && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'start' });
    }
  }, [hasGrid, routing, data.journal.id]);
  const scrollDate = search.date ?? data.today;
  const nearest = lessonNearest(data.lessons, scrollDate);

  const undoButton: ReactNode = data.lessons.some((one) => one.canEnter) && (
    <Button
      variant="secondary"
      // Its own width also where the selectors fold on a phone.
      className="justify-self-start"
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
          {refusalText(t, refusedNumber)}
        </p>
      )}
    </>
  );

  const header = [
    t('journal.page.quarterNumber', { number: data.quarter.number }),
    month === null
      ? monthsText(data.quarter.startDate, data.quarter.endDate, language)
      : monthName(month, language),
  ].join(' · ');

  return (
    <>
      <PageHeader
        title={[data.journal.unit.name, subject].join(' · ')}
        current={t('journal.sheet')}
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
              {data.teacher === null ? (
                <span>{t('journal.page.noTeacher')}</span>
              ) : (
                <span data-journal-teacher="true">
                  {t('journal.page.teacherLabel')}{' '}
                  {/* Owner, 28 November 2026: the name leads to the teacher's journals of the year. */}
                  <Link
                    to="/journal"
                    search={teacherJournals(data.teacher.id, data.journal.year.id)}
                    className="text-link"
                  >
                    {data.teacher.name}
                  </Link>
                </span>
              )}
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
          {/* On a phone the selectors fold away, so the lesson is near the top (owner, 20 November
              2026: the phone journal was "too bad"). */}
          <FoldOnPhone
            folded={narrow}
            label={t('journal.lessonMode.choose')}
            // A search or a filter in use is not folded out of sight.
            startOpen={search.q !== undefined || filter !== 'all'}
          >
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
              {!narrow && undoButton}
              <Link to="/journal" search={{ year: data.journal.year.id }} className="text-link">
                {t('journal.page.otherYear', { year: yearText(data.journal.year) })}
              </Link>
            </div>
          </FoldOnPhone>
          {narrow && undoButton}
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
            // Another date asked for starts lesson mode again at its lesson.
            key={nearest?.id ?? 'none'}
            grid={data}
            lesson={nearest}
            students={[...members, ...exempt, ...folded]}
            entry={entry}
            works={works}
            onRefusedNumber={setRefusedNumber}
          />
        ) : (
          <div
            ref={gridPanel}
            className={
              full
                ? 'fixed inset-0 z-40 flex flex-col gap-3 bg-background p-4'
                : `${PANEL} scroll-mt-4`
            }
            data-journal-grid-panel="true"
            data-journal-full-screen={full ? 'true' : undefined}
          >
            {/* Right above the grid, not among the selectors (owner, 13 November 2026). */}
            {!full && (
              <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
                <MarksStrip attendanceOnly={data.journal.attendanceOnly} />
                {columnsButton}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFull(true);
                  }}
                >
                  <FullscreenIcon aria-hidden="true" />
                  {t('journal.page.fullScreen')}
                </Button>
              </div>
            )}
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
                <MarksStrip attendanceOnly={data.journal.attendanceOnly} />
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

/** The column lesson mode enters: attendance, or one work by its key. */
const ATTENDANCE = 'a';

/**
 * Lesson mode (`07`, Lesson mode: "On a phone, one lesson is shown at a time
 * as a list of students"; decision 12): the lesson of the date asked, or the
 * nearest to today; task 6.3: the attendance marks as large buttons and
 * "All present" for a lesson the reader enters. The numbers of each classwork and homework
 * (`07`, Lesson mode: "attendance, then each classwork, then each homework"): a field per work
 * that saves as the grid does, and a button per work for its total (found missing on the test
 * site, 5 November 2026).
 *
 * Rebuilt for the phone (owner, 20 November 2026: the rows with works scrolled sideways and a
 * number could not be typed): the lessons before and after are a tap away, and a lesson with
 * works is entered one column at a time, in the spec's order: attendance, then each classwork,
 * then each homework. Each student is one row with the large buttons or a large number field, and
 * "Next: …" at the end of the list goes on to the next column. A lesson the reader only reads
 * shows every value of a student on its row.
 */
function LessonMode({
  grid,
  lesson: first,
  students,
  entry,
  works,
  onRefusedNumber,
}: {
  grid: JournalGrid;
  lesson: JournalLesson | null;
  students: readonly JournalStudent[];
  entry: AttendanceEntry;
  works: WorksEntry;
  onRefusedNumber: (refusal: NumberRefusal) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const workName = useWorkName();
  const workLabel = useWorkLabel();
  // The lesson shown: the nearest to the date at first, then the one the arrows move to.
  const [lessonId, setLessonId] = useState(first?.id ?? null);
  const [column, setColumn] = useState(ATTENDANCE);
  const lesson = grid.lessons.find((one) => one.id === lessonId) ?? first;
  if (lesson === null) {
    return (
      <div className={PANEL}>
        <EmptyState text={t('journal.page.noLessons')} />
      </div>
    );
  }
  const index = grid.lessons.indexOf(lesson);
  const before = grid.lessons[index - 1];
  const after = grid.lessons[index + 1];
  const moveTo = (other: JournalLesson) => {
    setLessonId(other.id);
    setColumn(ATTENDANCE);
  };
  const today = lesson.date === grid.today;
  // A lesson still to come: its closed cells wait empty, as in the grid (design review J6).
  const ahead = lesson.date > grid.today || (today && !lesson.held && lesson.cancelled === null);
  const closedText = ahead ? (
    '—'
  ) : (
    <span className="text-sm text-muted-foreground">{t('journal.grid.closed')}</span>
  );
  const opened = students.some((student) => student.cells[index]?.open === true);
  // One column at a time where the reader enters works; otherwise every value on the row.
  const columns =
    lesson.works.length > 0 && (lesson.canEnterWorks || opened)
      ? [ATTENDANCE, ...lesson.works.map((work) => workKey(work))]
      : null;
  const shown = columns === null || !columns.includes(column) ? ATTENDANCE : column;
  const workAt = lesson.works.findIndex((work) => workKey(work) === shown);
  const work = columns === null ? undefined : lesson.works[workAt];
  const nextColumn = columns === null ? undefined : columns[columns.indexOf(shown) + 1];
  const nextWork = lesson.works.find((one) => workKey(one) === nextColumn);
  const columnName = (one: JournalLesson['works'][number]) => workName(one);
  const totalText = (one: JournalLesson['works'][number]) =>
    one.total === null
      ? t('journal.lessonMode.setTotal', { work: columnName(one) })
      : t('journal.lessonMode.total', { work: columnName(one), total: one.total });
  const chooseColumn = (next: string) => {
    setColumn(next);
    // The new column starts at the top of the list.
    const top = document.querySelector('[data-lesson-mode-list]');
    if (top !== null && typeof top.scrollIntoView === 'function') {
      top.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };
  const status = lesson.status === null ? null : t(`journal.lessonStatus.${lesson.status}`);

  const markButtons = (student: JournalStudent) => {
    const cell = student.cells[index];
    if (cell === undefined) return null;
    // A cell being saved waits for its answer; the other students stay free (owner, 20 November
    // 2026: marks tapped one after another were lost while the first was saved).
    // ... and the read of the journal after it, so a second tap carries the new version.
    const waiting = entry.bulk || entry.waiting(lesson.id, student.id);
    return (
      <span
        role="group"
        aria-label={t('journal.grid.attendance')}
        className="grid grid-cols-4 gap-2 sm:flex sm:gap-1"
      >
        {ATTENDANCE_MARKS.map((mark) => (
          <Button
            key={mark}
            variant={cell.mark === mark ? 'default' : 'secondary'}
            className="min-w-11 text-base"
            aria-pressed={cell.mark === mark}
            aria-label={t('journal.entry.markButton', {
              mark,
              name: t(`journal.marks.${MARK_NAMES[mark]}`),
            })}
            title={t(`journal.marks.${MARK_NAMES[mark]}`)}
            disabled={waiting}
            onClick={() => {
              entry.mark(lesson.id, student, cell.mark === mark ? null : mark);
            }}
          >
            {mark}
          </Button>
        ))}
      </span>
    );
  };

  /** The mark of a student as text: the digit in its tint, "Closed", or a dash. */
  const markText = (student: JournalStudent) => {
    const cell = student.cells[index];
    if (cell === undefined || cell.closed) return closedText;
    if (cell.exempt !== null) {
      return (
        <span
          className="rounded-sm bg-muted px-1.5 text-muted-foreground"
          title={t(`journal.grid.exemptCell.${cell.exempt}`)}
        >
          {cell.exempt === 'full' ? 5 : 4}
        </span>
      );
    }
    return cell.mark === null ? (
      '—'
    ) : (
      <span className={cn('rounded-sm px-1.5', MARK_TINT[cell.mark])}>{cell.mark}</span>
    );
  };

  return (
    <section
      className={`${PANEL} grid gap-4 max-sm:px-4`}
      data-lesson-mode={lesson.id}
      aria-labelledby={`lesson-mode-${lesson.id}`}
    >
      {/* The lesson, with the lessons before and after it a tap away. */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('journal.lessonMode.previousLesson')}
          title={t('journal.lessonMode.previousLesson')}
          disabled={before === undefined}
          onClick={() => {
            if (before !== undefined) moveTo(before);
          }}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <div
          className={cn(
            'grid min-w-0 flex-1 gap-0.5 rounded-lg px-3 py-1.5 text-center',
            today && 'bg-today',
          )}
          aria-current={today ? 'date' : undefined}
          data-lesson-mode-today={today ? 'true' : undefined}
        >
          <h2 id={`lesson-mode-${lesson.id}`} className={SECTION_TITLE}>
            {today ? t('journal.grid.today') : weekdayName(language, weekdayOf(lesson.date))},{' '}
            {schoolDateText(lesson.date, language, false)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[
              lesson.slot === null ? null : t('journal.grid.slot', { number: lesson.slot }),
              `${timeText(lesson.start)}–${timeText(lesson.end)}`,
              status,
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
          {lesson.cancelled !== null && (
            <p className="text-sm font-semibold text-muted-foreground">
              {lesson.cancelled.reason === null
                ? t('journal.grid.cancelled')
                : t('journal.grid.cancelledReason', { reason: lesson.cancelled.reason })}
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('journal.lessonMode.nextLesson')}
          title={t('journal.lessonMode.nextLesson')}
          disabled={after === undefined}
          onClick={() => {
            if (after !== undefined) moveTo(after);
          }}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
      {/* Task 8.8 (`09`, In the journal): "In lesson mode on a phone, topic, classwork and
          homework are at the top of the screen". */}
      <div className="grid gap-1 text-sm" data-lesson-plan-top="true">
        <p>
          <span className="font-semibold">{t('journal.card.topic')}</span>{' '}
          {lesson.topic === null || lesson.topic === '' ? (
            t('journal.works.noPlan')
          ) : (
            // Task 11.27 (`09`, Codes: "lesson mode on a phone"): the code alone, the name on a tap.
            <CodedName short code={lesson.topicCode} name={lesson.topic} />
          )}
        </p>
        {lesson.works.some((one) => one.kind === 'classwork') && (
          <p>
            <span className="font-semibold">{t('journal.card.classworks')}</span>{' '}
            {lesson.works
              .filter((one) => one.kind === 'classwork')
              .map((one) => (
                // Task 10.7: the kind's tag in front of each work listed.
                <span
                  key={`${one.kind}:${String(one.position)}:${one.id ?? ''}`}
                  className="mr-2 inline-flex items-center gap-1"
                >
                  <WorkKindTag kind={one.kind} />
                  <CodedName
                    short
                    code={one.title === null ? null : one.code}
                    name={workName(one)}
                  />
                </span>
              ))}
          </p>
        )}
        {lesson.works.some((one) => one.kind === 'homework') && (
          <p>
            <span className="font-semibold">{t('journal.card.homeworks')}</span>{' '}
            {lesson.works
              .filter((one) => one.kind === 'homework')
              .map((one) => (
                <span
                  key={`${one.kind}:${String(one.position)}:${one.id ?? ''}`}
                  className="mr-2 inline-flex items-center gap-1"
                >
                  <WorkKindTag kind={one.kind} />
                  <CodedName
                    short
                    code={one.title === null ? null : one.code}
                    name={workName(one)}
                  />
                </span>
              ))}
          </p>
        )}
      </div>
      {/* The owner, 20 November 2026: one way to edit the lesson (topic, works, totals). */}
      {lesson.canEnterWorks && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="max-sm:w-full"
            disabled={works.busy}
            onClick={() => {
              works.openLesson(lesson);
            }}
          >
            <EditIcon aria-hidden="true" />
            {t('journal.editor.open')}
          </Button>
        </div>
      )}
      {/* One column at a time: attendance, then each classwork, then each homework. */}
      {columns !== null && (
        <div
          role="group"
          aria-label={t('journal.lessonMode.enter')}
          className="flex flex-wrap gap-2"
          data-lesson-mode-columns="true"
        >
          {lesson.works.length > 0 &&
            [ATTENDANCE, ...lesson.works.map((one) => workKey(one))].map((key) => {
              const one = lesson.works.find((candidate) => workKey(candidate) === key);
              const chosen = key === shown;
              return (
                <Button
                  key={key}
                  variant={chosen ? 'default' : 'secondary'}
                  aria-pressed={chosen}
                  aria-label={
                    one === undefined
                      ? t('journal.grid.attendance')
                      : workLabel(one.kind, columnName(one))
                  }
                  data-lesson-mode-column={key}
                  onClick={() => {
                    chooseColumn(key);
                  }}
                >
                  {one === undefined ? (
                    t('journal.grid.attendance')
                  ) : (
                    <>
                      <WorkKindTag kind={one.kind} />
                      <span className="max-w-40 truncate">{columnName(one)}</span>
                    </>
                  )}
                </Button>
              );
            })}
        </div>
      )}
      {/* What the column needs first: "All present", or the total of the work. */}
      {work === undefined ? (
        lesson.canEnter && (
          <Button
            className="max-sm:w-full"
            disabled={entry.busy}
            onClick={() => {
              entry.allPresent(lesson.id);
            }}
          >
            {t('journal.entry.allPresent')}
          </Button>
        )
      ) : !lesson.canEnterWorks ? (
        // Entered through an unlock: the total in view all the same (`07`, The total).
        <p className="flex items-center gap-1 text-sm font-semibold" data-lesson-mode-total="true">
          <WorkKindTag kind={work.kind} />
          {work.total === null
            ? t('journal.grid.totalUnset')
            : t('journal.grid.total', { total: work.total })}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={work.total === null ? 'default' : 'secondary'}
            className="max-sm:w-full"
            disabled={works.busy}
            // Task 10.7: the name says the kind in full in front of the visible words, which
            // it holds whole (WCAG 2.5.3, label in name); the tag shows the letter.
            aria-label={workLabel(work.kind, totalText(work))}
            onClick={() => {
              works.openWork(lesson, work);
            }}
          >
            <WorkKindTag kind={work.kind} />
            {totalText(work)}
          </Button>
        </div>
      )}
      <ul className="grid scroll-mt-24" data-lesson-mode-list={shown}>
        {students.map((student) => {
          const cell = student.cells[index];
          const name = (
            <span className="min-w-0 font-medium break-words">
              {student.lastName} {student.firstName}
            </span>
          );
          // A work's column: the student's mark beside the name, the number field at the right.
          if (work !== undefined) {
            const total = work.total;
            const enters =
              total !== null &&
              cell !== undefined &&
              !cell.closed &&
              (lesson.canEnterWorks || cell.open);
            return (
              <li
                key={student.id}
                className="flex min-h-14 items-center gap-3 border-b py-2 last:border-b-0"
                data-student={student.id}
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  {name}
                  <span
                    className="text-xs text-muted-foreground"
                    aria-label={t('journal.grid.attendance')}
                  >
                    {t('journal.grid.attendanceShort')} {markText(student)}
                  </span>
                </span>
                {enters ? (
                  <LessonModeScore
                    // A field of its own for each work: what is typed stays with its work.
                    key={workKey(work)}
                    lesson={lesson}
                    index={index}
                    work={{ ...work, total }}
                    workIndex={workAt}
                    student={student}
                    name={columnName(work)}
                    works={works}
                    onRefusedNumber={onRefusedNumber}
                  />
                ) : (
                  <span className="text-lg" aria-label={workLabel(work.kind, columnName(work))}>
                    {cell === undefined || cell.closed
                      ? closedText
                      : (cell.works[workAt]?.score ?? '—')}
                  </span>
                )}
              </li>
            );
          }
          // Attendance, with every value of the student on a lesson the reader only reads.
          const marks = lesson.canEnter && cell !== undefined && !cell.closed;
          return (
            <li
              key={student.id}
              className={cn(
                'flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b py-2 last:border-b-0',
                marks && 'max-sm:grid max-sm:justify-stretch',
              )}
              data-student={student.id}
            >
              {name}
              <span
                className={cn('flex flex-wrap items-center gap-3 text-lg', marks && 'max-sm:grid')}
              >
                {marks ? (
                  // Large buttons (`07`, Lesson mode): attendance first.
                  markButtons(student)
                ) : (
                  <span aria-label={t('journal.grid.attendance')}>
                    {cell === undefined || cell.closed ? closedText : (cell.mark ?? '—')}
                  </span>
                )}
                {columns === null &&
                  lesson.works.map((one, workIndex) => (
                    <span
                      key={`${one.kind}:${String(one.position)}:${one.id ?? ''}`}
                      className="inline-flex items-center gap-1"
                      aria-label={workLabel(one.kind, columnName(one))}
                    >
                      <WorkKindTag kind={one.kind} />
                      {cell?.works[workIndex]?.score ?? '—'}
                    </span>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
      {/* On to the next column at the end of the list. */}
      {nextWork !== undefined && (
        <Button
          variant="secondary"
          className="justify-self-end max-sm:w-full"
          data-lesson-mode-next="true"
          onClick={() => {
            chooseColumn(workKey(nextWork));
          }}
        >
          {t('journal.lessonMode.next', { column: columnName(nextWork) })}
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      )}
    </section>
  );
}

/** The selectors of the journal: as they are on a wider screen, folded under a summary on a phone. */
function FoldOnPhone({
  folded,
  label,
  startOpen,
  children,
}: {
  folded: boolean;
  label: string;
  startOpen: boolean;
  children: ReactNode;
}) {
  // Open at first while a search or filter is in use; the person folds it as they like.
  const [open] = useState(startOpen);
  if (!folded) return <>{children}</>;
  return (
    <details className="group" data-journal-choose="true" open={open}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <ExpandMoreIcon
          className="size-5 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        {label}
      </summary>
      <div className="mt-3 grid gap-4">{children}</div>
    </details>
  );
}

/**
 * The attendance marks right above the grid, in full screen too (the owner, 20 November 2026:
 * "these 4 marks should be at the top of the journal in full screen"), and the "-" a teacher
 * types for "not graded" in a graded journal. The whole legend stays under the grid.
 */
function MarksStrip({ attendanceOnly }: { attendanceOnly: boolean }) {
  const { t } = useTranslation();
  const marks: readonly [string, string][] = [
    ['1', t('journal.marks.present')],
    ['0', t('journal.marks.absent')],
    ['2', t('journal.marks.late')],
    ['3', t('journal.marks.skipped')],
    ...(attendanceOnly ? [] : [[NOT_GRADED_TEXT, t('journal.notGraded.sign')] as [string, string]]),
  ];
  return (
    <dl
      className="mr-auto flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm"
      aria-label={t('journal.legend.marks')}
      data-journal-marks="true"
    >
      {marks.map(([key, word]) => (
        <div key={key} className="flex items-center gap-1.5">
          <dt
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-md font-semibold',
              MARK_TINT[Number(key)] ?? 'bg-muted',
            )}
          >
            {key}
          </dt>
          <dd>{word}</dd>
        </div>
      ))}
    </dl>
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
                {legend.quarterly !== null && (
                  <li data-quarter-weights="true">
                    {legend.quarterly.ratingExam === null
                      ? t('journal.legend.quarterly', {
                          attendance: legend.quarterly.attendance,
                          classwork: legend.quarterly.classwork,
                          homework: legend.quarterly.homework,
                        })
                      : // A journal of grades 0 and 1 of a rating subject: the subject's one
                        // distribution, its rating exam left out (`05`, Grades 0 and 1).
                        !grid.journal.ratingExam
                        ? t('journal.legend.quarterlyNoRating', {
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
