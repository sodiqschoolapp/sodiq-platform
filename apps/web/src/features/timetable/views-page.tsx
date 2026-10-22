import {
  PERMISSIONS,
  permits,
  timeText,
  type TimetableView,
  type ViewBusy,
  type ViewDay,
  type ViewExam,
  type ViewKind,
  type ViewLesson,
  type ViewSpan,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { DateField, SelectField } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
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
import { timetableViewQuery, viewChoicesQuery } from './timetable-api';
import type { ViewsSearch } from './views-search';

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

type Weekday = Parameters<typeof weekdayName>[1];

/** The ISO weekday of a school date, Monday 1 to Sunday 7, read as a calendar day. */
const weekdayOf = (date: string): Weekday => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
};

/** One thing of a day the view lists: a lesson, an exam, or a busy block of another branch. */
type Item =
  | { kind: 'lesson'; start: number; end: number; lesson: ViewLesson }
  | { kind: 'exam'; start: number; end: number; exam: ViewExam }
  | { kind: 'busy'; start: number; end: number; busy: ViewBusy };

const itemsOf = (view: TimetableView, date: string): Item[] =>
  [
    ...view.lessons
      .filter((one) => one.date === date)
      .map((lesson) => ({ kind: 'lesson' as const, start: lesson.start, end: lesson.end, lesson })),
    ...view.exams
      .filter((one) => one.date === date)
      .map((exam) => ({ kind: 'exam' as const, start: exam.start, end: exam.end, exam })),
    ...view.busy
      .filter((one) => one.date === date)
      .map((busy) => ({ kind: 'busy' as const, start: busy.start, end: busy.end, busy })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

/**
 * The timetable views (task 5.9a, pull request #197; `06`, Views and outputs:
 * "Views by class, by teacher, by room and the whole school; by day and by
 * week"): read only, from the dated lessons with every one-day change. What a
 * role may open comes from the server (`choices`), which also refuses the
 * rest; the marks are words ("Changed", "Exam", "Cancelled: <reason>"), as on
 * the day page.
 */
export function ViewsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ViewsSearch = useSearch({ from: '/app/timetable/views' });
  const { role, branchId } = useView();
  const language = languageOf(i18n.language);
  const drafts = role !== null && permits(PERMISSIONS, role, 'timetable', 'view');
  // Without a date in the address, the server answers for today in the branch and names it.
  const choices = useQuery(viewChoicesQuery(branchId, search.date ?? null));
  const date = search.date ?? choices.data?.today ?? null;
  const span: ViewSpan = search.span ?? 'day';

  const offered = choices.data;
  const kinds: ViewKind[] =
    offered === undefined
      ? []
      : [
          ...(offered.branch ? (['branch'] as const) : []),
          ...(offered.classes.length > 0 ? (['class'] as const) : []),
          ...(offered.teachers.length > 0 ? (['teacher'] as const) : []),
          ...(offered.rooms.length > 0 ? (['room'] as const) : []),
        ];
  // The caller's own teacher view first, when that is all there is to choose.
  const kind: ViewKind | null =
    search.kind !== undefined && kinds.includes(search.kind)
      ? search.kind
      : (kinds.find((one) => one === 'teacher' && offered?.own !== null && !offered?.branch) ??
        kinds[0] ??
        null);
  const subjects =
    offered === undefined || kind === null || kind === 'branch'
      ? []
      : kind === 'class'
        ? offered.classes
        : kind === 'teacher'
          ? offered.teachers
          : offered.rooms;
  const id =
    kind === 'branch'
      ? null
      : search.id !== undefined && subjects.some((one) => one.id === search.id)
        ? search.id
        : (subjects[0]?.id ?? null);
  const view = useQuery({
    ...timetableViewQuery(branchId, { kind: kind ?? 'branch', id, date, span }),
    enabled:
      branchId !== null && date !== null && kind !== null && (kind === 'branch' || id !== null),
  });

  const go = (next: ViewsSearch) => {
    void navigate({
      to: '/timetable/views',
      search: {
        ...(kind === null ? {} : { kind }),
        ...(id === null ? {} : { id }),
        ...(date === null ? {} : { date }),
        span,
        ...next,
      },
    });
  };

  const header = (
    <PageHeader
      title={t('timetable.views.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        ...(drafts ? [{ label: t('timetable.title'), to: '/timetable' as const }] : []),
      ]}
    />
  );
  if (choices.isError) {
    return (
      <>
        {header}
        <ErrorState error={choices.error} onRetry={() => void choices.refetch()} />
      </>
    );
  }
  if (offered === undefined || date === null) {
    return (
      <>
        {header}
        <LoadingOutline />
      </>
    );
  }
  if (kind === null) {
    return (
      <>
        {header}
        <EmptyState text={t('timetable.views.nothing')} />
      </>
    );
  }

  const kindLabel: Record<ViewKind, string> = {
    branch: t('timetable.views.kind_branch'),
    class: t('timetable.views.kind_class'),
    teacher: t('timetable.views.kind_teacher'),
    room: t('timetable.views.kind_room'),
  };

  return (
    <>
      {header}
      <div className="grid gap-6">
        <div className={`${PANEL} grid gap-4`}>
          {kinds.length > 1 && (
            <Segmented
              label={t('timetable.views.kind')}
              options={kinds.map((one) => ({ value: one, label: kindLabel[one] }))}
              value={kind}
              onChange={(value) => {
                go({ kind: value, id: undefined });
              }}
            />
          )}
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            {kind !== 'branch' && id !== null && (
              <SelectField
                label={kindLabel[kind]}
                value={id}
                options={subjects.map((one) => ({ value: one.id, label: one.name }))}
                onChange={(event) => {
                  go({ id: event.target.value });
                }}
              />
            )}
            <DateField
              label={t('timetable.views.date')}
              value={date}
              onChange={(event) => {
                if (event.target.value !== '') go({ date: event.target.value });
              }}
            />
          </div>
          <Segmented
            label={t('timetable.views.span')}
            options={[
              { value: 'day', label: t('timetable.views.span_day') },
              { value: 'week', label: t('timetable.views.span_week') },
            ]}
            value={span}
            onChange={(value) => {
              go({ span: value });
            }}
          />
        </div>
        <div className={PANEL}>
          {view.isError ? (
            <ErrorState error={view.error} onRetry={() => void view.refetch()} />
          ) : view.data === undefined ? (
            <LoadingOutline />
          ) : (
            <ViewBody view={view.data} language={language} />
          )}
        </div>
      </div>
    </>
  );
}

function ViewBody({ view, language }: { view: TimetableView; language: Language }) {
  const { t } = useTranslation();
  if (view.days.length === 0) {
    return <EmptyState text={t('timetable.views.empty')} />;
  }
  const versionLines = [
    ...new Map(
      view.days.flatMap((day) =>
        day.version === null ? [] : [[day.version.number, day.version] as const],
      ),
    ).values(),
  ];
  return (
    <div className="grid gap-6">
      <p className="text-sm" data-version-line="true">
        {versionLines.length === 0
          ? t('timetable.views.noVersion')
          : versionLines
              .map((one) =>
                t('timetable.views.version', {
                  number: one.number,
                  date: schoolDateText(one.startsOn, language),
                }),
              )
              .join(' · ')}
      </p>
      {view.span === 'week' && view.kind !== 'branch' ? (
        <WeekGrid view={view} language={language} />
      ) : (
        view.days.map((day) => (
          <section key={day.date} className="grid gap-2" data-day={day.date}>
            <DayHeading day={day} language={language} />
            {view.kind === 'branch' ? (
              <SchoolDay view={view} day={day} language={language} />
            ) : (
              <DayTable items={itemsOf(view, day.date)} language={language} />
            )}
          </section>
        ))
      )}
    </div>
  );
}

function DayHeading({ day, language }: { day: ViewDay; language: Language }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1">
      <h2 className={SECTION_TITLE}>
        {weekdayName(language, weekdayOf(day.date))}, {schoolDateText(day.date, language)}
      </h2>
      {day.outsideYear && (
        <p className="text-sm text-muted-foreground">{t('timetable.views.outsideYear')}</p>
      )}
      {!day.outsideYear && day.version === null && (
        <p className="text-sm text-muted-foreground">{t('timetable.views.noVersion')}</p>
      )}
      {day.dayOff !== null && (
        <p className="text-sm">{t('timetable.views.dayOff', { name: day.dayOff })}</p>
      )}
      {day.fromPattern && (
        <p className="text-sm text-muted-foreground">{t('timetable.views.fromPattern')}</p>
      )}
    </div>
  );
}

