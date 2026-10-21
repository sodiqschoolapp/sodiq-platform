import {
  timeText,
  type HomeBusy,
  type HomeExam,
  type HomeLesson,
  type TeachingHome,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
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
import { useView } from '@/features/access/use-view';
import { schoolDateText, weekdayName } from '@/lib/dates';
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

/**
 * The lessons part of the home page of a person who teaches (task 5.9b, pull
 * request #198; `06`, Teachers who work in several branches: "Today's lessons
 * from all branches appear together in time order, each labelled with its
 * branch"; Views and outputs: "Teacher home page: today's lessons as a list
 * (period, time, class or group, subject, room, button to open the journal)
 * and the week as a table"). The journal button comes with the journal (6.2).
 * The branch is named on every item once the week holds more than one.
 */
export function TeachingHome(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const language = languageOf(i18n.language);
  const home = useQuery(teachingHomeQuery(branchId));
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
  return (
    <div className="grid gap-6">
      <section className={`${PANEL} grid gap-4`} data-home-today="true">
        <h2 className={SECTION_TITLE}>
          {t('home.lessons.today')}, {schoolDateText(home.data.today, language)}
        </h2>
        <TodayList
          items={items.filter((item) => item.at.today)}
          named={named}
          language={language}
        />
      </section>
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
    ].filter((one) => one !== '');
  };
}

function TodayList({
  items,
  named,
  language,
}: {
  items: Item[];
  named: boolean;
  language: Language;
}) {
  const { t } = useTranslation();
  const marks = useLessonMarks();
  if (items.length === 0) return <EmptyState text={t('home.lessons.noToday')} />;
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
                </TableRow>
              );
            }
            const lesson = item.at;
            return (
              <TableRow key={item.key} data-lesson={lesson.id}>
                <TableCell>{lesson.lessonNumber ?? ''}</TableCell>
                <TableCell>{time}</TableCell>
                <TableCell>{lesson.unit.name}</TableCell>
                <TableCell>{lesson.subject.names[language]}</TableCell>
                <TableCell>{lesson.room?.name ?? ''}</TableCell>
                {branch}
                <TableCell>{marks(lesson).join(' · ') || t('timetable.day.asPlanned')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
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
  const dates = [
    ...new Set([...home.days.map((day) => day.date), ...items.map((item) => item.at.date)]),
  ].sort();
  const dayOffs = home.days.filter((day) => day.dayOff !== null);
  if (items.length === 0) {
    return <EmptyState text={t('home.lessons.noWeek')} />;
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
                            ? { 'data-busy': 'true', className: 'text-muted' }
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
      {dayOffs.map((day) => (
        <p key={`${day.branch.id}-${day.date}`} className="text-sm">
          {t('home.lessons.dayOffIn', {
            date: schoolDateText(day.date, language, false),
            branch: day.branch.name,
            name: day.dayOff ?? '',
          })}
        </p>
      ))}
    </div>
  );
}
