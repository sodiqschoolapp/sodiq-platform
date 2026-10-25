import { errorCodeSchema, type JournalSupport, type SupportLine } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DateField, SelectField } from '@/components/field';
import { PageHeader } from '@/components/page-header';
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
import { accountText, cellValueText, workLineText } from '@/features/people/cell-lines';
import { nameOf } from '@/features/setup/setup-api';
import { momentText, schoolDateText } from '@/lib/dates';
import { journalGridQuery, journalSupportQuery, journalsQuery } from './journal-api';

/** The address of the support view: the journal, the student and the date chosen. */
export interface SupportSearch {
  journal?: string;
  student?: string;
  date?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const supportSearch = (search: Record<string, unknown>): SupportSearch => {
  const id = (value: unknown) =>
    typeof value === 'string' && UUID.test(value) ? { value } : undefined;
  const journal = id(search.journal);
  const student = id(search.student);
  const date =
    typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
      ? search.date
      : undefined;
  return {
    ...(journal === undefined ? {} : { journal: journal.value }),
    ...(student === undefined ? {} : { student: student.value }),
    ...(date === undefined ? {} : { date }),
  };
};

/** "08:00" from clock minutes of the day. */
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

type Lesson = JournalSupport['lessons'][number];

/** The work a line names, as the cell history names it. */
function workText(
  t: TFunction,
  work: { kind: 'classwork' | 'homework'; title: string | null } | null,
) {
  if (work === null) return t('journal.attendance');
  const kind = t(work.kind === 'classwork' ? 'journal.classwork' : 'journal.homework');
  return work.title === null ? kind : `${kind}: ${work.title}`;
}

/** What a line says happened, its values and its detail, in words. */
function lineText(
  t: TFunction,
  language: string,
  line: SupportLine,
): { what: string; detail: string } {
  const attendance = (work: { kind: string } | null) => ({
    attendance: work === null,
    workKind: null,
  });
  switch (line.kind) {
    case 'cell': {
      const cell = attendance(line.work);
      const values = `${cellValueText(t, cell, line.before)} → ${cellValueText(t, cell, line.after)}`;
      const detail = [
        t(`journal.changes.${line.how}`),
        ...(line.notGradedAfter !== line.notGradedBefore
          ? [line.notGradedAfter ? t('journal.support.notGraded') : t('journal.support.graded')]
          : []),
        ...(line.approvedBy === null
          ? []
          : [t('journal.support.approvedBy', { name: accountText(line.approvedBy, '—') })]),
        ...(line.orphanAssignment ? [t('journal.support.orphan')] : []),
        ...(line.reason === null ? [] : [line.reason]),
      ];
      return { what: `${workText(t, line.work)}: ${values}`, detail: detail.join(' · ') };
    }
    case 'work':
      return {
        what: workLineText(t, { ...line, workKind: line.work.kind }),
        detail: t(`journal.works.changes.${line.how}`),
      };
    case 'delivery':
      return {
        what: t(line.mark === 'topic' ? 'journal.support.topic' : 'journal.support.homework'),
        detail: line.after ? t('journal.support.set') : t('journal.support.undone'),
      };
    case 'refusal': {
      const cell = attendance(line.field === 'attendance' ? null : { kind: 'work' });
      const sent =
        line.field === 'rating'
          ? String(line.valueSent ?? '—')
          : cellValueText(t, cell, line.valueSent);
      return {
        what: t('journal.support.refused', {
          cell: line.field === 'rating' ? t('journal.support.rating') : workText(t, line.work),
          value: sent,
        }),
        detail: errorCodeSchema.safeParse(line.code).success
          ? t(`errors.${errorCodeSchema.parse(line.code)}`)
          : line.code,
      };
    }
    case 'exemption_clear':
    case 'exemption_give_back': {
      const cell = attendance(line.work);
      return {
        what: t(
          line.kind === 'exemption_clear' ? 'journal.support.cleared' : 'journal.support.givenBack',
          { cell: workText(t, line.work), value: cellValueText(t, cell, line.value) },
        ),
        detail: t('journal.support.exemption', {
          kind: t(`journal.support.kinds.${line.exemption.kind}`),
          from: schoolDateText(line.exemption.startDate, language),
          until: schoolDateText(line.exemption.endDate, language),
        }),
      };
    }
    case 'void':
    case 'void_give_back': {
      const cell = attendance(line.target === 'cell' ? line.work : { kind: 'rating' });
      return {
        what: t(line.kind === 'void' ? 'journal.support.voided' : 'journal.support.voidGivenBack', {
          cell: line.target === 'rating' ? t('journal.support.rating') : workText(t, line.work),
          value:
            line.target === 'rating'
              ? String(line.value ?? '—')
              : cellValueText(t, cell, line.value),
        }),
        detail: [
          t(`journal.support.sources.${line.source}`),
          ...(line.kind === 'void' && line.reason !== null ? [line.reason] : []),
        ].join(' · '),
      };
    }
    case 'rating': {
      const entry = (value: typeof line.before) =>
        value === null
          ? '—'
          : value.kind === 'score'
            ? String(value.score)
            : t(`journal.rating.kinds.${value.kind}`);
      return {
        what: `${t('journal.support.rating')}: ${entry(line.before)} → ${entry(line.after)}`,
        detail: line.reason ?? '',
      };
    }
  }
}

const whoOf = (line: SupportLine): string =>
  'by' in line && line.by !== null ? accountText(line.by, '—') : '—';

/**
 * The support view of one student, journal and date (task 8.9, pull request
 * #227; `edge/journal`, "My grade disappeared": "A support view for one
 * student, journal and date shows every save, every refusal and every such
 * event in order, with how the result was calculated"). Every figure is the
 * grid's, which the server takes from `packages/calc`.
 */
export function SupportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: SupportSearch = useSearch({ from: '/app/journal/support' });
  const { branchId } = useView();
  const journals = useQuery(journalsQuery(branchId, null));
  const journalId = search.journal ?? null;
  const date = search.date ?? null;
  const first = useQuery({
    ...journalGridQuery(branchId, journalId ?? '', null),
    enabled: branchId !== null && journalId !== null,
  });
  const quarterId =
    date === null
      ? null
      : (first.data?.quarters.find(
          (one) =>
            one.startDate !== null &&
            one.endDate !== null &&
            one.startDate <= date &&
            date <= one.endDate,
        )?.id ?? null);
  const grid = useQuery({
    ...journalGridQuery(branchId, journalId ?? '', quarterId),
    enabled: branchId !== null && journalId !== null && quarterId !== null,
  });
  const query =
    journalId !== null && date !== null && search.student !== undefined && quarterId !== null
      ? { journalId, studentId: search.student, date }
      : null;
  const support = useQuery(journalSupportQuery(branchId, query));
  const go = (next: SupportSearch) => {
    void navigate({ to: '/journal/support', search: { ...search, ...next }, replace: true });
  };
  const breadcrumbs = [
    { label: t('home.title'), to: '/' as const },
    { label: t('journal.page.title'), to: '/journal' as const },
  ];
  const failed = journals.isError ? journals : first.isError ? first : grid.isError ? grid : null;
  return (
    <>
      <PageHeader title={t('journal.support.title')} breadcrumbs={breadcrumbs} />
      <div className="grid gap-4">
        <div className={`${PANEL} flex flex-wrap items-end gap-4`}>
          <div className="w-72">
            <SelectField
              label={t('journal.support.journal')}
              value={journalId ?? ''}
              options={[
                { value: '', label: t('journal.support.choose') },
                ...(journals.data?.journals ?? []).map((one) => ({
                  value: one.id,
                  label: `${one.unit.name} · ${nameOf(one.subject.names, language)}`,
                })),
              ]}
              onChange={(event) => {
                go(
                  event.target.value === ''
                    ? { journal: undefined }
                    : { journal: event.target.value },
                );
              }}
            />
          </div>
          <div className="w-48">
            <DateField
              label={t('journal.support.date')}
              value={date ?? ''}
              onChange={(event) => {
                go(event.target.value === '' ? { date: undefined } : { date: event.target.value });
              }}
            />
          </div>
          <div className="w-72">
            <SelectField
              label={t('journal.support.student')}
              value={search.student ?? ''}
              options={[
                { value: '', label: t('journal.support.choose') },
                ...(grid.data?.students ?? []).map((one) => ({
                  value: one.id,
                  label: `${one.lastName} ${one.firstName} · ${one.uid}`,
                })),
              ]}
              onChange={(event) => {
                go(
                  event.target.value === ''
                    ? { student: undefined }
                    : { student: event.target.value },
                );
              }}
            />
          </div>
        </div>
        {failed !== null ? (
          <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        ) : journalId !== null &&
          date !== null &&
          first.data !== undefined &&
          quarterId === null ? (
          <EmptyState text={t('journal.support.noQuarter')} />
        ) : query === null ? (
          <EmptyState text={t('journal.support.empty')} />
        ) : support.isError ? (
          <ErrorState error={support.error} onRetry={() => void support.refetch()} />
        ) : support.data === undefined ? (
          <LoadingOutline />
        ) : (
          <SupportResult view={support.data} />
        )}
      </div>
    </>
  );
}