/** The words of a lesson's state: cancelled with its reason, needs a teacher or a room, changed. */
export function useLessonMarks() {
  const { t } = useTranslation();
  return (lesson: ViewLesson): string[] => [
    ...(lesson.cancelCause === 'reason'
      ? [t('timetable.day.cancelledReason', { reason: lesson.cancelReason ?? '' })]
      : lesson.cancelCause !== null
        ? [t(`timetable.day.cause_${lesson.cancelCause}`)]
        : []),
    ...(lesson.replacedHere && lesson.teacher !== null
      ? [t('timetable.views.replacedBy', { name: lesson.teacher.name })]
      : []),
    ...(!lesson.replacedHere && lesson.substitution?.replaced
      ? [t('timetable.day.substituteFor', { name: lesson.substitution.replaced.name })]
      : []),
    ...(lesson.teacher === null || lesson.away !== null ? [t('timetable.day.needsTeacher')] : []),
    ...(lesson.room === null || lesson.roomOut !== null ? [t('timetable.day.needsRoom')] : []),
    ...(lesson.changed ? [t('timetable.day.changed')] : []),
  ];
}

function DayTable({ items, language }: { items: Item[]; language: Language }) {
  const { t } = useTranslation();
  const marks = useLessonMarks();
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">{t('timetable.views.noLessons')}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('timetable.day.time')}</TableHead>
            <TableHead>{t('timetable.day.unit')}</TableHead>
            <TableHead>{t('timetable.day.subject')}</TableHead>
            <TableHead>{t('timetable.day.teacher')}</TableHead>
            <TableHead>{t('timetable.day.room')}</TableHead>
            <TableHead>{t('timetable.day.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const time = `${timeText(item.start)}–${timeText(item.end)}`;
            if (item.kind === 'busy') {
              return (
                <TableRow
                  key={`busy-${String(item.start)}-${item.busy.branch.id}`}
                  data-busy="true"
                  className="bg-muted"
                >
                  <TableCell>{time}</TableCell>
                  <TableCell colSpan={5}>
                    {t('timetable.views.busyIn', { branch: item.busy.branch.name })}
                  </TableCell>
                </TableRow>
              );
            }
            if (item.kind === 'exam') {
              const { exam } = item;
              return (
                <TableRow key={exam.id} data-exam={exam.id}>
                  <TableCell>{time}</TableCell>
                  <TableCell>{exam.rooms.flatMap((room) => room.units).join(', ')}</TableCell>
                  <TableCell>
                    {exam.title}
                    {exam.subject !== null && <> · {exam.subject.names[language]}</>}
                  </TableCell>
                  <TableCell>
                    {exam.rooms.flatMap((room) => room.invigilators).join(', ')}
                  </TableCell>
                  <TableCell>{exam.rooms.map((room) => room.room.name).join(', ')}</TableCell>
                  <TableCell className="font-semibold">{t('timetable.day.exam')}</TableCell>
                </TableRow>
              );
            }
            const { lesson } = item;
            return (
              <TableRow key={lesson.id} data-lesson={lesson.id}>
                <TableCell>{time}</TableCell>
                <TableCell>{lesson.unit.name}</TableCell>
                <TableCell>{lesson.subject.names[language]}</TableCell>
                <TableCell>
                  {lesson.replacedHere
                    ? (lesson.substitution?.replaced?.name ?? '')
                    : (lesson.teacher?.name ?? '')}
                </TableCell>
                <TableCell>{lesson.room?.name ?? ''}</TableCell>
                <TableCell>{marks(lesson).join(' · ') || t('timetable.day.asPlanned')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** The short text of a lesson, an exam or a busy block in a cell of a grid. */
function useCellText(kind: ViewKind, language: Language) {
  const { t } = useTranslation();
  const marks = useLessonMarks();
  return (item: Item): string => {
    if (item.kind === 'busy') return t('timetable.views.busyIn', { branch: item.busy.branch.name });
    if (item.kind === 'exam') {
      return [
        t('timetable.day.exam'),
        item.exam.title,
        ...item.exam.rooms.map((one) => one.room.name),
      ].join(' · ');
    }
    const { lesson } = item;
    return [
      lesson.subject.names[language],
      ...(kind === 'class' ? [] : [lesson.unit.name]),
      ...(kind === 'teacher' ? [] : [lesson.teacher?.name ?? '']),
      ...(kind === 'room' ? [] : [lesson.room?.name ?? '']),
      ...marks(lesson),
    ]
      .filter((one) => one !== '')
      .join(' · ');
  };
}

/**
 * The week of a class, a teacher or a room: days as columns; rows by lesson
 * number, or by clock time when a day of the week is on the clock axis
 * (review correction 2: lesson numbers of different templates never share a row).
 */
function WeekGrid({ view, language }: { view: TimetableView; language: Language }) {
  const { t } = useTranslation();
  const text = useCellText(view.kind, language);
  const clock = view.days.some((day) => day.axis === 'clock');
  const items = new Map(view.days.map((day) => [day.date, itemsOf(view, day.date)]));
  const numberOf = (item: Item, day: ViewDay): number | null =>
    item.kind === 'lesson'
      ? item.lesson.lessonNumber
      : (day.slots.find((slot) => slot.start <= item.start && item.start < slot.end)
          ?.lessonNumber ?? null);
  const rows: { key: string; label: string; holds: (item: Item, day: ViewDay) => boolean }[] = clock
    ? [
        ...new Set(
          [...items.values()].flat().map((item) => `${String(item.start)}-${String(item.end)}`),
        ),
      ]
        .map((key) => key.split('-').map(Number) as [number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .map(([start, end]) => ({
          key: `${String(start)}-${String(end)}`,
          label: `${timeText(start)}–${timeText(end)}`,
          holds: (item: Item) => item.start === start && item.end === end,
        }))
    : [
        ...new Set([
          ...view.days.flatMap((day) => day.slots.map((slot) => slot.lessonNumber)),
          ...view.days.flatMap((day) =>
            (items.get(day.date) ?? []).flatMap((item) => {
              const found = numberOf(item, day);
              return found === null ? [] : [found];
            }),
          ),
        ]),
      ]
        .sort((a, b) => a - b)
        .map((number) => ({
          key: String(number),
          label: t('timetable.views.lessonNumber', { number }),
          holds: (item: Item, day: ViewDay) => numberOf(item, day) === number,
        }));
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto" data-axis={clock ? 'clock' : 'slots'}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{clock ? t('timetable.day.time') : t('timetable.views.lesson')}</TableHead>
              {view.days.map((day) => (
                <TableHead key={day.date}>
                  {weekdayName(language, weekdayOf(day.date))},{' '}
                  {schoolDateText(day.date, language, false)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-semibold">{row.label}</TableCell>
                {view.days.map((day) => (
                  <TableCell key={day.date}>
                    {(items.get(day.date) ?? [])
                      .filter((item) => row.holds(item, day))
                      .map((item) => (
                        <p
                          key={`${item.kind}-${String(item.start)}-${item.kind === 'lesson' ? item.lesson.id : item.kind === 'exam' ? item.exam.id : item.busy.branch.id}`}
                          {...(item.kind === 'busy'
                            ? { 'data-busy': 'true', className: 'text-muted-foreground' }
                            : {})}
                        >
                          {text(item)}
                        </p>
                      ))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {view.days.map((day) =>
        day.dayOff === null &&
        !day.fromPattern &&
        !day.outsideYear &&
        day.version !== null ? null : (
          <DayHeading key={day.date} day={day} language={language} />
        ),
      )}
    </div>
  );
}

/** The whole school on a day: classes as rows, lesson numbers as columns. */
function SchoolDay({
  view,
  day,
  language,
}: {
  view: TimetableView;
  day: ViewDay;
  language: Language;
}) {
  const { t } = useTranslation();
  const text = useCellText('class', language);
  const items = itemsOf(view, day.date);
  const numbers = [
    ...new Set(
      items.flatMap((item) =>
        item.kind === 'lesson' && item.lesson.lessonNumber !== null
          ? [item.lesson.lessonNumber]
          : [],
      ),
    ),
  ].sort((a, b) => a - b);
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">{t('timetable.views.noLessons')}</p>;
  const ofClass = (classId: string) =>
    items.filter((item) =>
      item.kind === 'lesson'
        ? item.lesson.classIds.includes(classId)
        : item.kind === 'exam'
          ? item.exam.rooms.some((room) => room.classIds.includes(classId))
          : false,
    );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('timetable.views.kind_class')}</TableHead>
            {numbers.map((number) => (
              <TableHead key={number}>{t('timetable.views.lessonNumber', { number })}</TableHead>
            ))}
            <TableHead>{t('timetable.day.exam')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.classes.map((one) => {
            const own = ofClass(one.id);
            return (
              <TableRow key={one.id} data-class={one.id}>
                <TableCell className="font-semibold">{one.name}</TableCell>
                {numbers.map((number) => (
                  <TableCell key={number}>
                    {own
                      .filter(
                        (item) => item.kind === 'lesson' && item.lesson.lessonNumber === number,
                      )
                      .map((item) => (
                        <p key={item.kind === 'lesson' ? item.lesson.id : ''}>{text(item)}</p>
                      ))}
                  </TableCell>
                ))}
                <TableCell>
                  {own
                    .filter((item) => item.kind === 'exam')
                    .map((item) => (
                      <p key={item.kind === 'exam' ? item.exam.id : ''}>
                        {timeText(item.start)}–{timeText(item.end)} · {text(item)}
                      </p>
                    ))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
