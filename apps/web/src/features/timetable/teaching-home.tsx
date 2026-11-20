import {
  timeText,
  type HomeBusy,
  type HomeExam,
  type HomeLesson,
  type TeachingHome,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ExemptionCards } from '@/features/journal/exemption-cards';
import { remindersQuery } from '@/features/journal/journal-api';
import { RemindersPanel } from '@/features/journal/reminders-panel';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useSwitchBranch } from '@/features/access/use-switch-branch';
import { useView } from '@/features/access/use-view';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { cn } from '@/lib/utils';
import { teachingHomeQuery } from './timetable-api';
import { useLessonMarks } from './views-page';

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

type Weekday = Parameters<typeof weekdayName>[1];

const weekdayOf = (date: string): Weekday => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
};

/** One thing of the person's day: a lesson, an exam, or a busy block of another branch. */
type Item =
  | { kind: 'lesson'; key: string; at: HomeLesson }
  | { kind: 'exam'; key: string; at: HomeExam }
  | { kind: 'busy'; key: string; at: HomeBusy };

/** Every item of the answer in order of its real start moment, across branches (decision 3). */
const itemsOf = (home: TeachingHome): Item[] =>
  [
    ...home.lessons.map((at) => ({ kind: 'lesson' as const, key: `lesson-${at.id}`, at })),
    ...home.exams.map((at) => ({ kind: 'exam' as const, key: `exam-${at.id}`, at })),
    ...home.busy.map((at) => ({
      kind: 'busy' as const,
      key: `busy-${at.branch.id}-${at.startsAt}`,
      at,
    })),
  ].sort(
    (a, b) =>
      a.at.startsAt.localeCompare(b.at.startsAt) ||
      a.at.branch.name.localeCompare(b.at.branch.name),
  );

/** How often the today list looks at the time again: a re-render, never a call to the API. */
const NOW_TICK_MS = 30_000;

/**
 * The server's time now (task 10.7): the moment the home answer carried (`now`, the injected
 * clock, the demo clock where it is on) moved on by the time since the answer arrived, so a
 * browser whose own clock is wrong still marks the right lesson. A timer draws the page again;
 * it asks the server nothing (`.claude/rules/web.md`: nothing calls the API on a timer).
 */
function useServerNow(now: string | undefined, receivedAt: number): number | null {
  // The browser's clock as last looked at, kept in state so a render stays pure.
  const [looked, setLooked] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLooked(Date.now());
    }, NOW_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  // An answer newer than the last look is taken at its own moment.
  return now === undefined ? null : Date.parse(now) + Math.max(0, looked - receivedAt);
}

/**
 * The lesson happening now (`12`, Home page): a lesson of today that this teacher gives, from
 * its start to its end. A cancelled lesson, one a substitute took (`replacedHere`), an exam and
 * a busy block of another branch are never it (decision 3).
 */
const isNow = (item: Item, now: number | null): boolean =>
  now !== null &&
  item.kind === 'lesson' &&
  item.at.today &&
  item.at.cancelCause === null &&
  !item.at.replacedHere &&
  Date.parse(item.at.startsAt) <= now &&
  now < Date.parse(item.at.endsAt);

/**
 * The lessons part of the home page of a person who teaches (task 5.9b, pull
 * request #198; `06`, Teachers who work in several branches: "Today's lessons
 * from all branches appear together in time order, each labelled with its
 * branch"; Views and outputs: "Teacher home page: today's lessons as a list
 * (period, time, class or group, subject, room, button to open the journal)
 * and the week as a table"). The journal button came with the journal (6.2).
 * The branch is named on every item once the week holds more than one.
 */
export function TeachingHome(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const language = languageOf(i18n.language);
  const home = useQuery(teachingHomeQuery(branchId));
  // Task 8.7: the caller's reminders in the branch in use.
  const reminders = useQuery(remindersQuery(branchId));
  const now = useServerNow(home.data?.now, home.dataUpdatedAt);
  if (home.isError) {
    return (
      <section className={PANEL}>
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      </section>
    );
  }
  if (home.data === undefined) {
    return (
      <section className={PANEL}>
        <LoadingOutline />
      </section>
    );
  }
  const items = itemsOf(home.data);
  const branches = new Set(items.map((item) => item.at.branch.id));
  const named = branches.size > 1;
  // Task 8.7 (`07`, Lesson status: "The home page sums it up, for example '3 of 5 lessons complete'").
  const held = items.flatMap((item) =>
    item.kind === 'lesson' && item.at.today && item.at.status !== null ? [item.at.status] : [],
  );
  return (
    <div className="grid gap-6">
      <section className={`${PANEL} grid gap-4`} data-home-today="true">
        <h2 className={SECTION_TITLE}>
          {t('home.lessons.today')}, {schoolDateText(home.data.today, language)}
        </h2>
        {held.length > 0 && (
          <p className="text-sm font-semibold" data-home-summary="true">
            {t('journal.lessonStatus.summary', {
              count: held.length,
              done: held.filter((one) => one === 'complete').length,
            })}
          </p>
        )}
        <TodayList
          items={items.filter((item) => item.at.today)}
          now={now}
          named={named}
          language={language}
        />
      </section>
      <RemindersPanel
        reminders={reminders.data?.reminders}
        error={reminders.isError ? reminders.error : undefined}
        onRetry={() => void reminders.refetch()}
      />
      {/* Task 8.5: exempt today and back from exemption. */}
      <ExemptionCards />
      <section className={`${PANEL} grid gap-4`} data-home-week="true">
        <h2 className={SECTION_TITLE}>
          {t('home.lessons.week')},{' '}
          {t('home.attention.range', {
            from: schoolDateText(home.data.week.from, language, false),
            to: schoolDateText(home.data.week.to, language, false),
          })}
        </h2>
        <WeekTable home={home.data} items={items} named={named} language={language} />
      </section>
    </div>
  );
}

