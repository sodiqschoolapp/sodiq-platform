import { classDisplayName, type LoadTotals } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
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
import { totalsQuery } from './timetable-api';

type TeacherTotal = LoadTotals['teachers'][number];

/**
 * The weekly totals of a version (`06`, Building a timetable, steps 2 and 3:
 * "The weekly lessons of every class fit into the week's lesson slots", "No
 * teacher has more lessons than free slots"; Teachers who work in several
 * branches, Weekly load: "The teacher's total across branches is shown to both
 * and compared with the contract load"; task 3.4b, decisions 5 to 8). Shown to
 * compare, never refusing; an overrun is marked with the danger token.
 */
export function LoadTotalsSection({ versionId }: { versionId: string }) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const totals = useQuery(totalsQuery(branchId, versionId));
  const number = new Intl.NumberFormat(i18n.language);
  const count = (value: number) => number.format(value);

  const over = (value: number, limit: number | null) =>
    limit !== null && value > limit ? (
      <span className="ml-2 font-semibold text-destructive">
        {t('timetable.load.totals.over', { count: value - limit, n: count(value - limit) })}
      </span>
    ) : null;

  const totalOf = (teacher: TeacherTotal) =>
    teacher.lessons + teacher.elsewhere.reduce((sum, one) => sum + one.lessons, 0);

  return (
    <section aria-labelledby="load-totals" className={`${PANEL} grid gap-4`}>
      <div className="grid gap-1">
        <h2 id="load-totals" className={SECTION_TITLE}>
          {t('timetable.load.totals.title')}
        </h2>
      </div>
      {totals.isError ? (
        <ErrorState
          error={totals.error}
          onRetry={() => {
            void totals.refetch();
          }}
        />
      ) : totals.data === undefined ? (
        <LoadingOutline lines={3} />
      ) : totals.data.classes.length === 0 && totals.data.teachers.length === 0 ? (
        <p className="text-sm">{t('timetable.load.totals.empty')}</p>
      ) : (
        <>
          <h3 className={SECTION_TITLE}>{t('timetable.load.totals.classes')}</h3>
          <Table data-totals="classes">
            <TableHeader>
              <TableRow>
                <TableHead>{t('timetable.load.totals.class')}</TableHead>
                <TableHead className="text-right">{t('timetable.load.totals.lessons')}</TableHead>
                <TableHead className="text-right">
                  {t('timetable.load.totals.lessonSlots')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.data.classes.map((one) => (
                <TableRow key={one.id}>
                  <TableCell>{classDisplayName(one.grade, one.name)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(one.lessons)}
                    {over(one.lessons, one.lessonSlots)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(one.lessonSlots)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <h3 className={SECTION_TITLE}>{t('timetable.load.totals.teachers')}</h3>
          <Table data-totals="teachers">
            <TableHeader>
              <TableRow>
                <TableHead>{t('timetable.load.totals.teacher')}</TableHead>
                <TableHead className="text-right">{t('timetable.load.totals.here')}</TableHead>
                <TableHead className="text-right">{t('timetable.load.totals.free')}</TableHead>
                <TableHead>{t('timetable.load.totals.elsewhere')}</TableHead>
                <TableHead className="text-right">{t('timetable.load.totals.total')}</TableHead>
                <TableHead className="text-right">{t('timetable.load.totals.contract')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.data.teachers.map((one) => {
                const name = one.name ?? t('timetable.load.gone');
                return (
                  <TableRow key={one.id}>
                    <TableCell>
                      {one.kind === 'vacancy' ? t('timetable.load.vacancyOption', { name }) : name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(one.lessons)}
                      {over(one.lessons, one.freeSlots)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {one.freeSlots === null
                        ? t('timetable.load.totals.noHours')
                        : count(one.freeSlots)}
                    </TableCell>
                    <TableCell>
                      {one.elsewhere.length === 0
                        ? t('timetable.load.blockNone')
                        : one.elsewhere
                            .map((other) =>
                              t(
                                other.draft
                                  ? 'timetable.load.totals.elsewhereDraft'
                                  : 'timetable.load.totals.elsewhereItem',
                                {
                                  branch: other.branchName,
                                  count: other.lessons,
                                  n: count(other.lessons),
                                },
                              ),
                            )
                            .join(', ')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(totalOf(one))}
                      {over(totalOf(one), one.contract)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {one.contract === null ? t('timetable.load.blockNone') : count(one.contract)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}