function SupportResult({ view }: { view: JournalSupport }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const figures = view.figures;
  const result = figures?.result ?? null;
  const resultText =
    result === null
      ? '—'
      : result.kind === 'number'
        ? [
            t('journal.support.resultNumber', { shown: result.shown, grade: result.grade }),
            ...(result.provisional ? [t('journal.support.provisional')] : []),
            ...(result.basedOn === null
              ? []
              : [
                  t('journal.support.basedOn', {
                    held: result.basedOn.held,
                    expected: result.basedOn.expected,
                  }),
                ]),
          ].join(' · ')
        : t(`journal.support.results.${result.kind}`);
  const part = (value: number | null) => (value === null ? '—' : String(value));
  const heading = [`${view.student.lastName} ${view.student.firstName}`, view.student.uid].join(
    ' · ',
  );
  return (
    <div className="grid gap-4" data-support-view="true">
      <div className={`${PANEL} grid gap-2`}>
        <h2 className={SECTION_TITLE}>{heading}</h2>
        <p>
          {[
            view.journal.unit.name,
            nameOf(view.journal.subject.names, language),
            t('journal.page.quarterNumber', { number: view.quarter.number }),
            schoolDateText(view.date, language),
            ...(view.student.folded ? [t('journal.support.folded')] : []),
          ].join(' · ')}
        </p>
      </div>
      <div className={`${PANEL} grid gap-3`}>
        <h2 className={SECTION_TITLE}>{t('journal.support.calculation')}</h2>
        {view.lessons.length === 0 ? (
          <p className="text-muted-foreground">{t('journal.support.noLessons')}</p>
        ) : (
          view.lessons.map((one) => <LessonFigures key={one.lesson.id} lesson={one} />)
        )}
        <p data-support-quarter="true">
          {t('journal.support.quarterFigures', {
            attendance: part(figures?.attendance ?? null),
            classwork: part(figures?.classwork ?? null),
            homework: part(figures?.homework ?? null),
            ratingExam: part(figures?.ratingExam ?? null),
            result: resultText,
          })}
        </p>
        <p className="text-muted-foreground">
          {[
            view.legend.daily === null
              ? null
              : t('journal.support.daily', { ...view.legend.daily }),
            view.legend.quarterly === null
              ? null
              : t('journal.support.quarterly', {
                  ...view.legend.quarterly,
                  ratingExam: view.legend.quarterly.ratingExam ?? 0,
                }),
            t('journal.support.values', {
              late: view.legend.lateValue,
              skipped: view.legend.skippedValue,
            }),
          ]
            .filter((text) => text !== null)
            .join(' · ')}
        </p>
      </div>
      <div className={`${PANEL} grid gap-3`}>
        <h2 className={SECTION_TITLE}>{t('journal.support.lines')}</h2>
        {view.lines.length === 0 ? (
          <p className="text-muted-foreground">{t('journal.support.noLines')}</p>
        ) : (
          <Table aria-label={t('journal.support.lines')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('journal.support.when')}</TableHead>
                <TableHead>{t('journal.support.what')}</TableHead>
                <TableHead>{t('journal.support.how')}</TableHead>
                <TableHead>{t('journal.support.who')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.lines.map((line, index) => {
                const text = lineText(t, language, line);
                return (
                  <TableRow key={`${line.kind}:${line.at}:${String(index)}`} data-line={line.kind}>
                    <TableCell>{momentText(language, line.at)}</TableCell>
                    <TableCell>{text.what}</TableCell>
                    <TableCell>{text.detail}</TableCell>
                    <TableCell>{whoOf(line)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** One lesson of the date: the cell as the grid shows it, the values stored and what hid them. */
function LessonFigures({ lesson: one }: { lesson: Lesson }) {
  const { t, i18n } = useTranslation();
  const { lesson, cell, stored, hiddenBy } = one;
  const mark =
    cell.exempt !== null
      ? cell.exempt === 'temporary'
        ? '4'
        : '5'
      : cell.mark === null
        ? '—'
        : String(cell.mark);
  const time = [
    [clock(lesson.start), clock(lesson.end)].join('–'),
    ...(lesson.cancelled === null
      ? []
      : [
          [t('journal.cancelled'), lesson.cancelled.reason]
            .filter((one) => one !== null)
            .join(': '),
        ]),
  ].join(' · ');
  const works = lesson.works.map((work, place) => {
    const value = cell.works[place];
    const title =
      work.title ?? t(work.kind === 'classwork' ? 'journal.classwork' : 'journal.homework');
    return t('journal.support.work', {
      title,
      score: value?.score ?? '—',
      total: work.total ?? '—',
      percent: value?.percent ?? '—',
    });
  });
  return (
    <div className="grid gap-1" data-support-lesson={lesson.id}>
      <p className="font-semibold">{time}</p>
      <p>
        {[
          t('journal.support.mark', { mark }),
          ...works,
          t('journal.support.lessonScore', { score: cell.score ?? '—' }),
        ].join(' · ')}
      </p>
      <p className="text-muted-foreground">
        {[
          t('journal.support.stored', {
            mark: stored.mark ?? '—',
            works: stored.works.map((work) => work.score ?? '—').join(', ') || '—',
          }),
          ...(hiddenBy === null
            ? []
            : [
                t('journal.support.hiddenBy', {
                  kind: t(`journal.support.kinds.${hiddenBy.kind}`),
                  from: schoolDateText(hiddenBy.startDate, i18n.language),
                  until: schoolDateText(hiddenBy.endDate, i18n.language),
                }),
              ]),
        ].join(' · ')}
      </p>
    </div>
  );
}