/** The words of an item: what it is, the class or group, the subject, the room, its marks. */
function useItemText(language: Language) {
  const { t } = useTranslation();
  const marks = useLessonMarks();
  return (item: Item, named: boolean): string[] => {
    const branch = named ? [item.at.branch.name] : [];
    if (item.kind === 'busy') return [t('timetable.views.busyIn', { branch: item.at.branch.name })];
    if (item.kind === 'exam') {
      return [
        t('timetable.day.exam'),
        item.at.title,
        ...item.at.rooms.flatMap((room) => room.units),
        ...item.at.rooms.map((room) => room.room.name),
        ...branch,
      ];
    }
    const lesson = item.at;
    return [
      lesson.subject.names[language],
      lesson.unit.name,
      lesson.room?.name ?? '',
      ...branch,
      ...marks(lesson),
      ...(lesson.status === null ? [] : [t(`journal.lessonStatus.${lesson.status}`)]),
    ].filter((one) => one !== '');
  };
}

function TodayList({
  items,
  now,
  named,
  language,
}: {
  items: Item[];
  /** The server's time now, `null` before the answer. */
  now: number | null;
  named: boolean;
  language: Language;
}) {
  const { t } = useTranslation();
  const marks = useLessonMarks();
  const phone = !useMinWidth(SM);
  if (items.length === 0) return <EmptyState text={t('home.lessons.noToday')} />;
  if (phone) return <TodayCards items={items} now={now} named={named} language={language} />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('timetable.views.lesson')}</TableHead>
            <TableHead>{t('timetable.day.time')}</TableHead>
            <TableHead>{t('timetable.day.unit')}</TableHead>
            <TableHead>{t('timetable.day.subject')}</TableHead>
            <TableHead>{t('timetable.day.room')}</TableHead>
            {named && <TableHead>{t('home.lessons.branch')}</TableHead>}
            <TableHead>{t('timetable.day.state')}</TableHead>
            <TableHead>{t('journal.page.journalColumn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const time = `${timeText(item.at.start)}–${timeText(item.at.end)}`;
            const branch = named ? <TableCell>{item.at.branch.name}</TableCell> : null;
            if (item.kind === 'busy') {
              return (
                <TableRow key={item.key} data-busy="true" className="bg-muted">
                  <TableCell />
                  <TableCell>{time}</TableCell>
                  <TableCell colSpan={3}>
                    {t('timetable.views.busyIn', { branch: item.at.branch.name })}
                  </TableCell>
                  {branch}
                  <TableCell />
                  <TableCell />
                </TableRow>
              );
            }
            if (item.kind === 'exam') {
              const exam = item.at;
              return (
                <TableRow key={item.key} data-exam={exam.id}>
                  <TableCell />
                  <TableCell>{time}</TableCell>
                  <TableCell>{exam.rooms.flatMap((room) => room.units).join(', ')}</TableCell>
                  <TableCell>
                    {exam.title}
                    {exam.subject !== null && <> · {exam.subject.names[language]}</>}
                  </TableCell>
                  <TableCell>{exam.rooms.map((room) => room.room.name).join(', ')}</TableCell>
                  {branch}
                  <TableCell className="font-semibold">{t('timetable.day.exam')}</TableCell>
                  <TableCell />
                </TableRow>
              );
            }
            const lesson = item.at;
            // Task 10.7: the row of the lesson happening now is highlighted (the open-row fill and
            // semibold text, so not by colour alone) and named the current time for screen
            // readers; no badge and no extra text (decision 4).
            const current = isNow(item, now);
            return (
              <TableRow
                key={item.key}
                data-lesson={lesson.id}
                {...(current
                  ? {
                      'data-now': 'true',
                      'aria-current': 'time' as const,
                      className: 'bg-today font-semibold',
                    }
                  : {})}
              >
                <TableCell>{lesson.lessonNumber ?? ''}</TableCell>
                <TableCell>{time}</TableCell>
                <TableCell>{lesson.unit.name}</TableCell>
                <TableCell>{lesson.subject.names[language]}</TableCell>
                <TableCell>{lesson.room?.name ?? ''}</TableCell>
                {branch}
                <TableCell>
                  {marks(lesson).join(' · ') || t('timetable.day.asPlanned')}
                  {lesson.status !== null && (
                    <span className="ml-2 font-semibold" data-status={lesson.status}>
                      {t(`journal.lessonStatus.${lesson.status}`)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {lesson.journalId !== null && (
                    <OpenJournal
                      now={current}
                      journalId={lesson.journalId}
                      date={lesson.date}
                      branchId={lesson.branch.id}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Today's lessons on a phone (owner, 20 November 2026: the table scrolled sideways to reach the
 * journal button, "a copy of the laptop version"): one card a lesson, in time order. The lesson
 * number and the time first, then the class or group and the subject, the room (and the branch),
 * the marks and the status, and "Open the journal" the width of the card, a thumb's reach away.
 * The lesson happening now has the `--today` fill and semibold text, as its row on a computer.
 */
function TodayCards({
  items,
  now,
  named,
  language,
}: {
  items: Item[];
  now: number | null;
  named: boolean;
  language: Language;
}) {
  const { t } = useTranslation();
  const marks = useLessonMarks();
  return (
    <ul className="grid gap-3" data-home-today-list="true">
      {items.map((item) => {
        const time = `${timeText(item.at.start)}–${timeText(item.at.end)}`;
        const branch = named ? item.at.branch.name : null;
        if (item.kind === 'busy') {
          return (
            <li
              key={item.key}
              data-busy="true"
              className="grid gap-0.5 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground"
            >
              <span className="font-semibold tabular-nums">{time}</span>
              <span>{t('timetable.views.busyIn', { branch: item.at.branch.name })}</span>
            </li>
          );
        }
        if (item.kind === 'exam') {
          const exam = item.at;
          return (
            <li
              key={item.key}
              data-exam={exam.id}
              className="grid gap-0.5 rounded-lg border px-4 py-3 text-sm"
            >
              <span className="font-semibold tabular-nums">
                {time} · {t('timetable.day.exam')}
              </span>
              <span>
                {exam.title}
                {exam.subject !== null && <> · {exam.subject.names[language]}</>}
              </span>
              <span className="text-muted-foreground">
                {[
                  ...exam.rooms.flatMap((room) => room.units),
                  ...exam.rooms.map((room) => room.room.name),
                  ...(branch === null ? [] : [branch]),
                ].join(' · ')}
              </span>
            </li>
          );
        }
        const lesson = item.at;
        const current = isNow(item, now);
        // "As planned" when nothing changed, as on the row of a computer.
        const state = marks(lesson).join(' · ') || t('timetable.day.asPlanned');
        return (
          <li
            key={item.key}
            data-lesson={lesson.id}
            className={cn('grid gap-3 rounded-lg border px-4 py-3', current && 'bg-today')}
            {...(current ? { 'data-now': 'true', 'aria-current': 'time' as const } : {})}
          >
            <div className="flex items-start gap-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className={cn('tabular-nums', current ? 'font-bold' : 'font-semibold')}>
                  {[
                    lesson.lessonNumber === null
                      ? null
                      : t('journal.grid.slot', { number: lesson.lessonNumber }),
                    time,
                  ]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
                <span className={cn('text-base', current ? 'font-bold' : 'font-semibold')}>
                  {lesson.unit.name} · {lesson.subject.names[language]}
                </span>
                {(lesson.room !== null || branch !== null) && (
                  <span className="text-sm text-muted-foreground">
                    {[
                      lesson.room === null
                        ? null
                        : `${t('timetable.day.room')} ${lesson.room.name}`,
                      branch,
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                )}
                {(state !== '' || lesson.status !== null) && (
                  <span className="text-sm">
                    {state}
                    {lesson.status !== null && (
                      <span
                        className={cn('font-semibold', state !== '' && 'ml-2')}
                        data-status={lesson.status}
                      >
                        {t(`journal.lessonStatus.${lesson.status}`)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            {lesson.journalId !== null && (
              <OpenJournal
                now={current}
                journalId={lesson.journalId}
                date={lesson.date}
                branchId={lesson.branch.id}
                wide
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The button that opens the journal of a lesson of today (task 6.2, From 5.9b:
 * "button to open the journal"), at the lesson's date, in its own branch: a
 * lesson of another branch switches the tab's branch first, through
 * `useSwitchBranch`, so the journal is read with that branch.
 */
function OpenJournal({
  now,
  journalId,
  date,
  branchId,
  wide = false,
}: {
  /** Task 10.7: the lesson happening now; its button pulses, unless reduced motion is asked for. */
  now: boolean;
  journalId: string;
  date: string;
  branchId: string;
  /** On a phone's lesson card: a full-width button, primary for the lesson happening now. */
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const { branchId: current } = useView();
  const navigate = useNavigate();
  const switchBranch = useSwitchBranch();
  const open = () => {
    // The journal opens with its grid over the whole window (owner, 13 November 2026).
    void navigate({
      to: '/journal/$journalId',
      params: { journalId },
      search: { date, view: 'full' },
    });
  };
  return (
    <Button
      variant={wide && now ? 'default' : 'secondary'}
      size={wide ? 'default' : 'sm'}
      // `motion-safe:` only: under prefers-reduced-motion no animation applies (`12`, Home page).
      className={cn(wide && 'w-full', now && 'motion-safe:animate-now-pulse')}
      {...(now ? { 'data-pulse': 'true' } : {})}
      onClick={() => {
        if (branchId === current) {
          open();
          return;
        }
        void switchBranch(branchId).then((switched) => {
          if (switched) open();
        });
      }}
    >
      {t('journal.open')}
    </Button>
  );
}

/**
 * The week as a table: the days as columns, rows by clock time, since the
 * lessons of two branches can follow different templates (5.9a decision 10).
 */
function WeekTable({
  home,
  items,
  named,
  language,
}: {
  home: TeachingHome;
  items: Item[];
  named: boolean;
  language: Language;
}) {
  const { t } = useTranslation();
  const text = useItemText(language);
  const phone = !useMinWidth(SM);
  const dates = [
    ...new Set([...home.days.map((day) => day.date), ...items.map((item) => item.at.date)]),
  ].sort();
  const dayOffs = home.days.filter((day) => day.dayOff !== null);
  // A day off is named also in a week with nothing else in it.
  const dayOffLines = dayOffs.map((day) => (
    <p key={`${day.branch.id}-${day.date}`} className="text-sm" data-day-off={day.date}>
      {t('home.lessons.dayOffIn', {
        date: schoolDateText(day.date, language, false),
        branch: day.branch.name,
        name: day.dayOff ?? '',
      })}
    </p>
  ));
  if (items.length === 0) {
    return (
      <div className="grid gap-4">
        <EmptyState text={t('home.lessons.noWeek')} />
        {dayOffLines}
      </div>
    );
  }
  if (phone) {
    // On a phone the week is a list by day: a table of five days scrolled sideways (owner, 20
    // November 2026).
    return (
      <div className="grid gap-4" data-home-week-list="true">
        {dates.map((date) => (
          <section key={date} className="grid gap-1" aria-labelledby={`home-week-${date}`}>
            <h3 id={`home-week-${date}`} className={SECTION_TITLE}>
              {weekdayName(language, weekdayOf(date))}, {schoolDateText(date, language, false)}
            </h3>
            <ul className="grid">
              {items
                .filter((item) => item.at.date === date)
                .map((item) => (
                  <li
                    key={item.key}
                    className="flex gap-3 border-b py-2 text-sm last:border-b-0"
                    {...(item.kind === 'busy' ? { 'data-busy': 'true' } : {})}
                  >
                    <span className="w-24 shrink-0 font-semibold tabular-nums">
                      {timeText(item.at.start)}–{timeText(item.at.end)}
                    </span>
                    <span
                      className={cn('min-w-0', item.kind === 'busy' && 'text-muted-foreground')}
                    >
                      {text(item, named).join(' · ')}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {dayOffLines}
      </div>
    );
  }
  const rows = [
    ...new Map(
      items.map((item) => [`${String(item.at.start)}-${String(item.at.end)}`, item.at] as const),
    ).values(),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('timetable.day.time')}</TableHead>
              {dates.map((date) => (
                <TableHead key={date}>
                  {weekdayName(language, weekdayOf(date))}, {schoolDateText(date, language, false)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${String(row.start)}-${String(row.end)}`}>
                <TableCell className="font-semibold">
                  {timeText(row.start)}–{timeText(row.end)}
                </TableCell>
                {dates.map((date) => (
                  <TableCell key={date}>
                    {items
                      .filter(
                        (item) =>
                          item.at.date === date &&
                          item.at.start === row.start &&
                          item.at.end === row.end,
                      )
                      .map((item) => (
                        <p
                          key={item.key}
                          {...(item.kind === 'busy'
                            ? { 'data-busy': 'true', className: 'text-muted-foreground' }
                            : {})}
                        >
                          {text(item, named).join(' · ')}
                        </p>
                      ))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dayOffLines}
    </div>
  );
}
