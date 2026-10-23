import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { planParallelQuery, plansQuery } from './plans-api';

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * The parallel classes (task 7.3, pull request #216, decision 13; `09`,
 * Master plans: "The Head Teacher sees all classes of a grade side by side
 * with the item each has reached"): a subject, a grade and a quarter of the
 * year, one panel per class or group with the last lesson started, its topic
 * and the next topic. A group of two grades is under both grades. The
 * subjects are those of the plans the reader reads.
 */
export function PlanParallelPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const plans = useQuery(plansQuery(branchId, null));
  const subjects = [
    ...new Map(
      (plans.data?.plans ?? []).map((row) => [
        row.subject.id,
        nameOf(row.subject.names, i18n.language),
      ]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], i18n.language));
  const quarters = plans.data?.quarters ?? [];
  const [subject, setSubject] = useState<string | null>(null);
  const [grade, setGrade] = useState('7');
  const [quarter, setQuarter] = useState<string | null>(null);
  // The choices follow the options (`.claude/rules/web.md`).
  const subjectId = subjects.find(([id]) => id === subject)?.[0] ?? subjects[0]?.[0] ?? null;
  const quarterId = quarters.find((one) => one.id === quarter)?.id ?? quarters[0]?.id ?? null;
  const parallel = useQuery(
    planParallelQuery(
      branchId,
      subjectId === null || quarterId === null ? null : { subjectId, grade, quarterId },
    ),
  );
  const date = (value: string) => schoolDateText(value, i18n.language, false);
  const line = (row: { number: number; date: string; topic: string | null }) =>
    t(row.topic === null ? 'plans.parallel.atEmpty' : 'plans.parallel.at', {
      number: row.number,
      date: date(row.date),
      topic: row.topic ?? '',
    });
  return (
    <>
      <PageHeader
        title={t('plans.parallel.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
        ]}
      />
      {plans.isError ? (
        <ErrorState
          error={plans.error}
          onRetry={() => {
            void plans.refetch();
          }}
        />
      ) : plans.data === undefined ? (
        <LoadingOutline />
      ) : subjectId === null || quarterId === null ? (
        <EmptyState title={t('plans.parallel.emptyTitle')} text={t('plans.parallel.empty')} />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-56">
              <SelectField
                label={t('plans.page.subject')}
                value={subjectId}
                options={subjects.map(([value, label]) => ({ value, label }))}
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
              />
            </div>
            <div className="w-32">
              <SelectField
                label={t('plans.masters.grade')}
                value={grade}
                options={GRADES.map((one) => ({ value: String(one), label: String(one) }))}
                onChange={(event) => {
                  setGrade(event.target.value);
                }}
              />
            </div>
            <div className="w-40">
              <SelectField
                label={t('plans.masters.quarter')}
                value={quarterId}
                options={quarters.map((one) => ({
                  value: one.id,
                  label: t('plans.page.quarter', { number: one.number }),
                }))}
                onChange={(event) => {
                  setQuarter(event.target.value);
                }}
              />
            </div>
          </div>
          {parallel.isError ? (
            <ErrorState
              error={parallel.error}
              onRetry={() => {
                void parallel.refetch();
              }}
            />
          ) : parallel.data === undefined ? (
            <LoadingOutline />
          ) : parallel.data.units.length === 0 ? (
            <EmptyState text={t('plans.parallel.none')} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {parallel.data.units.map((unit) => (
                <section
                  key={unit.journalId}
                  className={`${PANEL} grid gap-2 p-4`}
                  aria-labelledby={`parallel-${unit.journalId}`}
                  data-unit={unit.journalId}
                >
                  <h2 id={`parallel-${unit.journalId}`} className={SECTION_TITLE}>
                    {unit.unit.name}
                  </h2>
                  <p className="text-sm" data-reached>
                    {t('plans.parallel.reached')}:{' '}
                    {unit.reached === null ? t('plans.parallel.notStarted') : line(unit.reached)}
                  </p>
                  <p className="text-sm text-muted-foreground" data-next>
                    {t('plans.parallel.next')}:{' '}
                    {unit.next === null ? t('plans.parallel.finished') : line(unit.next)}
                  </p>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
